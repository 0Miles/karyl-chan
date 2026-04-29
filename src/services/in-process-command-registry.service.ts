import {
  type ApplicationCommandData,
  type Client,
  type ChatInputCommandInteraction,
  type Guild,
  type Interaction,
  type ModalSubmitInteraction,
} from "discord.js";
import { botEventLog } from "../web/bot-event-log.js";
import { shouldRecord } from "../web/bot-event-dedup.js";

/**
 * In-process slash-command + modal registry.
 *
 * The bot has three command surfaces: plugin manifests, behavior
 * trigger=slash_command, and "in-process" features baked into the bot
 * binary (picture-only-channel / role-emoji / todo-channel /
 * rcon-forward-channel). Plugins + behaviors already manage their own
 * lifecycle (plugin-command-registry / dm-slash-rebind). Until now the
 * in-process surface used discordx decorators; this registry replaces
 * that — featuRes/commands declare specs through `register*` calls and
 * the registry handles Discord sync + interaction routing.
 *
 * Why our own registry instead of decorators:
 *   - We already do per-domain registries (plugin / behavior); a third
 *     decorator-driven path would be the odd one out.
 *   - Decorators hide the wiring; explicit register calls show every
 *     handler at the boot site.
 *   - Removes reflect-metadata / @discordx/importer dependencies.
 *
 * Scope discipline:
 *   - One spec → one handler. Subcommands are wired through the same
 *     handler with a switch on `interaction.options.getSubcommand()`.
 *   - Modal handlers are keyed by customId prefix, NOT exact equality —
 *     callers can encode args in the customId tail.
 *   - This registry does NOT know about plugins / behaviors / system
 *     commands; its dispatchInteraction returns false on unknown names
 *     so the caller can fall through.
 */

interface CommandSpec {
  data: ApplicationCommandData;
  /** Where Discord registers the command. */
  scope: "global" | "guild";
  /** Routed when the chat-input command fires. */
  handler: (interaction: ChatInputCommandInteraction) => Promise<void>;
}

interface ModalEntry {
  /**
   * The handler runs whenever interaction.customId starts with this
   * exact string. Pick something specific enough to not collide with
   * plugin component customIds (plugins are advised to use a
   * `<plugin_key>:` prefix in the plugin-architecture review).
   */
  prefix: string;
  handler: (interaction: ModalSubmitInteraction) => Promise<void>;
}

const commands = new Map<string, CommandSpec>();
const modals: ModalEntry[] = [];

/**
 * Register an in-process slash command. Calling with the same `name`
 * twice replaces the earlier entry (intentional — keeps hot-reload
 * during dev sane and lets a feature redefine itself if it has to).
 */
export function registerInProcessCommand(spec: CommandSpec): void {
  commands.set(spec.data.name, spec);
}

/** Register a modal-submit handler keyed by customId prefix. */
export function registerInProcessModal(entry: ModalEntry): void {
  modals.push(entry);
}

/** For tests + assertions; production code should not iterate this. */
export function _listInProcessCommands(): ReadonlyArray<CommandSpec> {
  return [...commands.values()];
}

/**
 * Push every registered spec to Discord. Global specs go to
 * `bot.application.commands.set(...)` once; guild specs fan out across
 * every guild the bot is currently in. Replaces the discordx
 * `bot.initApplicationCommands()` call site.
 *
 * Idempotent: calling twice with no spec changes is a no-op (Discord
 * dedups by name on `set`).
 */
export async function syncInProcessCommandsToDiscord(
  bot: Client,
): Promise<void> {
  if (!bot.application) return;

  const globalSpecs: ApplicationCommandData[] = [];
  const guildSpecs: ApplicationCommandData[] = [];
  for (const spec of commands.values()) {
    if (spec.scope === "global") globalSpecs.push(spec.data);
    else guildSpecs.push(spec.data);
  }

  // Globals via application-level set (replaces full list — but our
  // plugin commands ALSO live as globals and are registered separately
  // via plugin-command-registry → dm-slash-rebind, which use create()
  // not set(). To avoid wiping those, use create() per spec here too.
  // Discord deduplicates by name + scope, so create() acts as upsert.
  for (const data of globalSpecs) {
    try {
      await bot.application.commands.create(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      botEventLog.record(
        "warn",
        "bot",
        `in-process: global '${data.name}' register failed: ${msg}`,
      );
    }
  }

  if (guildSpecs.length === 0) return;
  for (const guild of bot.guilds.cache.values()) {
    await syncGuildSpecsForGuild(guild, guildSpecs);
  }
}

/**
 * Per-guild push for the guild-scoped specs. Used by the bot's
 * guildCreate handler so a freshly-joined guild gets the full set.
 */
export async function syncInProcessCommandsForGuild(
  guild: Guild,
): Promise<void> {
  const guildSpecs: ApplicationCommandData[] = [];
  for (const spec of commands.values()) {
    if (spec.scope === "guild") guildSpecs.push(spec.data);
  }
  if (guildSpecs.length === 0) return;
  await syncGuildSpecsForGuild(guild, guildSpecs);
}

async function syncGuildSpecsForGuild(
  guild: Guild,
  guildSpecs: ApplicationCommandData[],
): Promise<void> {
  for (const data of guildSpecs) {
    try {
      await guild.commands.create(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (shouldRecord(`in-process-cmd:${guild.id}:${data.name}`)) {
        botEventLog.record(
          "warn",
          "bot",
          `in-process: guild ${guild.id} '${data.name}' register failed: ${msg}`,
        );
      }
    }
  }
}

/**
 * Try to route an inbound interaction to an in-process command or
 * modal handler. Returns true when a handler claimed the interaction;
 * the caller should not fall through. Returns false when no handler
 * matched (caller should try plugin / discordx / etc.).
 */
export async function dispatchInProcessInteraction(
  interaction: Interaction,
): Promise<boolean> {
  if (interaction.isChatInputCommand()) {
    const spec = commands.get(interaction.commandName);
    if (!spec) return false;
    try {
      await spec.handler(interaction);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      botEventLog.record(
        "error",
        "feature",
        `in-process command '${interaction.commandName}' threw: ${msg}`,
        { commandName: interaction.commandName, userId: interaction.user.id },
      );
      // Best-effort error reply if we haven't already replied — keeps
      // the interaction from hanging on "loading…".
      if (!interaction.replied && !interaction.deferred) {
        await interaction
          .reply({ content: "⚠ 指令處理失敗", flags: "Ephemeral" })
          .catch(() => {});
      }
    }
    return true;
  }
  if (interaction.isModalSubmit()) {
    const entry = modals.find((m) => interaction.customId.startsWith(m.prefix));
    if (!entry) return false;
    try {
      await entry.handler(interaction);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      botEventLog.record(
        "error",
        "feature",
        `in-process modal '${interaction.customId}' threw: ${msg}`,
        { customId: interaction.customId, userId: interaction.user.id },
      );
      if (!interaction.replied) {
        await interaction
          .reply({ content: "⚠ 表單處理失敗", flags: "Ephemeral" })
          .catch(() => {});
      }
    }
    return true;
  }
  return false;
}

/** Test-only — clear all registered handlers between tests. */
export function _resetInProcessRegistry(): void {
  commands.clear();
  modals.length = 0;
}
