import {
  approvePluginScopes,
  expireStalePlugins,
  findAllPlugins,
  findPluginById,
  findPluginByKey,
  setPluginEnabled as setEnabledModel,
  setPluginDispatchHmacKey,
  touchHeartbeat,
  upsertPluginRegistration,
  type PluginRow,
} from "./models/plugin.model.js";
import { config } from "../../config.js";
import { pluginAuthStore, PluginAuthStore } from "./plugin-auth.service.js";
import { botEventLog } from "../bot-events/bot-event-log.js";
import { moduleLogger } from "../../logger.js";
import { rebuildEventIndex } from "./plugin-event-bridge.service.js";
import {
  ManifestCommandError,
  pluginCommandRegistry,
} from "./plugin-command-registry.service.js";
import {
  assertPluginTarget,
  HostPolicyError,
} from "../../utils/host-policy.js";
import { randomBytes } from "crypto";

const log = moduleLogger("plugin-registry");

/**
 * Plugin lifecycle owner. Sits between the HTTP layer (plugin-routes)
 * and the model layer (plugin.model). Holds:
 *   - the heartbeat reaper interval
 *   - cached parsed manifests for fast event-dispatch path
 *   - the wiring to revoke tokens on admin disable / on stale-out
 *
 * Manifest schema validation is done here too — we'd rather fail a
 * registration with a clear error than store a malformed manifest
 * that breaks event dispatch later.
 */

// A plugin must heartbeat at least this often, otherwise we mark it
// inactive and stop dispatching events to it. Tuned 2× the plugin's
// own 30s heartbeat cadence so a single missed beat doesn't trigger.
const HEARTBEAT_TIMEOUT_MS = config.plugin.heartbeatTimeoutMs;
const REAPER_INTERVAL_MS = config.plugin.reaperIntervalMs;

export interface ManifestCommandOption {
  type: string;
  name: string;
  description?: string;
  required?: boolean;
  channel_types?: string[];
  options?: ManifestCommandOption[];
  choices?: Array<{ name: string; value: string | number }>;
}

export interface ManifestCommand {
  name: string;
  description: string;
  scope?: "guild" | "global";
  default_member_permissions?: string;
  default_ephemeral?: boolean;
  required_capability?: string;
  dm_permission?: boolean;
  /**
   * Discord interaction context restriction. Modern replacement for
   * `dm_permission`. Set to e.g. ["BotDM","PrivateChannel"] for a
   * DM-only command, or ["Guild","BotDM","PrivateChannel"] to allow
   * everywhere. When omitted, Discord's default ([Guild]) applies.
   */
  contexts?: ("Guild" | "BotDM" | "PrivateChannel")[];
  /**
   * Where the bot can be installed for this command to be visible.
   * "guild_install" = traditional bot-in-server install,
   * "user_install" = personal-attach install. Most plugins want
   * ["guild_install","user_install"] so DM commands work when the
   * user has user-installed the bot. When omitted, Discord defaults
   * to ["guild_install"] only.
   */
  integration_types?: ("guild_install" | "user_install")[];
  options?: ManifestCommandOption[];
}

export interface ManifestConfigField {
  key: string;
  type:
    | "text"
    | "textarea"
    | "number"
    | "boolean"
    | "select"
    | "channel"
    | "role"
    | "user"
    | "url"
    | "secret"
    | "regex";
  label: string;
  description?: string;
  required?: boolean;
  default?: unknown;
  options?: Array<{ value: string; label: string }>;
}

export interface ManifestGuildFeature {
  key: string;
  name: string;
  icon?: string;
  description?: string;
  enabled_by_default?: boolean;
  events_subscribed?: string[];
  config_schema?: ManifestConfigField[];
  surfaces?: string[];
  overview_metrics?: Array<{ key: string; label: string; type: string }>;
  /**
   * Slash commands that belong to this guild_feature. They register
   * per-guild and are gated by the same per-guild toggle that
   * controls the feature itself — toggle off → commands deleted from
   * Discord for that guild; toggle on → commands re-registered.
   *
   * This is distinct from top-level `manifest.commands[]`, which
   * register globally and stay visible regardless of any per-guild
   * feature state.
   */
  commands?: ManifestCommand[];
}

/**
 * @deprecated v1 dm_behaviors[]. v2 請改用 behaviors[]（ManifestBehaviorV2）。
 * 保留以不破壞舊 manifest 的 JSON.parse 型別轉換；v1 manifest 在 validateManifest 已被拒絕。
 */
export interface ManifestDmBehavior {
  key: string;
  name: string;
  description?: string;
  supports_continuous?: boolean;
  config_schema?: ManifestConfigField[];
}

/**
 * v2 軌二：behaviors[]（webhook 接口層）。
 * 三軸（scope/integration_types/contexts）不在 manifest 寫，由 admin 設定。
 */
export interface ManifestBehaviorV2 {
  /** 唯一識別鍵，在 plugin 內不重複。 */
  key: string;
  name: string;
  description?: string;
  /**
   * Webhook 接收路徑（相對於 plugin.url）。
   * 必須以 `/` 開頭，同 plugin 內必須唯一（V-09）。
   */
  webhook_path: string;
  slashHints?: {
    suggested_name?: string;
    suggested_description?: string;
    options?: ManifestCommandOption[];
  };
  config_schema?: ManifestConfigField[];
  supports_continuous?: boolean;
}

/**
 * v2 軌三：plugin_commands[]（plugin 鎖死三軸，admin 只能 on/off）。
 */
export interface ManifestPluginCommandV2 {
  /** Discord slash command name，格式 [a-z0-9][a-z0-9-]{0,31}。 */
  name: string;
  /** 必填，非空字串（V-05）。 */
  description: string;
  /** V-06：必須是 "guild" 或 "global"。 */
  scope: "guild" | "global";
  /** V-07：必須是合法子集。 */
  integration_types: Array<"guild_install" | "user_install">;
  /** V-08：必須是合法子集。 */
  contexts: Array<"Guild" | "BotDM" | "PrivateChannel">;
  options?: ManifestCommandOption[];
  default_member_permissions?: string;
  default_ephemeral?: boolean;
  required_capability?: string;
}

export interface PluginManifest {
  schema_version: string;
  plugin: {
    id: string;
    name: string;
    version: string;
    description?: string;
    author?: string;
    homepage?: string;
    url: string;
    healthcheck_path?: string;
  };
  rpc_methods_used?: string[];
  storage?: {
    guild_kv?: boolean;
    guild_kv_quota_kb?: number;
    requires_secrets?: boolean;
  };
  /**
   * Plugin-level config that the operator can edit from the admin UI.
   * Values persist in the `plugin_configs` table.
   */
  config_schema?: ManifestConfigField[];
  guild_features?: ManifestGuildFeature[];
  /** v2 軌二：behaviors（webhook 接口層）。 */
  behaviors?: ManifestBehaviorV2[];
  /** v2 軌三：plugin 自訂指令（三軸寫死）。 */
  plugin_commands?: ManifestPluginCommandV2[];
  /**
   * @deprecated v1 欄位，v2 改用 behaviors[]。
   * 保留型別以不破壞 manifestJson 的 JSON.parse；validateManifest 不再接受含此欄位的 manifest。
   */
  dm_behaviors?: ManifestDmBehavior[];
  /**
   * @deprecated v1 欄位，v2 改用 plugin_commands[]。
   * 同上。
   */
  commands?: ManifestCommand[];
  events_subscribed_global?: string[];
  endpoints?: {
    events?: string;
    /** v2：取代 v1 的 command。 */
    plugin_command?: string;
    guild_feature_action?: string;
    /** @deprecated v1 欄位；v2 各 behavior 自帶 webhook_path。 */
    dm_behavior_dispatch?: string;
    /** @deprecated v1 欄位。 */
    command?: string;
  };
}

/**
 * Pure function: compute the new approved/pending scope sets given the
 * previous approved scopes and the newly declared scopes from the manifest.
 *
 * Rules:
 *   - Removed = prevApproved ∖ declared → auto-removed (no admin approval)
 *   - Added   = declared ∖ prevApproved → placed in pending
 *   - If autoApprove=true, added scopes go straight to approved (pending=[])
 *
 * Exported for unit testing.
 */
export function computeScopeDiff(
  prevApproved: string[],
  declared: string[],
  autoApprove: boolean,
): { approved: string[]; pending: string[] } {
  const declaredSet = new Set(declared);
  const prevApprovedSet = new Set(prevApproved);

  // Keep scopes that are still declared; auto-remove those that were removed.
  const stillApproved = prevApproved.filter((s) => declaredSet.has(s));

  // New scopes not previously approved.
  const added = declared.filter((s) => !prevApprovedSet.has(s));

  if (autoApprove) {
    return {
      approved: Array.from(new Set([...stillApproved, ...added])),
      pending: [],
    };
  }
  return { approved: stillApproved, pending: added };
}

export type ManifestValidation =
  | { ok: true; manifest: PluginManifest }
  | { ok: false; error: string };

/**
 * Validate a plugin manifest. v2 only: schema_version must be "2".
 * v1 manifests are rejected immediately with a clear error message.
 *
 * Implements V-01 ~ V-10 + V-C1 / V-C2 / V-C3 from B-sdk §4.
 */
export async function validateManifest(
  input: unknown,
): Promise<ManifestValidation> {
  if (!input || typeof input !== "object") {
    return { ok: false, error: "manifest must be an object" };
  }
  const m = input as Record<string, unknown>;

  // V-01：schema_version 必須是字串 "2"（不接受整數 2、不接受 "1"）
  if (m.schema_version !== "2") {
    return {
      ok: false,
      error:
        `unsupported schema_version (got ${JSON.stringify(m.schema_version)}, expected "2"). ` +
        `v1 manifests are no longer accepted. See migration guide.`,
    };
  }

  // V-02：plugin.id 格式
  const plugin = m.plugin as Record<string, unknown> | undefined;
  if (!plugin || typeof plugin !== "object") {
    return { ok: false, error: "manifest.plugin missing" };
  }
  for (const k of ["id", "name", "version", "url"] as const) {
    if (typeof plugin[k] !== "string" || (plugin[k] as string).length === 0) {
      return { ok: false, error: `manifest.plugin.${k} required` };
    }
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(plugin.id as string)) {
    return {
      ok: false,
      error: "manifest.plugin.id must match [a-z0-9][a-z0-9-]*",
    };
  }

  // V-03：plugin.url 必須是 http/https，通過 SSRF guard
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(plugin.url as string);
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      return { ok: false, error: "manifest.plugin.url must be http(s)" };
    }
  } catch {
    return { ok: false, error: "manifest.plugin.url is not a valid URL" };
  }
  const pluginPort = parsedUrl.port
    ? Number(parsedUrl.port)
    : parsedUrl.protocol === "https:"
      ? 443
      : 80;
  try {
    await assertPluginTarget(parsedUrl.hostname, pluginPort);
  } catch (err) {
    const msg =
      err instanceof HostPolicyError ? err.message : "Plugin 目標不被允許";
    return { ok: false, error: `manifest.plugin.url: ${msg}` };
  }

  // V-04：behaviors / plugin_commands / guild_features 若存在必須是 array
  for (const k of [
    "rpc_methods_used",
    "behaviors",
    "plugin_commands",
    "guild_features",
    "events_subscribed_global",
  ] as const) {
    if (m[k] !== undefined && !Array.isArray(m[k])) {
      return { ok: false, error: `manifest.${k} must be an array` };
    }
  }

  // ── behaviors[] 驗證（V-09、V-10）────────────────────────────────────────
  const behaviors = (m.behaviors as ManifestBehaviorV2[] | undefined) ?? [];
  const seenWebhookPaths = new Set<string>();
  for (let i = 0; i < behaviors.length; i++) {
    const b = behaviors[i];
    if (!b || typeof b !== "object") {
      return { ok: false, error: `behaviors[${i}] must be an object` };
    }
    if (!b.key || typeof b.key !== "string") {
      return { ok: false, error: `behaviors[${i}].key required` };
    }
    // V-09：webhook_path 必須以 / 開頭，不能為空；同 plugin 內必須唯一
    if (
      !b.webhook_path ||
      typeof b.webhook_path !== "string" ||
      !b.webhook_path.startsWith("/")
    ) {
      return {
        ok: false,
        error: `behaviors[${b.key}].webhook_path must be a non-empty string starting with "/"`,
      };
    }
    if (seenWebhookPaths.has(b.webhook_path)) {
      return {
        ok: false,
        error: `behaviors[${b.key}].webhook_path "${b.webhook_path}" is duplicated within the manifest (V-09)`,
      };
    }
    seenWebhookPaths.add(b.webhook_path);
    // V-10：slashHints.contexts 若存在，必須是合法子集
    if (b.slashHints !== undefined && b.slashHints !== null) {
      const sh = b.slashHints as Record<string, unknown>;
      if (sh.contexts !== undefined) {
        if (!Array.isArray(sh.contexts)) {
          return {
            ok: false,
            error: `behaviors[${b.key}].slashHints.contexts must be an array`,
          };
        }
        const VALID_CONTEXTS = new Set(["Guild", "BotDM", "PrivateChannel"]);
        for (const ctx of sh.contexts as unknown[]) {
          if (typeof ctx !== "string" || !VALID_CONTEXTS.has(ctx)) {
            return {
              ok: false,
              error: `behaviors[${b.key}].slashHints.contexts contains invalid value "${String(ctx)}"`,
            };
          }
        }
      }
    }
  }

  // ── plugin_commands[] 驗證（V-05 ~ V-08、V-C1 / V-C2 / V-C3）────────────
  const pluginCommands =
    (m.plugin_commands as ManifestPluginCommandV2[] | undefined) ?? [];
  const seenCommandNames = new Set<string>();
  for (let i = 0; i < pluginCommands.length; i++) {
    const cmd = pluginCommands[i];
    if (!cmd || typeof cmd !== "object") {
      return { ok: false, error: `plugin_commands[${i}] must be an object` };
    }

    // V-05：description 必須是非空字串
    if (
      !cmd.description ||
      typeof cmd.description !== "string" ||
      cmd.description.trim().length === 0
    ) {
      return {
        ok: false,
        error: `plugin_commands[${i}].description must be a non-empty string (V-05)`,
      };
    }

    // name 格式（Discord constraint）
    if (!cmd.name || !/^[a-z0-9][a-z0-9-]{0,31}$/.test(cmd.name)) {
      return {
        ok: false,
        error:
          `plugin_commands[${i}].name "${String(cmd.name)}" invalid ` +
          `(Discord constraint: ^[a-z0-9][a-z0-9-]{0,31}$)`,
      };
    }
    if (seenCommandNames.has(cmd.name)) {
      return {
        ok: false,
        error: `plugin_commands[${i}].name "${cmd.name}" is declared more than once`,
      };
    }
    seenCommandNames.add(cmd.name);

    // V-06：scope
    if (cmd.scope !== "guild" && cmd.scope !== "global") {
      return {
        ok: false,
        error: `plugin_commands[${cmd.name}].scope must be "guild" or "global" (V-06)`,
      };
    }

    // V-07：integration_types 必須是合法子集且非空
    if (!Array.isArray(cmd.integration_types) || cmd.integration_types.length === 0) {
      return {
        ok: false,
        error: `plugin_commands[${cmd.name}].integration_types must be a non-empty array (V-07)`,
      };
    }
    const VALID_INTEGRATION_TYPES = new Set(["guild_install", "user_install"]);
    for (const it of cmd.integration_types) {
      if (typeof it !== "string" || !VALID_INTEGRATION_TYPES.has(it)) {
        return {
          ok: false,
          error:
            `plugin_commands[${cmd.name}].integration_types contains invalid value "${String(it)}" (V-07)`,
        };
      }
    }

    // V-08：contexts 必須是非空子集
    if (!Array.isArray(cmd.contexts) || cmd.contexts.length === 0) {
      return {
        ok: false,
        error: `plugin_commands[${cmd.name}].contexts must be a non-empty array (V-08)`,
      };
    }
    const VALID_CONTEXTS_SET = new Set(["Guild", "BotDM", "PrivateChannel"]);
    for (const ctx of cmd.contexts) {
      if (typeof ctx !== "string" || !VALID_CONTEXTS_SET.has(ctx)) {
        return {
          ok: false,
          error:
            `plugin_commands[${cmd.name}].contexts contains invalid value "${String(ctx)}" (V-08)`,
        };
      }
    }

    const integrationTypesSet = new Set(cmd.integration_types);
    const contextsSet = new Set(cmd.contexts);

    // V-C1：scope="guild" 時，contexts 不能包含 BotDM 或 PrivateChannel
    if (cmd.scope === "guild") {
      if (contextsSet.has("BotDM") || contextsSet.has("PrivateChannel")) {
        return {
          ok: false,
          error:
            `plugin_commands[${cmd.name}]: scope="guild" is incompatible with BotDM/PrivateChannel contexts (V-C1)`,
        };
      }
    }

    // V-C2：scope="guild" 時，integration_types 不能包含 user_install
    if (cmd.scope === "guild") {
      if (integrationTypesSet.has("user_install")) {
        return {
          ok: false,
          error:
            `plugin_commands[${cmd.name}]: scope="guild" is incompatible with user_install (V-C2)`,
        };
      }
    }

    // V-C3：scope="global" 且 integration_types 不含 user_install 時，
    //       contexts 不能包含 BotDM 或 PrivateChannel
    if (
      cmd.scope === "global" &&
      !integrationTypesSet.has("user_install")
    ) {
      if (contextsSet.has("BotDM") || contextsSet.has("PrivateChannel")) {
        return {
          ok: false,
          error:
            `plugin_commands[${cmd.name}]: scope="global" with guild_install-only cannot have BotDM/PrivateChannel contexts (V-C3)`,
        };
      }
    }
  }

  // ── guild_features[] 驗證（沿用 v1 邏輯）────────────────────────────────
  // guild_features 的 commands[] 格式沿用 ManifestCommand（v1 相容）
  const seenFeatureCommandNames = new Set<string>();
  const validateFeatureCommand = (
    c: ManifestCommand,
    origin: string,
  ): { ok: false; error: string } | null => {
    if (!c.name || !c.description) {
      return { ok: false, error: `${origin}: name + description required` };
    }
    if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(c.name)) {
      return {
        ok: false,
        error: `${origin}: command.name '${c.name}' invalid (Discord constraint: ^[a-z0-9][a-z0-9-]{0,31}$)`,
      };
    }
    if (seenFeatureCommandNames.has(c.name)) {
      return {
        ok: false,
        error: `${origin}: command.name '${c.name}' is declared more than once in the manifest`,
      };
    }
    seenFeatureCommandNames.add(c.name);
    return null;
  };

  for (const f of
    (m.guild_features as ManifestGuildFeature[] | undefined) ?? []) {
    if (!f.key || !f.name) {
      return {
        ok: false,
        error: "every guild_feature requires key + name",
      };
    }
    for (const c of f.commands ?? []) {
      const fail = validateFeatureCommand(
        c,
        `guild_features[${f.key}].commands`,
      );
      if (fail) return fail;
    }
  }

  return { ok: true, manifest: input as PluginManifest };
}

export interface RegisterResult {
  plugin: PluginRow;
  manifest: PluginManifest;
  /** Cleartext token; never stored, only returned to the plugin once. */
  token: string;
  /**
   * Cleartext dispatch HMAC key for this plugin. Returned once at registration;
   * never returned again. The plugin SDK (A-2) uses this key to verify inbound
   * dispatch signatures from the bot.
   */
  dispatchHmacKey: string;
}

export class PluginRegistry {
  private reaperTimer: NodeJS.Timeout | null = null;
  private auth: PluginAuthStore;

  constructor(auth: PluginAuthStore) {
    this.auth = auth;
  }

  /**
   * Idempotent registration. Re-registers (e.g. plugin restart) just
   * issue a fresh token and update the manifest snapshot — admin's
   * `enabled` flag stays where they last set it.
   *
   * Scope approval gate:
   *   - On first register: approved = manifest scopes, pending = [].
   *   - On re-register: scopes removed from manifest → auto-removed
   *     from approved; scopes added to manifest → placed in pending.
   *   - If config.plugin.autoApproveScopes === true (default): pending
   *     is immediately merged into approved (backward-compat mode until
   *     the frontend approval UI ships).
   *   - Token is always issued with the *approved* scopes only.
   */
  async register(rawManifest: unknown): Promise<RegisterResult> {
    const v = await validateManifest(rawManifest);
    if (!v.ok) {
      throw new ManifestError(v.error);
    }
    const manifest = v.manifest;

    // ── Scope diff ─────────────────────────────────────────────────
    const declaredScopes = manifest.rpc_methods_used ?? [];

    // Fetch previous row (null on first register).
    const prevRow = await findPluginByKey(manifest.plugin.id);
    let approvedScopes: string[];
    let pendingScopes: string[];

    if (!prevRow) {
      // First registration: all declared scopes are immediately approved.
      approvedScopes = declaredScopes;
      pendingScopes = [];
    } else {
      // Re-registration: compute diff against previous approved list.
      let prevApproved: string[];
      try {
        const parsed = JSON.parse(prevRow.approvedScopesJson);
        prevApproved = Array.isArray(parsed) ? (parsed as string[]) : [];
      } catch {
        prevApproved = [];
      }
      const diff = computeScopeDiff(
        prevApproved,
        declaredScopes,
        config.plugin.autoApproveScopes,
      );
      approvedScopes = diff.approved;
      pendingScopes = diff.pending;
    }

    const approvedScopesJson = JSON.stringify(approvedScopes);
    const pendingScopesJson =
      pendingScopes.length > 0 ? JSON.stringify(pendingScopes) : null;

    // ── Token issue ────────────────────────────────────────────────
    // Mint token first, persist hash. Cleartext goes back to the
    // plugin in the response and is never stored.
    // Token is signed with approved scopes only.
    // Stable id for token cache: we can't use the not-yet-known
    // plugins.id row id, so we use pluginKey as identity here, then
    // reissue with the real id once we have it. The auth store keys
    // by tokenHash so the second issue() supersedes the first.
    const placeholderToken = this.auth.issue({
      pluginId: -1,
      pluginKey: manifest.plugin.id,
      scopes: approvedScopes,
    });
    const persisted = await upsertPluginRegistration({
      pluginKey: manifest.plugin.id,
      name: manifest.plugin.name,
      version: manifest.plugin.version,
      url: manifest.plugin.url,
      manifestJson: JSON.stringify(manifest),
      tokenHash: placeholderToken.tokenHash,
      approvedScopesJson,
      pendingScopesJson,
    });
    // Re-issue with the real plugins.id so the auth record carries the
    // db-backed id (used by RPC handlers to filter scopes per plugin).
    this.auth.revokeToken(placeholderToken.token);
    const real = this.auth.issue({
      pluginId: persisted.id,
      pluginKey: manifest.plugin.id,
      scopes: approvedScopes,
    });
    // Persist the real hash in place of the placeholder.
    persisted.tokenHash = real.tokenHash;
    await upsertPluginRegistration({
      pluginKey: manifest.plugin.id,
      name: manifest.plugin.name,
      version: manifest.plugin.version,
      url: manifest.plugin.url,
      manifestJson: JSON.stringify(manifest),
      tokenHash: real.tokenHash,
      approvedScopesJson,
      pendingScopesJson,
    });

    botEventLog.record(
      "info",
      "bot",
      `Plugin registered: ${manifest.plugin.id} v${manifest.plugin.version}`,
      {
        pluginId: persisted.id,
        pluginKey: manifest.plugin.id,
        version: manifest.plugin.version,
      },
    );
    // Refresh the event subscription index so this plugin's
    // events_subscribed start receiving fan-out immediately.
    await rebuildEventIndex().catch((err) => {
      log.error({ err }, "rebuildEventIndex after register failed");
      botEventLog.record(
        "warn",
        "bot",
        "rebuildEventIndex after register failed",
      );
    });
    // Sync slash commands. We do this AFTER the plugin row is
    // persisted because the command registry's collision check needs
    // a real pluginId to exclude itself from the lookup. Failures
    // here are logged inside the command registry; we don't roll
    // back the registration — partial-functioning plugin (events ok,
    // commands stuck) is more useful than no plugin at all.
    try {
      await pluginCommandRegistry.assertNoCollisions(
        manifest.plugin.id,
        persisted.id,
        manifest,
      );
      await pluginCommandRegistry.sync(persisted, manifest);
    } catch (err) {
      if (err instanceof ManifestCommandError) {
        botEventLog.record(
          "warn",
          "bot",
          `plugin-commands: refused commands for ${manifest.plugin.id}: ${err.message}`,
          { pluginId: persisted.id },
        );
      } else {
        log.error(
          { err },
          `plugin-commands: sync failed for ${manifest.plugin.id}`,
        );
        botEventLog.record(
          "warn",
          "bot",
          `plugin-commands: sync failed for ${manifest.plugin.id}`,
        );
      }
    }
    // ── Dispatch HMAC key ──────────────────────────────────────────────
    // Generate once and persist. On re-registration the existing key is
    // reused so plugins that have cached it don't break. The cleartext
    // is returned in the response exactly once — after that only the DB
    // copy exists (and it's bot-internal, never surfaced to admin reads).
    let dispatchHmacKeyCleartext: string;
    if (persisted.dispatchHmacKey) {
      // Re-registration: reuse the existing key.
      dispatchHmacKeyCleartext = persisted.dispatchHmacKey;
    } else {
      // First registration (or migration with NULL): generate a new key.
      dispatchHmacKeyCleartext = randomBytes(32).toString("hex");
      await setPluginDispatchHmacKey(persisted.id, dispatchHmacKeyCleartext);
      persisted.dispatchHmacKey = dispatchHmacKeyCleartext;
    }

    return {
      plugin: persisted,
      manifest,
      token: real.token,
      dispatchHmacKey: dispatchHmacKeyCleartext,
    };
  }

  /**
   * Heartbeat from a plugin: stamp lastHeartbeatAt, ensure status is
   * active, slide token expiry. Called only from the route handler
   * which has already verified the bearer token.
   */
  async heartbeat(pluginId: number, token: string): Promise<void> {
    await touchHeartbeat(pluginId);
    this.auth.refresh(token);
  }

  /**
   * Admin toggle. Disabling a plugin revokes its token immediately —
   * any in-flight RPC fails with 401. Re-enabling requires the plugin
   * to re-register (no automatic resurrection).
   */
  async setEnabled(
    pluginId: number,
    enabled: boolean,
  ): Promise<PluginRow | null> {
    const row = await setEnabledModel(pluginId, enabled);
    if (row && !enabled) {
      this.auth.revokeByPluginId(pluginId);
      // Strip Discord-side commands for the disabled plugin so users
      // don't see ghost commands they can't invoke.
      await pluginCommandRegistry.unregisterAll(pluginId).catch(() => {
        /* logged inside the registry */
      });
    } else if (row && enabled) {
      // Re-enable: re-sync commands. The plugin row's manifestJson
      // is still authoritative even though the plugin process may
      // have heartbeat-expired. If status='inactive' we skip — sync
      // will run again when the plugin re-registers.
      if (row.status === "active") {
        const manifest = (() => {
          try {
            return JSON.parse(row.manifestJson) as PluginManifest;
          } catch {
            return null;
          }
        })();
        if (manifest) {
          await pluginCommandRegistry.sync(row, manifest).catch(() => {
            /* logged inside the registry */
          });
        }
      }
    }
    // Toggling enabled flips whether this plugin appears in event
    // dispatch fan-out; rebuild so the change takes effect on the
    // next inbound event without waiting for the next bot restart.
    if (row) {
      await rebuildEventIndex().catch(() => {
        /* logged inside the bridge */
      });
    }
    return row;
  }

  /**
   * Approve all pending scopes for a plugin: merge pending into approved,
   * clear pending. Returns the updated row, or null if not found.
   */
  async approveScopes(pluginId: number): Promise<PluginRow | null> {
    return approvePluginScopes(pluginId);
  }

  async list(): Promise<PluginRow[]> {
    return findAllPlugins();
  }

  async findByKey(pluginKey: string): Promise<PluginRow | null> {
    return findPluginByKey(pluginKey);
  }

  async findById(pluginId: number): Promise<PluginRow | null> {
    return findPluginById(pluginId);
  }

  /**
   * Start the heartbeat reaper. Call from main.ts after migrations
   * have run. Idempotent: calling twice is a no-op.
   */
  startReaper(now: () => number = Date.now): void {
    if (this.reaperTimer) return;
    const tick = async () => {
      try {
        const cutoff = new Date(now() - HEARTBEAT_TIMEOUT_MS);
        const ids = await expireStalePlugins(cutoff);
        for (const id of ids) {
          this.auth.revokeByPluginId(id);
          botEventLog.record(
            "warn",
            "bot",
            `Plugin marked inactive (heartbeat timeout): id=${id}`,
            { pluginId: id, cutoff: cutoff.toISOString() },
          );
        }
        // If we just expired anything, rebuild the event subscription
        // index so dispatch stops fanning out events to the dead
        // plugin. Without this the index would still hold the id and
        // every event hit a wasted findPluginById round-trip until
        // the next register/setEnabled triggered a rebuild.
        if (ids.length > 0) {
          await rebuildEventIndex().catch(() => {
            /* logged inside the bridge */
          });
        }
      } catch (err) {
        log.error({ err }, "plugin reaper failed");
        botEventLog.record("error", "error", "Plugin reaper failed");
      }
    };
    this.reaperTimer = setInterval(tick, REAPER_INTERVAL_MS);
    this.reaperTimer.unref();
  }

  stopReaper(): void {
    if (this.reaperTimer) {
      clearInterval(this.reaperTimer);
      this.reaperTimer = null;
    }
  }
}

export class ManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ManifestError";
  }
}

export const pluginRegistry = new PluginRegistry(pluginAuthStore);
