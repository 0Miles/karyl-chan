import {
  expireStalePlugins,
  findAllPlugins,
  findPluginById,
  findPluginByKey,
  setPluginEnabled as setEnabledModel,
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

export interface ManifestDmBehavior {
  key: string;
  name: string;
  description?: string;
  supports_continuous?: boolean;
  config_schema?: ManifestConfigField[];
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
   * Distinct from guild_features[].config_schema (per-guild) and
   * dm_behaviors[].config_schema (per-behavior). Values persist in the
   * `plugin_configs` table and are exposed back to the plugin via the
   * `config.get` RPC (secrets returned decrypted to the plugin process,
   * masked when surfaced to admin reads).
   */
  config_schema?: ManifestConfigField[];
  guild_features?: ManifestGuildFeature[];
  dm_behaviors?: ManifestDmBehavior[];
  commands?: ManifestCommand[];
  events_subscribed_global?: string[];
  endpoints?: {
    events?: string;
    command?: string;
    guild_feature_action?: string;
    dm_behavior_dispatch?: string;
  };
}

export type ManifestValidation =
  | { ok: true; manifest: PluginManifest }
  | { ok: false; error: string };

export async function validateManifest(
  input: unknown,
): Promise<ManifestValidation> {
  if (!input || typeof input !== "object") {
    return { ok: false, error: "manifest must be an object" };
  }
  const m = input as Record<string, unknown>;
  if (m.schema_version !== "1") {
    return {
      ok: false,
      error: `unsupported schema_version (got ${String(m.schema_version)}, expected '1')`,
    };
  }
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
  // URL must be parseable; reject non-http(s) up front so we don't
  // try to fetch over a weird scheme later.
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(plugin.url as string);
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      return { ok: false, error: "manifest.plugin.url must be http(s)" };
    }
  } catch {
    return { ok: false, error: "manifest.plugin.url is not a valid URL" };
  }
  // SSRF guard: validate plugin URL against host policy (metadata blocked;
  // RFC1918 allowed for docker-internal services).
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
  // The arrays are optional but if present must be arrays.
  for (const k of [
    "rpc_methods_used",
    "guild_features",
    "dm_behaviors",
    "commands",
    "events_subscribed_global",
  ] as const) {
    if (m[k] !== undefined && !Array.isArray(m[k])) {
      return { ok: false, error: `manifest.${k} must be an array` };
    }
  }
  // Light per-feature / per-behavior validation; we trust well-formed
  // shape beyond this. Stricter checks (e.g. valid Discord option
  // types) live in the command-registration layer where they're
  // actionable.
  // Track every command name across the whole manifest (top-level +
  // every feature) — Discord-side a feature command and a global
  // command sharing a name in the same guild would collide visually,
  // and our reverse-lookup index is a flat (name, guildId) pair.
  const seenNames = new Set<string>();
  const validateCommand = (
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
    if (seenNames.has(c.name)) {
      return {
        ok: false,
        error: `${origin}: command.name '${c.name}' is declared more than once in the manifest`,
      };
    }
    seenNames.add(c.name);
    return null;
  };

  for (const f of (m.guild_features as ManifestGuildFeature[] | undefined) ??
    []) {
    if (!f.key || !f.name) {
      return {
        ok: false,
        error: "every guild_feature requires key + name",
      };
    }
    for (const c of f.commands ?? []) {
      const fail = validateCommand(c, `guild_features[${f.key}].commands`);
      if (fail) return fail;
    }
  }
  for (const b of (m.dm_behaviors as ManifestDmBehavior[] | undefined) ?? []) {
    if (!b.key || !b.name) {
      return { ok: false, error: "every dm_behavior requires key + name" };
    }
  }
  for (const c of (m.commands as ManifestCommand[] | undefined) ?? []) {
    const fail = validateCommand(c, "commands");
    if (fail) return fail;
  }
  return { ok: true, manifest: input as PluginManifest };
}

export interface RegisterResult {
  plugin: PluginRow;
  manifest: PluginManifest;
  /** Cleartext token; never stored, only returned to the plugin once. */
  token: string;
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
   */
  async register(rawManifest: unknown): Promise<RegisterResult> {
    const v = await validateManifest(rawManifest);
    if (!v.ok) {
      throw new ManifestError(v.error);
    }
    const manifest = v.manifest;

    // Mint token first, persist hash. Cleartext goes back to the
    // plugin in the response and is never stored.
    const scopes = manifest.rpc_methods_used ?? [];
    // Stable id for token cache: we can't use the not-yet-known
    // plugins.id row id, so we use pluginKey as identity here, then
    // reissue with the real id once we have it. The auth store keys
    // by tokenHash so the second issue() supersedes the first.
    const placeholderToken = this.auth.issue({
      pluginId: -1,
      pluginKey: manifest.plugin.id,
      scopes,
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
      scopes,
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
    return { plugin: persisted, manifest, token: real.token };
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
