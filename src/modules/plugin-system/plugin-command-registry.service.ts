import type { Client } from "discord.js";
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
  deletePluginCommandRow,
  deletePluginCommandsByPlugin,
  findCommandCollisions,
  findPluginCommandsByFeature,
  findPluginCommandsByPlugin,
  upsertPluginCommand,
  type PluginCommandRow,
} from "./models/plugin-command.model.js";
import { findFeatureRowsByPlugin } from "../feature-toggle/models/plugin-guild-feature.model.js";
import { findAllPlugins, type PluginRow } from "./models/plugin.model.js";
import { botEventLog } from "../bot-events/bot-event-log.js";
import { findEnabledSlashCommandNames } from "../behavior/models/behavior.model.js";
import type {
  ManifestCommand,
  ManifestCommandOption,
  ManifestPluginCommandV2,
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

export function manifestOptionToData(
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
   * CR-4（v2）：額外查詢 behaviors 表中 triggerType='slash_command' 且
   * enabled=1 的 slashCommandName，避免 plugin command 與 behavior slash
   * trigger 名稱碰撞。
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

    // CR-4：從 behaviors 表動態載入 slash trigger names
    try {
      const behaviorSlashNames = await findEnabledSlashCommandNames();
      for (const n of behaviorSlashNames) reserved.add(n);
    } catch {
      // DB outage fallback：跳過 behavior 防撞，讓下游顯示真實錯誤
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
   *
   * v2：讀取 manifest.plugin_commands[]（v1 manifest.commands[] 已廢棄）。
   */
  async assertNoCollisions(
    incomingPluginKey: string,
    incomingPluginId: number,
    manifest: PluginManifest,
  ): Promise<void> {
    // v2：plugin_commands[]；v1 fallback：commands[]（已廢棄，v1 manifest 不應到此）
    const incomingCommands: Array<{ name: string }> = [
      ...(manifest.plugin_commands ?? []),
      ...(manifest.commands ?? []),
    ];

    const reserved = await this.buildReservedCommandNames(incomingPluginId);
    for (const cmd of incomingCommands) {
      if (reserved.has(cmd.name)) {
        throw new ManifestCommandError(
          `command '${cmd.name}' is reserved for bot internals or conflicts with an existing behavior slash trigger; ` +
            `'${incomingPluginKey}' must rename it`,
        );
      }
    }
    for (const cmd of incomingCommands) {
      const collisions = await findCommandCollisions(incomingPluginId, {
        name: cmd.name,
        // Treat both scopes as global at the persistence layer;
        // reconcileAll re-applies them per-guild.
        guildId: null,
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
    // M1-C2（軌三移交）：global commands（manifest.plugin_commands[] / commands[]）
    // 不再由此服務直接向 Discord 登記。軌三 global 指令由 CommandReconciler.reconcileAll()
    // 接管（C-runtime §6.3，§3.2 步驟 1b）。
    // 此處只維護 DB 中的 plugin_commands rows（featureKey=null），讓 CommandReconciler
    // 能查詢到完整 desired set。
    // DB upsert（不呼叫 Discord API）：
    const globalCommands: Array<ManifestCommand | ManifestPluginCommandV2> = [
      ...(manifest.plugin_commands ?? []),
      ...(manifest.commands ?? []),
    ];
    const existing = await findPluginCommandsByPlugin(plugin.id);
    // Two halves of `existing` to reconcile separately:
    //   - global rows (featureKey null, guildId null)
    //   - feature rows (featureKey non-null, guildId per-guild)
    // Track each row so anything not re-registered this pass becomes
    // stale and gets cleaned at the end.
    const stale = new Map(existing.map((r) => [r.id, r]));

    // ── Top-level (truly global) commands：DB only（Discord 由 CommandReconciler 管）
    // M1-C2：軌三 global 指令 Discord 登記改由 CommandReconciler.reconcileAll() 接管。
    // 此處只維護 DB rows（featureKey=null），discordCommandId 暫設 null。
    // CommandReconciler 呼叫 Discord API 後不回寫 discordCommandId（已知限制）。
    // 後果：unregisterAll() 的 deleteOne() 無法用 discordCommandId 刪 Discord 端指令，
    // 需依賴 CommandReconciler 的 stale 清除機制（reconciler_owned_commands 名冊）補位。
    // TODO M1-D/F：CommandReconciler.applyOne() 在 create 後回寫 plugin_commands.discordCommandId。
    for (const cmd of globalCommands) {
      try {
        const upserted = await upsertPluginCommand({
          pluginId: plugin.id,
          guildId: null,
          name: cmd.name,
          discordCommandId: null,
          featureKey: null,
          manifestJson: JSON.stringify(cmd),
        });
        stale.delete(upserted.id);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        botEventLog.record(
          "warn",
          "bot",
          `plugin-commands: DB upsert failed for '${plugin.pluginKey}/${cmd.name}': ${msg}`,
          { pluginId: plugin.id, cmd: cmd.name },
        );
      }
    }

    // ── Per-feature commands ─────────────────────────────────────
    // For each feature with declared commands, find which guilds have
    // that feature enabled (per plugin_guild_features), then register
    // the feature's commands into those guilds. Disabled-by-default +
    // no row = NOT enabled (stricter than "no row → fall through to
    // manifest default" because feature commands ride along with the
    // user's explicit on/off state — no row means the operator hasn't
    // chosen, default to OFF for command visibility).
    const featureRows = await findFeatureRowsByPlugin(plugin.id);
    const enabledByFeature = new Map<string, string[]>();
    for (const r of featureRows) {
      if (!r.enabled) continue;
      const list = enabledByFeature.get(r.featureKey) ?? [];
      list.push(r.guildId);
      enabledByFeature.set(r.featureKey, list);
    }
    for (const feature of manifest.guild_features ?? []) {
      const cmds = feature.commands ?? [];
      if (cmds.length === 0) continue;
      const enabledGuilds = enabledByFeature.get(feature.key) ?? [];
      for (const cmd of cmds) {
        const stalesForCmd = [...stale.values()].filter(
          (r) => r.featureKey === feature.key && r.name === cmd.name,
        );
        for (const guildId of enabledGuilds) {
          const upsertResult = await this.registerFeatureCommandInGuild(
            plugin,
            feature.key,
            guildId,
            cmd,
          );
          if (upsertResult) stale.delete(upsertResult.id);
        }
        // Stales for this (feature, name) pair: rows that exist but
        // the feature is no longer enabled in that guild — delete
        // (loop above only marks-not-stale guilds where feature is
        // currently enabled).
        void stalesForCmd; // walked into the final stale-cleanup
      }
    }

    // ── Cleanup: anything left in `stale` is a row that did not get
    // re-confirmed this pass (manifest dropped the command, feature
    // got disabled in that guild, etc.). Delete from Discord + DB.
    for (const r of stale.values()) {
      await this.deleteOne(r);
    }
  }

  /**
   * Register one feature command in one guild. Used by both `sync`
   * (initial walk) and the per-guild toggle hook (when admin flips a
   * feature on for a guild). Idempotent — discord.js create is upsert.
   */
  async registerFeatureCommandInGuild(
    plugin: PluginRow,
    featureKey: string,
    guildId: string,
    cmd: ManifestCommand,
  ): Promise<PluginCommandRow | null> {
    const bot = this.getBot();
    if (!bot) return null;
    const guild = bot.guilds.cache.get(guildId);
    if (!guild) {
      botEventLog.record(
        "warn",
        "bot",
        `plugin-commands: bot not in guild ${guildId}, skipping ${plugin.pluginKey}/${featureKey}/${cmd.name}`,
      );
      return null;
    }
    let data: ApplicationCommandData;
    try {
      data = manifestToApplicationCommand(cmd);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      botEventLog.record(
        "warn",
        "bot",
        `plugin-commands: '${plugin.pluginKey}/${featureKey}/${cmd.name}' invalid: ${msg}`,
        { pluginId: plugin.id, featureKey, cmd: cmd.name },
      );
      return null;
    }
    try {
      const created = await guild.commands.create(data);
      return upsertPluginCommand({
        pluginId: plugin.id,
        guildId,
        name: cmd.name,
        discordCommandId: created.id,
        featureKey,
        manifestJson: JSON.stringify(cmd),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      botEventLog.record(
        "warn",
        "bot",
        `plugin-commands: Discord create (guild ${guildId}) failed for '${plugin.pluginKey}/${featureKey}/${cmd.name}': ${msg}`,
        { pluginId: plugin.id, featureKey, guildId, cmd: cmd.name },
      );
      return null;
    }
  }

  /**
   * Hook for the per-guild feature toggle. Called when admin flips
   * `plugin_guild_features.enabled` for a (pluginId, guildId,
   * featureKey) — pushes the corresponding feature commands to (or
   * deletes them from) that guild's Discord application command list.
   */
  async syncFeatureCommandsForGuild(
    plugin: PluginRow,
    featureKey: string,
    guildId: string,
    enabled: boolean,
    manifest: PluginManifest,
  ): Promise<void> {
    const feature = manifest.guild_features?.find((f) => f.key === featureKey);
    const cmds = feature?.commands ?? [];
    if (cmds.length === 0) return;
    if (enabled) {
      for (const cmd of cmds) {
        await this.registerFeatureCommandInGuild(
          plugin,
          featureKey,
          guildId,
          cmd,
        );
      }
    } else {
      // Find every row we registered for (plugin, feature) that lives
      // in this guild and delete it. Rows for other guilds keep their
      // state; we only care about this single guild's worth.
      const rows = await findPluginCommandsByFeature(plugin.id, featureKey);
      for (const r of rows) {
        if (r.guildId === guildId) await this.deleteOne(r);
      }
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
    // Belt-and-braces: deleteOne removes each row individually, but if
    // any row was missing a discordCommandId and we early-returned
    // halfway, the DB might still have ghosts. Sweep the table.
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
    if (bot && bot.application && row.discordCommandId) {
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
    // Always drop the DB row so the next reconcile doesn't re-walk
    // a stale entry. (deleteOne is also called from cleanup paths
    // where the Discord side may already be gone.)
    await deletePluginCommandRow(row.id);
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
// after the gateway is ready; before that, getBot() returns null and
// every Discord-touching method short-circuits.
let _botClient: Client | null = null;
export function setPluginCommandBotClient(client: Client): void {
  _botClient = client;
}
export const pluginCommandRegistry = new PluginCommandRegistry(
  () => _botClient,
);
