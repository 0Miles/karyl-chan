import {
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
import {
  deleteStaleCapabilities,
  upsertPluginCapability,
} from "./models/plugin-capability.model.js";
import { AdminRoleCapability } from "../admin/models/admin-role-capability.model.js";
import { invalidateCapabilityCache } from "../admin/authorized-user.service.js";
import {
  makePluginCapabilityToken,
  parsePluginCapabilityToken,
} from "../admin/admin-capabilities.js";
import { Op } from "sequelize";
import { withBusyRetry } from "../../db.js";
import { randomBytes } from "crypto";

const log = moduleLogger("plugin-registry");

/** Hard cap on how many capabilities one plugin may declare. */
const MAX_PLUGIN_CAPABILITIES = 32;

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

// Manifest types live in `plugin-sdk-types.ts` so plugin authors
// have a single, narrow file to import for the wire format. The
// re-export below preserves every existing `import { PluginManifest,
// ManifestCommand, ... } from "./plugin-registry.service.js"` site
// across the codebase.
export type {
  ManifestCommandOption,
  ManifestCommand,
  ManifestConfigField,
  ManifestGuildFeature,
  ManifestCapabilityDecl,
  ManifestPluginCommandV2,
  PluginManifest,
} from "./plugin-sdk-types.js";

import type {
  ManifestCommand,
  ManifestCommandOption,
  ManifestConfigField,
  ManifestCapabilityDecl,
  ManifestGuildFeature,
  ManifestPluginCommandV2,
  PluginManifest,
} from "./plugin-sdk-types.js";

/**
 * Purge `plugin:<pluginKey>:<capKey>` capability tokens from every
 * admin role and invalidate the capability cache so the cut is
 * instant. No-op when `capKeys` is empty.
 */
export async function purgePluginCapabilityGrants(
  pluginKey: string,
  capKeys: string[],
): Promise<void> {
  if (capKeys.length === 0) return;
  const tokens = capKeys.map((k) => makePluginCapabilityToken(pluginKey, k));
  await AdminRoleCapability.destroy({
    where: { capability: { [Op.in]: tokens } },
  });
  invalidateCapabilityCache();
}

/**
 * Drop any `plugin:<pluginKey>:*` grant whose capKey is NOT in
 * `keepKeys`. Unlike `purgePluginCapabilityGrants` (which deletes a
 * known list), this is a full sweep against the role table — it
 * self-heals a grant that a previous reconcile / delete failed to
 * purge (so a retired capability can't silently re-bind on a future
 * re-register). Returns the tokens it removed.
 */
async function sweepOrphanPluginGrants(
  pluginKey: string,
  keepKeys: string[],
): Promise<string[]> {
  const keep = new Set(keepKeys);
  const rows = await AdminRoleCapability.findAll({
    where: { capability: { [Op.like]: `plugin:${pluginKey}:%` } },
    attributes: ["capability"],
  });
  const stale = [
    ...new Set(
      rows
        .map((r) => r.getDataValue("capability") as string)
        .filter((tok) => {
          const parsed = parsePluginCapabilityToken(tok);
          return (
            parsed !== null &&
            parsed.pluginKey === pluginKey &&
            !keep.has(parsed.capKey)
          );
        }),
    ),
  ];
  if (stale.length > 0) {
    await AdminRoleCapability.destroy({
      where: { capability: { [Op.in]: stale } },
    });
    invalidateCapabilityCache();
  }
  return stale;
}

/**
 * Reconcile a plugin's manifest-declared capabilities against what's
 * persisted in `plugin_capabilities`:
 *   - declared ∖ stored → inserted
 *   - declared ∩ stored → description refreshed if changed
 *   - stored ∖ declared → row deleted
 *   - role grants for any `plugin:<pluginKey>:*` not in `declared`
 *     are swept from `admin_role_capabilities` (full sync, not just
 *     the rows removed this run)
 *
 * Returns the removed capKeys (for the audit log).
 */
async function reconcilePluginCapabilities(
  pluginId: number,
  pluginKey: string,
  declared: ManifestCapabilityDecl[],
): Promise<string[]> {
  for (const c of declared) {
    await upsertPluginCapability(pluginId, c.key, c.description);
  }
  const declaredKeys = declared.map((c) => c.key);
  const removed = await deleteStaleCapabilities(pluginId, declaredKeys);
  await sweepOrphanPluginGrants(pluginKey, declaredKeys);
  return removed;
}

export type ManifestValidation =
  | { ok: true; manifest: PluginManifest }
  | { ok: false; error: string };

/**
 * Validate a plugin manifest. v2 only: schema_version must be "2".
 * v1 manifests are rejected immediately with a clear error message.
 *
 * Implements V-01 ~ V-08 + V-C1 / V-C2 / V-C3 from B-sdk §4.
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

  // V-04：plugin_commands / guild_features / … 若存在必須是 array
  for (const k of [
    "rpc_methods_used",
    "plugin_commands",
    "guild_features",
    "capabilities",
    "events_subscribed_global",
  ] as const) {
    if (m[k] !== undefined && !Array.isArray(m[k])) {
      return { ok: false, error: `manifest.${k} must be an array` };
    }
  }

  // ── capabilities[] 驗證 ──────────────────────────────────────────────────
  // key 格式 [a-z0-9][a-z0-9._-]*、description 非空、key 不重複、≤32 個。
  const capabilities =
    (m.capabilities as ManifestCapabilityDecl[] | undefined) ?? [];
  if (capabilities.length > MAX_PLUGIN_CAPABILITIES) {
    return {
      ok: false,
      error: `manifest.capabilities: at most ${MAX_PLUGIN_CAPABILITIES} allowed (got ${capabilities.length})`,
    };
  }
  const seenCapKeys = new Set<string>();
  for (let i = 0; i < capabilities.length; i++) {
    const c = capabilities[i];
    if (!c || typeof c !== "object") {
      return { ok: false, error: `capabilities[${i}] must be an object` };
    }
    if (typeof c.key !== "string" || !/^[a-z0-9][a-z0-9._-]*$/.test(c.key)) {
      return {
        ok: false,
        error: `capabilities[${i}].key "${String(c.key)}" must match [a-z0-9][a-z0-9._-]*`,
      };
    }
    if (typeof c.description !== "string" || c.description.trim().length === 0) {
      return {
        ok: false,
        error: `capabilities[${c.key}].description must be a non-empty string`,
      };
    }
    if (c.description.length > 200) {
      return {
        ok: false,
        error: `capabilities[${c.key}].description must be ≤200 chars`,
      };
    }
    if (seenCapKeys.has(c.key)) {
      return {
        ok: false,
        error: `capabilities[${c.key}].key is declared more than once`,
      };
    }
    seenCapKeys.add(c.key);
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
   * RPC scopes: the manifest's declared `rpc_methods_used` ARE the
   * granted scopes. There's no approval step — the token is always
   * issued carrying exactly those methods, so the per-RPC-call scope
   * check (`requireScope`) still rejects a method the plugin didn't
   * declare.
   */
  async register(rawManifest: unknown): Promise<RegisterResult> {
    const v = await validateManifest(rawManifest);
    if (!v.ok) {
      throw new ManifestError(v.error);
    }
    const manifest = v.manifest;

    // ── Declared RPC scopes ────────────────────────────────────────
    // The manifest's rpc_methods_used are the granted scopes — no
    // admin approval, no pending/approved distinction.
    const declaredScopes = manifest.rpc_methods_used ?? [];

    // ── Token issue ────────────────────────────────────────────────
    // Mint token first, persist hash. Cleartext goes back to the
    // plugin in the response and is never stored.
    // Token is signed with the declared scopes.
    // Stable id for token cache: we can't use the not-yet-known
    // plugins.id row id, so we use pluginKey as identity here, then
    // reissue with the real id once we have it. The auth store keys
    // by tokenHash so the second issue() supersedes the first.
    const placeholderToken = this.auth.issue({
      pluginId: -1,
      pluginKey: manifest.plugin.id,
      scopes: declaredScopes,
    });
    const persisted = await upsertPluginRegistration({
      pluginKey: manifest.plugin.id,
      name: manifest.plugin.name,
      version: manifest.plugin.version,
      url: manifest.plugin.url,
      manifestJson: JSON.stringify(manifest),
      tokenHash: placeholderToken.tokenHash,
    });
    // Re-issue with the real plugins.id so the auth record carries the
    // db-backed id (used by RPC handlers to filter scopes per plugin).
    this.auth.revokeToken(placeholderToken.token);
    const real = this.auth.issue({
      pluginId: persisted.id,
      pluginKey: manifest.plugin.id,
      scopes: declaredScopes,
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
    // Reconcile plugin-declared RBAC capabilities. A re-register that
    // drops a capability auto-removes it from every role (mirrors how
    // dropped RPC scopes are auto-removed above). Failures here don't
    // roll back the registration — a plugin with stale capability rows
    // is still useful.
    try {
      // Two plugins registering at once race on plugin_capabilities;
      // retry so a transient lock can't silently drop a capability row.
      const removedCaps = await withBusyRetry(() =>
        reconcilePluginCapabilities(
          persisted.id,
          manifest.plugin.id,
          manifest.capabilities ?? [],
        ),
      );
      if (removedCaps.length > 0) {
        botEventLog.record(
          "info",
          "bot",
          `Plugin '${manifest.plugin.id}' dropped capabilities: ${removedCaps.join(", ")}`,
          { pluginId: persisted.id, removed: removedCaps },
        );
      }
    } catch (err) {
      log.error({ err }, "reconcilePluginCapabilities after register failed");
      botEventLog.record(
        "warn",
        "bot",
        `reconcilePluginCapabilities failed for ${manifest.plugin.id}`,
      );
    }
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
