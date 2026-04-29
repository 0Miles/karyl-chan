import type { Client } from "discordx";
import {
  ApplicationCommandOptionType,
  ApplicationCommandType,
  ApplicationIntegrationType,
  InteractionContextType,
  PermissionFlagsBits,
  type ApplicationCommandData,
  type ApplicationCommandOptionData,
  type ChannelType,
} from "discord.js";
import {
  deletePluginCommandsByPlugin,
  findCommandCollisions,
  findPluginCommandsByPlugin,
  upsertPluginCommand,
  type PluginCommandRow,
} from "../models/plugin-command.model.js";
import { findAllPlugins, type PluginRow } from "../models/plugin.model.js";
import { botEventLog } from "../web/bot-event-log.js";
import type {
  ManifestCommand,
  ManifestCommandOption,
  PluginManifest,
} from "./plugin-registry.service.js";

/**
 * Plugin slash-command registration with Discord, separate from the
 * discordx-managed in-process commands.
 *
 * What this owns:
 *   - Translating manifest commands → ApplicationCommandData via
 *     manifestToApplicationCommand().
 *   - Telling Discord to create / update / delete plugin commands
 *     via discord.js raw application command APIs.
 *   - Persisting the result (discordCommandId) in plugin_commands so
 *     reverse lookup (interaction → plugin) is one DB query.
 *   - Reconciling on bot startup: walk active plugins' manifests,
 *     compare to plugin_commands, patch the diff.
 *
 * What this does NOT own:
 *   - Routing inbound interactions to plugins. That lives in main.ts'
 *     interactionCreate handler, which queries findPluginCommandByName
 *     and posts to the plugin via plugin-event-bridge / a dedicated
 *     /commands/<name> POST.
 *   - Discord vs discordx prune coordination. discordx's
 *     initApplicationCommands runs once at boot before this service
 *     does anything; if discordx is configured to delete unknown
 *     commands at boot, it would wipe ours. main.ts is responsible
 *     for ordering: discordx first, then reconcileAllPluginCommands.
 */

// Map manifest option-type strings → discord.js enum values. Tightly
// coupled to Discord's slash command spec; if a manifest declares an
// option type we don't recognize, registration of that command fails
// loudly rather than silently dropping it.
const OPTION_TYPE_MAP: Record<string, ApplicationCommandOptionType> = {
  sub_command: ApplicationCommandOptionType.Subcommand,
  sub_command_group: ApplicationCommandOptionType.SubcommandGroup,
  string: ApplicationCommandOptionType.String,
  integer: ApplicationCommandOptionType.Integer,
  boolean: ApplicationCommandOptionType.Boolean,
  user: ApplicationCommandOptionType.User,
  channel: ApplicationCommandOptionType.Channel,
  role: ApplicationCommandOptionType.Role,
  mentionable: ApplicationCommandOptionType.Mentionable,
  number: ApplicationCommandOptionType.Number,
  attachment: ApplicationCommandOptionType.Attachment,
};

const CHANNEL_TYPE_MAP: Record<string, ChannelType> = {
  GUILD_TEXT: 0 as ChannelType,
  DM: 1 as ChannelType,
  GUILD_VOICE: 2 as ChannelType,
  GROUP_DM: 3 as ChannelType,
  GUILD_CATEGORY: 4 as ChannelType,
  GUILD_ANNOUNCEMENT: 5 as ChannelType,
  ANNOUNCEMENT_THREAD: 10 as ChannelType,
  PUBLIC_THREAD: 11 as ChannelType,
  PRIVATE_THREAD: 12 as ChannelType,
  GUILD_STAGE_VOICE: 13 as ChannelType,
  GUILD_FORUM: 15 as ChannelType,
};

function manifestOptionToData(
  o: ManifestCommandOption,
): ApplicationCommandOptionData {
  const type = OPTION_TYPE_MAP[o.type];
  if (type === undefined) {
    throw new ManifestCommandError(`unknown option type '${o.type}'`);
  }
  const base = {
    type,
    name: o.name,
    description: o.description ?? o.name,
    required: o.required ?? false,
  } as Record<string, unknown>;
  // Sub-commands can carry nested options; flat options can't.
  if (
    o.options &&
    (type === ApplicationCommandOptionType.Subcommand ||
      type === ApplicationCommandOptionType.SubcommandGroup)
  ) {
    base.options = o.options.map(manifestOptionToData);
    delete base.required;
  }
  if (o.channel_types && type === ApplicationCommandOptionType.Channel) {
    base.channelTypes = o.channel_types
      .map((t) => CHANNEL_TYPE_MAP[t])
      .filter((t) => t !== undefined);
  }
  if (o.choices && o.choices.length > 0) {
    base.choices = o.choices.map((c) => ({ name: c.name, value: c.value }));
  }
  return base as unknown as ApplicationCommandOptionData;
}

const CONTEXT_MAP: Record<string, InteractionContextType> = {
  Guild: InteractionContextType.Guild,
  BotDM: InteractionContextType.BotDM,
  PrivateChannel: InteractionContextType.PrivateChannel,
};

const INTEGRATION_MAP: Record<string, ApplicationIntegrationType> = {
  guild_install: ApplicationIntegrationType.GuildInstall,
  user_install: ApplicationIntegrationType.UserInstall,
};

function manifestToApplicationCommand(
  cmd: ManifestCommand,
): ApplicationCommandData {
  const data: Record<string, unknown> = {
    type: ApplicationCommandType.ChatInput,
    name: cmd.name,
    description: cmd.description,
    dmPermission: cmd.dm_permission ?? undefined,
    options: (cmd.options ?? []).map(manifestOptionToData),
  };
  if (cmd.contexts && cmd.contexts.length > 0) {
    const mapped = cmd.contexts
      .map((c) => CONTEXT_MAP[c])
      .filter((c): c is InteractionContextType => c !== undefined);
    if (mapped.length > 0) data.contexts = mapped;
  }
  if (cmd.integration_types && cmd.integration_types.length > 0) {
    const mapped = cmd.integration_types
      .map((t) => INTEGRATION_MAP[t])
      .filter((t): t is ApplicationIntegrationType => t !== undefined);
    if (mapped.length > 0) data.integrationTypes = mapped;
  }
  if (
    typeof cmd.default_member_permissions === "string" &&
    cmd.default_member_permissions.length > 0
  ) {
    // Discord's API expects defaultMemberPermissions as a bigint string.
    // Plugin authors typically write the SCREAMING_SNAKE form from
    // Discord's docs ("MANAGE_GUILD"), but discord.js v14's
    // PermissionFlagsBits keys are PascalCase ("ManageGuild"). Accept
    // both: try the literal key first, then convert SNAKE → Pascal.
    const flags = PermissionFlagsBits as Record<string, bigint>;
    const raw = cmd.default_member_permissions;
    const pascal = raw.includes("_")
      ? raw
          .toLowerCase()
          .split("_")
          .map((s) => (s.length === 0 ? "" : s[0].toUpperCase() + s.slice(1)))
          .join("")
      : raw;
    const flag = flags[raw] ?? flags[pascal];
    if (typeof flag === "bigint") {
      data.defaultMemberPermissions = flag.toString();
    } else {
      botEventLog.record(
        "warn",
        "bot",
        `plugin-commands: unknown default_member_permissions '${raw}' on command '${cmd.name}'; skipped`,
      );
    }
  }
  return data as unknown as ApplicationCommandData;
}

export class ManifestCommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ManifestCommandError";
  }
}

export class PluginCommandRegistry {
  constructor(private getBot: () => Client | null) {}

  /**
   * Names that bot infrastructure always owns and plugins must never
   * shadow. Static fallback used when the live Discord cache isn't
   * ready yet (early register-on-startup window).
   *
   * `manual` / `break` / `login` are global commands hoisted in
   * main.ts (manual/break: discordx decorators rebound; login: system
   * behavior). The runtime check below also asks the live bot what
   * application commands it owns and merges those names in, so guild-
   * scoped discordx commands like `picture-only-channel`, `todo-channel`,
   * `role-emoji`, `rcon-forward-channel` are caught automatically as
   * the cache fills — without needing this list to be hand-maintained.
   */
  private static readonly RESERVED_COMMAND_NAMES_STATIC = new Set([
    "manual",
    "break",
    "login",
  ]);

  /**
   * Compute the live "names plugins can't use" set. Pulls every
   * application command currently known to the bot client (global +
   * each cached guild's commands), unions in the static fallback,
   * and excludes commands previously persisted as belonging to the
   * same plugin (otherwise a plugin couldn't re-register its own
   * /account because the live cache already shows /account).
   *
   * Returns a fresh Set each call so concurrent registers don't share
   * mutation, and the cost (~few dozen string lookups) is trivial.
   */
  private async buildReservedCommandNames(
    excludePluginId: number,
  ): Promise<Set<string>> {
    const reserved = new Set(
      PluginCommandRegistry.RESERVED_COMMAND_NAMES_STATIC,
    );
    const ownNames = new Set<string>();
    try {
      const own = await findPluginCommandsByPlugin(excludePluginId);
      for (const r of own) ownNames.add(r.name);
    } catch {
      // findPluginCommandsByPlugin only fails on DB outage; the
      // collision check below would also fail — let downstream surface
      // the real error instead of crashing here.
    }
    const bot = this.getBot();
    if (!bot || !bot.application) {
      for (const n of ownNames) reserved.delete(n);
      return reserved;
    }
    for (const cmd of bot.application.commands.cache.values()) {
      if (typeof cmd.name === "string") reserved.add(cmd.name);
    }
    for (const guild of bot.guilds.cache.values()) {
      for (const cmd of guild.commands.cache.values()) {
        if (typeof cmd.name === "string") reserved.add(cmd.name);
      }
    }
    for (const n of ownNames) reserved.delete(n);
    return reserved;
  }

  /**
   * Refuse to register a plugin if its manifest commands collide
   * with another plugin's, or with a reserved bot-internal command.
   * Called from PluginRegistry.register BEFORE the plugin row is
   * upserted, so on rejection nothing is persisted and the plugin
   * retries with a corrected manifest.
   */
  async assertNoCollisions(
    incomingPluginKey: string,
    incomingPluginId: number,
    manifest: PluginManifest,
  ): Promise<void> {
    const reserved = await this.buildReservedCommandNames(incomingPluginId);
    for (const cmd of manifest.commands ?? []) {
      if (reserved.has(cmd.name)) {
        throw new ManifestCommandError(
          `command '${cmd.name}' is reserved for bot internals; ` +
            `'${incomingPluginKey}' must rename it`,
        );
      }
    }
    for (const cmd of manifest.commands ?? []) {
      const guildIds: Array<string | null> = [];
      // Phase 1.5: 'guild' scope means "every guild the bot is in"
      // — but we can't fan out per-guild rows at register time
      // because we don't know the guild list (bot may not be ready).
      // Treat both scopes as global at the persistence layer; later
      // reconcileAll re-applies them per-guild.
      if (cmd.scope === "guild") {
        guildIds.push(null);
      } else {
        guildIds.push(null);
      }
      for (const gid of guildIds) {
        const collisions = await findCommandCollisions(incomingPluginId, {
          name: cmd.name,
          guildId: gid,
        });
        if (collisions.length > 0) {
          const owner = collisions[0];
          throw new ManifestCommandError(
            `command '${cmd.name}' already registered by another plugin (id=${owner.pluginId}); ` +
              `'${incomingPluginKey}' must rename or remove it`,
          );
        }
      }
    }
  }

  /**
   * Register every command in the manifest with Discord and persist
   * the resulting command IDs. Idempotent: re-running on the same
   * plugin updates Discord-side definitions (description / options
   * changed) and refreshes the discordCommandId.
   *
   * Failures are logged per-command but don't throw — a bad option
   * in one command shouldn't kill the rest of the manifest.
   */
  async sync(plugin: PluginRow, manifest: PluginManifest): Promise<void> {
    const bot = this.getBot();
    if (!bot || !bot.application) {
      botEventLog.record(
        "warn",
        "bot",
        `plugin-commands: bot not ready, skipping sync for ${plugin.pluginKey}`,
        { pluginId: plugin.id },
      );
      return;
    }
    const declared = manifest.commands ?? [];
    const existing = await findPluginCommandsByPlugin(plugin.id);
    const existingByName = new Map(existing.map((r) => [r.name, r]));

    for (const cmd of declared) {
      let data: ApplicationCommandData;
      try {
        data = manifestToApplicationCommand(cmd);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        botEventLog.record(
          "warn",
          "bot",
          `plugin-commands: '${plugin.pluginKey}' command '${cmd.name}' invalid: ${msg}`,
          { pluginId: plugin.id, cmd: cmd.name },
        );
        continue;
      }
      try {
        // Phase 1.5: register every plugin command globally regardless
        // of cmd.scope. global commands are available in every guild
        // automatically, simpler than fanning out per-guild creates
        // and dealing with cache lag. cmd.scope='guild' is honored in
        // a future iteration when we have per-feature-per-guild
        // wiring.
        const created = await bot.application.commands.create(data);
        await upsertPluginCommand({
          pluginId: plugin.id,
          guildId: null,
          name: cmd.name,
          discordCommandId: created.id,
          manifestJson: JSON.stringify(cmd),
        });
        existingByName.delete(cmd.name);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        botEventLog.record(
          "warn",
          "bot",
          `plugin-commands: Discord create failed for '${plugin.pluginKey}/${cmd.name}': ${msg}`,
          { pluginId: plugin.id, cmd: cmd.name },
        );
      }
    }
    // Anything left in existingByName was registered last time but is
    // gone from the manifest now — delete from Discord and from our
    // table.
    for (const stale of existingByName.values()) {
      await this.deleteOne(stale);
    }
  }

  /**
   * Remove every plugin command registered with Discord and clear
   * the persistence rows. Used on plugin disable / unregister.
   */
  async unregisterAll(pluginId: number): Promise<void> {
    const rows = await findPluginCommandsByPlugin(pluginId);
    for (const r of rows) {
      await this.deleteOne(r);
    }
    await deletePluginCommandsByPlugin(pluginId);
  }

  /**
   * Walk all active+enabled plugins and re-sync their commands.
   * Called once on bot ready after discordx finished its own boot
   * sync — gives plugins their commands back even if they registered
   * before the last bot restart.
   */
  async reconcileAll(): Promise<void> {
    const bot = this.getBot();
    if (!bot || !bot.application) return;
    const plugins = await findAllPlugins();
    for (const plugin of plugins) {
      if (!plugin.enabled || plugin.status !== "active") {
        // Plugin was disabled or never came back. Strip its commands
        // from Discord so users don't see ghosts they can't invoke.
        await this.unregisterAll(plugin.id);
        continue;
      }
      const manifest = parseManifest(plugin);
      if (!manifest) continue;
      await this.sync(plugin, manifest);
    }
    botEventLog.record(
      "info",
      "bot",
      `plugin-commands: reconcile complete (${plugins.length} plugins)`,
    );
  }

  private async deleteOne(row: PluginCommandRow): Promise<void> {
    const bot = this.getBot();
    if (!bot || !bot.application) return;
    if (!row.discordCommandId) return;
    try {
      if (row.guildId) {
        const guild = bot.guilds.cache.get(row.guildId);
        if (guild) await guild.commands.delete(row.discordCommandId);
      } else {
        await bot.application.commands.delete(row.discordCommandId);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // 404 is fine (command already gone); other errors get logged
      // but don't throw — we still want to drop the DB row.
      botEventLog.record(
        "warn",
        "bot",
        `plugin-commands: Discord delete '${row.name}' failed: ${msg}`,
        { pluginId: row.pluginId, cmd: row.name },
      );
    }
  }
}

function parseManifest(plugin: PluginRow): PluginManifest | null {
  try {
    return JSON.parse(plugin.manifestJson) as PluginManifest;
  } catch {
    return null;
  }
}

// Module-level singleton + setter. main.ts wires the bot client in
// after discordx is ready; before that, getBot() returns null and
// every Discord-touching method short-circuits.
let _botClient: import("discordx").Client | null = null;
export function setPluginCommandBotClient(
  client: import("discordx").Client,
): void {
  _botClient = client;
}
export const pluginCommandRegistry = new PluginCommandRegistry(
  () => _botClient,
);
