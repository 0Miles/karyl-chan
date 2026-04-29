import {
  type ApplicationCommandData,
  type Client,
  type ChatInputCommandInteraction,
  type Guild,
  type Interaction,
  type ModalSubmitInteraction,
} from "discord.js";
import { botEventLog } from "../bot-events/bot-event-log.js";
import { shouldRecord } from "../bot-events/bot-event-dedup.js";
import {
  findAllStateRows,
  resolveBuiltinFeatureEnabled,
} from "../feature-toggle/models/bot-feature-state.model.js";

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
  /**
   * Built-in feature key that owns this command (e.g. "voice",
   * "picture-only"). When set, the command is registered per-guild
   * conditionally on the matching bot-feature-state row — disabling
   * the feature in a guild deletes the slash from that guild only.
   * Unset = legacy "always register everywhere" behaviour.
   */
  featureKey?: string;
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
  // Build a snapshot of feature-state rows once; lookup table keyed
  // by `${featureKey}::${guildId|null}` lets the per-guild loop
  // resolve enabled-ness without round-tripping DB N×M times.
  const stateLookup = await buildStateLookup();
  for (const guild of bot.guilds.cache.values()) {
    await syncGuildSpecsRespectingState(
      guild,
      [...commands.values()].filter((s) => s.scope === "guild"),
      stateLookup,
    );
  }
}

/**
 * Per-guild push for the guild-scoped specs. Used by the bot's
 * guildCreate handler so a freshly-joined guild gets the full set —
 * but only the ones that aren't disabled by feature-state for this
 * guild (or by the operator default).
 */
export async function syncInProcessCommandsForGuild(
  guild: Guild,
): Promise<void> {
  const guildScopedSpecs = [...commands.values()].filter(
    (s) => s.scope === "guild",
  );
  if (guildScopedSpecs.length === 0) return;
  const stateLookup = await buildStateLookup();
  await syncGuildSpecsRespectingState(guild, guildScopedSpecs, stateLookup);
}

interface StateLookup {
  /** Resolves `(featureKey, guildId)` → enabled. */
  resolve(featureKey: string | undefined, guildId: string): boolean;
}

/**
 * Snapshot the bot_feature_state table into a lookup object.
 * resolve() encodes the precedence:
 *   per-guild row > default row (guildId=null) > true (legacy default)
 * Specs without featureKey always resolve to true so legacy commands
 * (none today, but leave the door open) keep working.
 */
async function buildStateLookup(): Promise<StateLookup> {
  let rows;
  try {
    rows = await findAllStateRows();
  } catch (err) {
    botEventLog.record(
      "warn",
      "bot",
      `in-process: failed to load feature state: ${err instanceof Error ? err.message : String(err)}; defaulting all enabled`,
    );
    return {
      resolve: () => true,
    };
  }
  const perGuild = new Map<string, boolean>(); // key: featureKey::guildId
  const defaults = new Map<string, boolean>(); // key: featureKey
  for (const r of rows) {
    if (r.guildId === null) defaults.set(r.featureKey, r.enabled);
    else perGuild.set(`${r.featureKey}::${r.guildId}`, r.enabled);
  }
  return {
    resolve(featureKey: string | undefined, guildId: string): boolean {
      if (!featureKey) return true;
      const pg = perGuild.get(`${featureKey}::${guildId}`);
      if (pg !== undefined) return pg;
      const def = defaults.get(featureKey);
      if (def !== undefined) return def;
      return true;
    },
  };
}

/**
 * Push the guild-scoped specs into a single guild, but consult the
 * state lookup first. Disabled specs are actively deleted (in case
 * a previous boot left them in Discord) — sync ≠ "create-only".
 */
async function syncGuildSpecsRespectingState(
  guild: Guild,
  specs: CommandSpec[],
  stateLookup: StateLookup,
): Promise<void> {
  const toCreate: ApplicationCommandData[] = [];
  const toDeleteNames = new Set<string>();
  for (const spec of specs) {
    const enabled = stateLookup.resolve(spec.featureKey, guild.id);
    if (enabled) toCreate.push(spec.data);
    else toDeleteNames.add(spec.data.name);
  }
  // Create / upsert enabled.
  for (const data of toCreate) {
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
  // Delete disabled (only if Discord still has them).
  if (toDeleteNames.size === 0) return;
  let live;
  try {
    live = await guild.commands.fetch();
  } catch (err) {
    if (shouldRecord(`in-process-fetch:${guild.id}`)) {
      const msg = err instanceof Error ? err.message : String(err);
      botEventLog.record(
        "warn",
        "bot",
        `in-process: fetch ${guild.id} commands failed: ${msg}`,
      );
    }
    return;
  }
  for (const cmd of live.values()) {
    if (!toDeleteNames.has(cmd.name)) continue;
    try {
      await cmd.delete();
    } catch (err) {
      if (shouldRecord(`in-process-del:${guild.id}:${cmd.name}`)) {
        const msg = err instanceof Error ? err.message : String(err);
        botEventLog.record(
          "warn",
          "bot",
          `in-process: guild ${guild.id} delete '${cmd.name}' failed: ${msg}`,
        );
      }
    }
  }
}

/**
 * Toggle a built-in feature's slash command(s) on/off for a single
 * guild. Called by the admin /api/bot-features/state PUT handler so
 * disabling a feature in a guild also removes its slash from that
 * guild's command picker (instead of leaving an active command that
 * silently no-ops).
 *
 * `enabled === true`  → guild.commands.create for every CommandSpec
 *                       whose featureKey matches.
 * `enabled === false` → fetch the guild's command list, delete any
 *                       whose name matches one of those specs.
 */
export async function applyFeatureGuildToggle(
  bot: Client,
  featureKey: string,
  guildId: string,
  enabled: boolean,
): Promise<void> {
  // Cache may not be hydrated yet (admin hits the toggle during boot,
  // bot rejoined a guild after a restart, etc). Fall back to a one-off
  // fetch before giving up.
  let guild = bot.guilds.cache.get(guildId);
  if (!guild) {
    try {
      guild = await bot.guilds.fetch(guildId);
    } catch {
      guild = undefined;
    }
  }
  if (!guild) {
    botEventLog.record(
      "warn",
      "bot",
      `applyFeatureGuildToggle: guild ${guildId} not reachable`,
      { featureKey, guildId },
    );
    return;
  }
  const matching = [...commands.values()].filter(
    (s) => s.featureKey === featureKey,
  );
  if (matching.length === 0) return;
  if (enabled) {
    for (const spec of matching) {
      try {
        await guild.commands.create(spec.data);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        botEventLog.record(
          "warn",
          "bot",
          `applyFeatureGuildToggle: register '${spec.data.name}' in ${guildId} failed: ${msg}`,
          { featureKey, guildId, command: spec.data.name },
        );
      }
    }
    return;
  }
  // Disable path — delete by name. Fetch live so we get accurate ids
  // even if our in-memory map is stale.
  let live;
  try {
    live = await guild.commands.fetch();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    botEventLog.record(
      "warn",
      "bot",
      `applyFeatureGuildToggle: fetch commands ${guildId} failed: ${msg}`,
      { featureKey, guildId },
    );
    return;
  }
  const targetNames = new Set(matching.map((s) => s.data.name));
  for (const cmd of live.values()) {
    if (!targetNames.has(cmd.name)) continue;
    try {
      await cmd.delete();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      botEventLog.record(
        "warn",
        "bot",
        `applyFeatureGuildToggle: delete '${cmd.name}' in ${guildId} failed: ${msg}`,
        { featureKey, guildId, command: cmd.name },
      );
    }
  }
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
    // Defense in depth: even if Discord still routes a slash for a
    // disabled feature (cached client picker, slow propagation after
    // /api/bot-features/state PUT), refuse to run the handler.
    if (spec.featureKey && interaction.guildId) {
      const enabled = await resolveBuiltinFeatureEnabled(
        spec.featureKey,
        interaction.guildId,
      );
      if (!enabled) {
        await interaction
          .reply({
            content: `⚠ 此伺服器已停用 \`${spec.featureKey}\` 功能。`,
            flags: "Ephemeral",
          })
          .catch(() => {});
        return true;
      }
    }
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
