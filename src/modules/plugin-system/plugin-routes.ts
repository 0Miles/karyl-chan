import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Client } from "discord.js";
import {
  ManifestError,
  pluginRegistry,
  purgePluginCapabilityGrants,
} from "./plugin-registry.service.js";
import { deleteAllCapabilities } from "./models/plugin-capability.model.js";
import { pluginAuthStore, PluginAuthStore } from "./plugin-auth.service.js";
import { requireCapability } from "../web-core/route-guards.js";
import { jwtService } from "../web-core/jwt.service.js";
import { botEventLog } from "../bot-events/bot-event-log.js";
import { shouldRecord } from "../bot-events/bot-event-dedup.js";
import {
  findFeatureRow,
  findFeatureRowsByGuild,
  findFeatureRowsByPlugin,
  upsertFeatureRow,
} from "../feature-toggle/models/plugin-guild-feature.model.js";
import {
  findAllFeatureDefaults,
  findFeatureDefaultsByPlugin,
  upsertFeatureDefault,
  type PluginFeatureDefaultRow,
} from "../feature-toggle/models/plugin-feature-default.model.js";
import {
  findConfigByPluginAndSource,
  upsertConfigKey,
} from "./models/plugin-config.model.js";
import { encryptSecret } from "../../utils/crypto.js";
import type { PluginManifest } from "./plugin-registry.service.js";
import { pluginCommandRegistry } from "./plugin-command-registry.service.js";
import { rebuildEventIndex } from "./plugin-event-bridge.service.js";
import { recordAudit } from "../admin/admin-audit.service.js";
import { config } from "../../config.js";
import {
  deletePlugin,
  findPluginByKey,
  findPluginById,
  setPluginSetupSecretHash,
  upsertPluginRegistration,
} from "./models/plugin.model.js";
import {
  findPluginCommandsByPlugin,
  PluginCommand,
} from "./models/plugin-command.model.js";
import type { CommandReconciler } from "../command-system/reconcile.service.js";
import { createHash, randomBytes } from "crypto";

/**
 * Plugin-facing endpoints (register / heartbeat) AND admin-facing
 * endpoints (list / enable / disable). Lives in one file because
 * everything's small and the auth split is the point — the file
 * makes both halves visible side by side.
 *
 * Auth model:
 *   /api/plugins/register   — gated by per-plugin setup secret stored in
 *                             the plugin's DB row (X-Plugin-Setup-Secret
 *                             header). Admin must pre-provision the secret
 *                             via POST /api/plugins/setup-secret before the
 *                             plugin can register. No global fallback.
 *   /api/plugins/heartbeat  — gated by the bearer plugin token issued
 *                             at registration.
 *   /api/plugins (admin)    — gated by admin capability 'admin' or
 *                             'system.read'. Mutating routes require
 *                             'admin'.
 *
 * Note: the global onRequest hook in server.ts auto-401s every /api
 * route that isn't whitelisted. We special-case /api/plugins/register
 * and /api/plugins/heartbeat in the hook so they bypass admin auth
 * (they have their own auth model). See server.ts.
 */

const PLUGIN_SETUP_SECRET_HEADER = "x-plugin-setup-secret";

/**
 * Return the public reverse-proxy base URL for a plugin, or `undefined`
 * when `config.web.baseUrl` is not set (omit the field from the response
 * entirely — don't send `null` or an empty string).
 *
 * Format: `<WEB_BASE_URL>/plugin/<pluginKey>` with any trailing slash on
 * `WEB_BASE_URL` stripped first so the result is always a clean URL.
 */
function pluginPublicBaseUrl(pluginKey: string): string | undefined {
  if (!config.web.baseUrl) return undefined;
  const base = config.web.baseUrl.replace(/\/$/, "");
  return `${base}/plugin/${pluginKey}`;
}

function presentedSetupSecret(req: FastifyRequest): string | null {
  const v = req.headers[PLUGIN_SETUP_SECRET_HEADER];
  if (typeof v !== "string") return null;
  return v;
}

function hashSecret(cleartext: string): string {
  return createHash("sha256").update(cleartext).digest("hex");
}

function presentedBearerToken(req: FastifyRequest): string | null {
  const auth = req.headers.authorization;
  if (typeof auth !== "string") return null;
  if (!auth.startsWith("Bearer ")) return null;
  return auth.slice(7);
}

export interface PluginRoutesOptions {
  bot?: Client;
  reconciler?: import("../command-system/reconcile.service.js").CommandReconciler;
}

export async function registerPluginRoutes(
  server: FastifyInstance,
  options: PluginRoutesOptions = {},
): Promise<void> {
  function getReconciler(): CommandReconciler {
    if (!options.reconciler) {
      throw new Error("CommandReconciler not provided to plugin routes");
    }
    return options.reconciler;
  }

  // ─── Plugin-facing ───────────────────────────────────────────────

  /**
   * POST /api/plugins/register
   *
   * Body: { manifest: <Manifest> }
   * Headers: X-Plugin-Setup-Secret: <per-plugin secret>
   *
   * The plugin must have a row in the DB with a setupSecretHash set via
   * POST /api/plugins/setup-secret before this endpoint will accept it.
   *
   * Returns: { plugin: { id, pluginKey, ... }, token: "<cleartext>" }
   * The token is the only time it's ever returned in cleartext —
   * server-side we keep just the SHA-256 hash.
   */
  server.post<{ Body: { manifest?: unknown } }>(
    "/api/plugins/register",
    async (request, reply) => {
      const presented = presentedSetupSecret(request);
      if (!presented) {
        const ip = request.ip;
        if (shouldRecord(`pluginAuth:${ip}`)) {
          botEventLog.record(
            "warn",
            "auth",
            "Plugin registration rejected (missing setup secret header)",
            { ip },
          );
        }
        reply.code(401).send({ error: "invalid setup secret" });
        return;
      }

      // ── Per-plugin secret verification ────────────────────────────
      // Extract pluginKey from the manifest (without full validation
      // yet) so we can look up the per-plugin secret.
      const rawManifest = request.body?.manifest;
      const manifestPluginId =
        rawManifest &&
        typeof rawManifest === "object" &&
        "plugin" in rawManifest &&
        rawManifest.plugin &&
        typeof rawManifest.plugin === "object" &&
        "id" in (rawManifest as { plugin: Record<string, unknown> }).plugin &&
        typeof (rawManifest as { plugin: Record<string, unknown> }).plugin
          .id === "string"
          ? ((rawManifest as { plugin: { id: string } }).plugin.id as string)
          : null;

      if (!manifestPluginId) {
        reply.code(401).send({ error: "invalid setup secret" });
        return;
      }

      const pluginRow = await findPluginByKey(manifestPluginId);
      if (!pluginRow?.setupSecretHash) {
        const ip = request.ip;
        if (shouldRecord(`pluginAuth:${ip}`)) {
          botEventLog.record(
            "warn",
            "auth",
            "Plugin registration rejected (no setup secret configured)",
            { ip, pluginKey: manifestPluginId },
          );
        }
        reply.code(401).send({ error: "invalid setup secret" });
        return;
      }

      // Compare presented secret against stored hash.
      const presentedHash = hashSecret(presented);
      if (
        !PluginAuthStore.constantTimeEqual(
          presentedHash,
          pluginRow.setupSecretHash,
        )
      ) {
        const ip = request.ip;
        if (shouldRecord(`pluginAuth:${ip}`)) {
          botEventLog.record(
            "warn",
            "auth",
            "Plugin registration rejected (bad per-plugin setup secret)",
            { ip, pluginKey: manifestPluginId },
          );
        }
        reply.code(401).send({ error: "invalid setup secret" });
        return;
      }

      try {
        const result = await pluginRegistry.register(request.body?.manifest);
        // publicBaseUrl is the browser-reachable URL for this plugin's
        // WebUI, served via the bot's reverse proxy at
        // /plugin/<pluginKey>/*. Omitted entirely when WEB_BASE_URL is
        // not set (so plugins in envs without an external URL don't get a
        // broken empty string to act on).
        const publicBaseUrl = pluginPublicBaseUrl(result.plugin.pluginKey);
        return {
          plugin: {
            id: result.plugin.id,
            pluginKey: result.plugin.pluginKey,
            name: result.plugin.name,
            version: result.plugin.version,
            enabled: result.plugin.enabled,
          },
          token: result.token,
          dispatchHmacKey: result.dispatchHmacKey,
          // SPKI-PEM Ed25519 public key for verifying `plugin-session`
          // JWTs (the bot's single JWT signing authority — see
          // jwt.service.ts — signs them with the matching private key).
          // Same for every plugin: it's a public key. Plugins that don't
          // run a WebUI can ignore it.
          sessionVerifyPublicKey: jwtService.publicKeyPem(),
          // publicBaseUrl: the bot reverse-proxies /plugin/<pluginKey>/*
          // to the plugin's stored manifest url, no TLS cert required.
          // Omitted when WEB_BASE_URL is not configured.
          ...(publicBaseUrl !== undefined ? { publicBaseUrl } : {}),
          // Echo back the heartbeat path/cadence so a fresh plugin
          // doesn't need to hardcode anything.
          heartbeat: { path: "/api/plugins/heartbeat", interval_seconds: 30 },
        };
      } catch (err) {
        if (err instanceof ManifestError) {
          reply.code(400).send({ error: err.message });
          return;
        }
        const msg = err instanceof Error ? err.message : String(err);
        request.log.error({ err }, "plugin register failed");
        botEventLog.record(
          "error",
          "error",
          `Plugin registration failed: ${msg}`,
        );
        reply.code(500).send({ error: "registration failed" });
      }
    },
  );

  /**
   * POST /api/plugins/heartbeat
   *
   * Headers: Authorization: Bearer <plugin-token>
   *
   * No body. Returns `{ ok: true, sessionVerifyPublicKey, publicBaseUrl? }`
   * on success. The public key is echoed on every beat so a plugin picks
   * up a rotated JWT signing key within one heartbeat interval (~30s)
   * without re-registering. `publicBaseUrl` is echoed on every beat so a
   * plugin that caches it always has the current value (e.g. after an
   * operator changes WEB_BASE_URL). Omitted when WEB_BASE_URL is unset.
   * Used by plugins to keep their `active` status; missing for >75s flips
   * them to `inactive` via the registry's reaper.
   *
   * The pluginKey is taken from the in-memory auth record (set at
   * registration) — no extra DB round-trip is needed.
   */
  server.post("/api/plugins/heartbeat", async (request, reply) => {
    const token = presentedBearerToken(request);
    if (!token) {
      reply.code(401).send({ error: "missing bearer token" });
      return;
    }
    const rec = pluginAuthStore.verify(token);
    if (!rec) {
      reply.code(401).send({ error: "token invalid or expired" });
      return;
    }
    await pluginRegistry.heartbeat(rec.pluginId, token);
    const publicBaseUrl = pluginPublicBaseUrl(rec.pluginKey);
    return {
      ok: true,
      sessionVerifyPublicKey: jwtService.publicKeyPem(),
      ...(publicBaseUrl !== undefined ? { publicBaseUrl } : {}),
    };
  });

  // ─── Admin-facing ────────────────────────────────────────────────

  /** GET /api/plugins — list all known plugins for the admin UI. */
  server.get("/api/plugins", async (request, reply) => {
    if (!requireCapability(request, reply, "admin")) return;
    const rows = await pluginRegistry.list();
    return {
      plugins: rows.map((p) => ({
        id: p.id,
        pluginKey: p.pluginKey,
        name: p.name,
        version: p.version,
        url: p.url,
        status: p.status,
        enabled: p.enabled,
        lastHeartbeatAt: p.lastHeartbeatAt,
        manifest: safeParse(p.manifestJson),
        rpcMethods: manifestRpcMethods(p.manifestJson),
      })),
    };
  });

  /** GET /api/plugins/:id — single plugin detail (manifest snapshot). */
  server.get<{ Params: { id: string } }>(
    "/api/plugins/:id",
    async (request, reply) => {
      if (!requireCapability(request, reply, "admin")) return;
      const id = Number(request.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        reply.code(400).send({ error: "invalid id" });
        return;
      }
      const all = await pluginRegistry.list();
      const p = all.find((x) => x.id === id);
      if (!p) {
        reply.code(404).send({ error: "plugin not found" });
        return;
      }
      return {
        plugin: {
          id: p.id,
          pluginKey: p.pluginKey,
          name: p.name,
          version: p.version,
          url: p.url,
          status: p.status,
          enabled: p.enabled,
          lastHeartbeatAt: p.lastHeartbeatAt,
          manifest: safeParse(p.manifestJson),
        },
      };
    },
  );

  /**
   * GET /api/plugins/by-key/:pluginKey
   *
   * Plugin 詳情頁（M1-D2）。依 pluginKey 查詢單一 plugin，額外回傳：
   *   - pluginCommands[]：DB 中的 plugin_commands 行（featureKey=null 的軌三指令）
   *   - 其他欄位與 GET /api/plugins/:id 相同，加上 rpcMethods（manifest 宣告的 RPC 方法，唯讀）
   *
   * 注意：路由 `/api/plugins/by-key/:pluginKey` 必須放在 `/api/plugins/:id` 之前，
   * 否則 `by-key` 會被 Fastify 當成數字 id 參數解析（雖然驗證會失敗，但為求清晰）。
   * 實際此路由放在 `:id` 之後無衝突，因 by-key 字串不是數字。
   */
  server.get<{ Params: { pluginKey: string } }>(
    "/api/plugins/by-key/:pluginKey",
    async (request, reply) => {
      if (!requireCapability(request, reply, "admin")) return;
      const { pluginKey } = request.params;
      if (!pluginKey || pluginKey.length === 0) {
        reply.code(400).send({ error: "pluginKey required" });
        return;
      }
      const all = await pluginRegistry.list();
      const p = all.find((x) => x.pluginKey === pluginKey);
      if (!p) {
        reply.code(404).send({ error: "plugin not found" });
        return;
      }
      const pluginCommands = await findPluginCommandsByPlugin(p.id);
      // 軌三：featureKey=null；軌一：featureKey!=null（不在此 tab 顯示）
      const thirdTrackCommands = pluginCommands.filter(
        (c) => c.featureKey === null,
      );

      return {
        plugin: {
          id: p.id,
          pluginKey: p.pluginKey,
          name: p.name,
          version: p.version,
          url: p.url,
          status: p.status,
          enabled: p.enabled,
          lastHeartbeatAt: p.lastHeartbeatAt,
          manifest: safeParse(p.manifestJson),
          rpcMethods: manifestRpcMethods(p.manifestJson),
          pluginCommands: thirdTrackCommands.map((c) => ({
            id: c.id,
            name: c.name,
            featureKey: c.featureKey,
            adminEnabled: c.adminEnabled,
            manifestJson: c.manifestJson,
          })),
        },
      };
    },
  );

  /**
   * PATCH /api/plugin-commands/:id/admin-enabled
   *
   * 軌三指令 on/off toggle（M1-D2）。
   * Body: { enabled: boolean }
   * 成功後觸發 CommandReconciler.reconcileForPluginCommand(id)（非同步，不 await）。
   *
   * 只能操作 featureKey=null 的軌三指令。featureKey!=null 的軌一指令由 guild feature toggle 管。
   */
  server.patch<{
    Params: { id: string };
    Body: { enabled?: unknown };
  }>("/api/plugin-commands/:id/admin-enabled", async (request, reply) => {
    if (!requireCapability(request, reply, "admin")) return;
    const rowId = Number(request.params.id);
    if (!Number.isInteger(rowId) || rowId <= 0) {
      reply.code(400).send({ error: "invalid id" });
      return;
    }
    if (typeof request.body?.enabled !== "boolean") {
      reply.code(400).send({ error: "enabled boolean required" });
      return;
    }
    const row = await PluginCommand.findByPk(rowId);
    if (!row) {
      reply.code(404).send({ error: "plugin command not found" });
      return;
    }
    const featureKey = row.getDataValue("featureKey") as string | null;
    if (featureKey !== null) {
      reply.code(400).send({
        error:
          "cannot toggle feature commands via this endpoint; use guild feature toggle",
      });
      return;
    }
    await row.update({ adminEnabled: request.body.enabled });
    botEventLog.record(
      "info",
      "bot",
      `plugin command adminEnabled=${request.body.enabled}: id=${rowId} name=${row.getDataValue("name")}`,
      { rowId, enabled: request.body.enabled, actor: request.authUserId },
    );
    // 非同步觸發 reconcile，不阻塞回應
    getReconciler()
      .reconcileForPluginCommand(rowId)
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        botEventLog.record(
          "warn",
          "bot",
          `reconcileForPluginCommand(${rowId}) failed after adminEnabled toggle: ${msg}`,
        );
      });
    return {
      command: {
        id: rowId,
        adminEnabled: request.body.enabled,
      },
    };
  });

  // ─── Per-guild feature config (admin) ────────────────────────────

  /**
   * GET /api/plugins/guilds/:guildId/features
   *
   * Returns every feature offered by every active+enabled plugin
   * across every plugin's manifest, joined with whatever config /
   * enabled state already exists in plugin_guild_features for this
   * guild. Used by the admin guild page's Bot Functions tab.
   *
   * Pure read — no side effects. Aggregates across plugins so the UI
   * doesn't have to N+1 the manifest store.
   */
  server.get<{ Params: { guildId: string } }>(
    "/api/plugins/guilds/:guildId/features",
    async (request, reply) => {
      if (!requireCapability(request, reply, "admin")) return;
      const guildId = request.params.guildId;
      if (!guildId || guildId.length === 0) {
        reply.code(400).send({ error: "guildId required" });
        return;
      }
      const plugins = await pluginRegistry.list();
      const rows = await findFeatureRowsByGuild(guildId);
      const rowByKey = new Map(
        rows.map((r) => [`${r.pluginId}:${r.featureKey}`, r]),
      );
      const defaultByKey = new Map(
        (await findAllFeatureDefaults()).map((d) => [
          `${d.pluginId}:${d.featureKey}`,
          d.enabled,
        ]),
      );
      const items: Array<{
        pluginId: number;
        pluginKey: string;
        pluginName: string;
        featureKey: string;
        name: string;
        description: string | undefined;
        icon: string | undefined;
        configSchema: unknown;
        surfaces: string[];
        /** Effective on/off for this guild: per-guild row → operator default → manifest default → false. */
        enabled: boolean;
        /** True if there's an explicit per-guild row (i.e. the guild overrides the default). */
        overridden: boolean;
        /** The resolved default this guild falls back to when not overridden (operator default → manifest default → false). */
        defaultEnabled: boolean;
        config: Record<string, unknown>;
        metrics: Record<string, unknown>;
        pluginEnabled: boolean;
        pluginStatus: "active" | "inactive";
      }> = [];
      for (const p of plugins) {
        const manifest = safeParse(p.manifestJson) as PluginManifest | null;
        if (!manifest) continue;
        for (const f of manifest.guild_features ?? []) {
          const row = rowByKey.get(`${p.id}:${f.key}`);
          const defaultEnabled =
            defaultByKey.get(`${p.id}:${f.key}`) ?? !!f.enabled_by_default;
          items.push({
            pluginId: p.id,
            pluginKey: p.pluginKey,
            pluginName: p.name,
            featureKey: f.key,
            name: f.name,
            description: f.description,
            icon: f.icon,
            configSchema: f.config_schema ?? [],
            surfaces: f.surfaces ?? ["bot_functions_tab"],
            enabled: row ? row.enabled : defaultEnabled,
            overridden: !!row,
            defaultEnabled,
            config: row
              ? ((safeParse(row.configJson) as Record<string, unknown>) ?? {})
              : {},
            metrics: row
              ? ((safeParse(row.metricsJson) as Record<string, unknown>) ?? {})
              : {},
            pluginEnabled: p.enabled,
            pluginStatus: p.status,
          });
        }
      }
      return { features: items };
    },
  );

  /**
   * PUT /api/plugins/:id/guilds/:guildId/features/:featureKey
   * Body: { enabled?: boolean, config?: Record<string, unknown> }
   *
   * Upsert one feature row. Validates featureKey exists in the
   * plugin's manifest. `secret`-typed config fields are encrypted at
   * rest the same way behavior webhookSecret is — value never leaves
   * the server in plaintext through any read endpoint.
   */
  server.put<{
    Params: { id: string; guildId: string; featureKey: string };
    Body: { enabled?: unknown; config?: unknown };
  }>(
    "/api/plugins/:id/guilds/:guildId/features/:featureKey",
    async (request, reply) => {
      if (!requireCapability(request, reply, "admin")) return;
      const pluginId = Number(request.params.id);
      const { guildId, featureKey } = request.params;
      if (!Number.isInteger(pluginId) || pluginId <= 0) {
        reply.code(400).send({ error: "invalid plugin id" });
        return;
      }
      if (!guildId || !featureKey) {
        reply.code(400).send({ error: "guildId + featureKey required" });
        return;
      }
      const plugin = (await pluginRegistry.list()).find(
        (p) => p.id === pluginId,
      );
      if (!plugin) {
        reply.code(404).send({ error: "plugin not found" });
        return;
      }
      const manifest = safeParse(plugin.manifestJson) as PluginManifest | null;
      const feature = manifest?.guild_features?.find(
        (f) => f.key === featureKey,
      );
      if (!feature) {
        reply
          .code(404)
          .send({ error: `feature '${featureKey}' not declared by plugin` });
        return;
      }
      const body = request.body ?? {};
      // Resolve the effective on/off: per-guild row → operator default →
      // manifest default → false. When `enabled` isn't in the body
      // (config-only PATCH) we pass the *resolved* value to
      // upsertFeatureRow so the new row matches today's effective state
      // rather than wrongly defaulting to false. NOTE: this does mean a
      // config-only PATCH on a guild with no prior row materialises an
      // explicit (`overridden`) row pinned to the current default — so a
      // later operator-default change won't propagate to it. There's no
      // "follow default" sentinel for `plugin_guild_features.enabled`
      // (it's a plain boolean); accept this for now. (No UI does
      // config-only PATCH yet — `setGuildFeatureEnabled` always sends
      // `enabled`.)
      const enabledWasGiven = body.enabled !== undefined;
      let enabled: boolean;
      if (enabledWasGiven) {
        enabled = !!body.enabled;
      } else {
        const existing = await findFeatureRow(pluginId, guildId, featureKey);
        enabled =
          existing?.enabled ??
          (await findFeatureDefaultsByPlugin(pluginId)).find(
            (d) => d.featureKey === featureKey,
          )?.enabled ??
          !!feature.enabled_by_default;
      }
      let configJson: string | undefined;
      if (body.config !== undefined) {
        if (!body.config || typeof body.config !== "object") {
          reply.code(400).send({ error: "config must be an object" });
          return;
        }
        const stored: Record<string, unknown> = {};
        const incoming = body.config as Record<string, unknown>;
        for (const field of feature.config_schema ?? []) {
          const v = incoming[field.key];
          if (v === undefined) continue;
          if (
            field.type === "secret" &&
            typeof v === "string" &&
            v.length > 0
          ) {
            stored[field.key] = encryptSecret(v);
          } else {
            stored[field.key] = v;
          }
        }
        configJson = JSON.stringify(stored);
      }
      const row = await upsertFeatureRow({
        pluginId,
        guildId,
        featureKey,
        enabled,
        configJson,
      });
      // Sync the feature's guild-scoped commands to match: enabled →
      // register them in this guild; disabled → delete them. Idempotent
      // (a config-only PATCH just re-confirms the current state).
      {
        const pluginRow = await pluginRegistry.findById(pluginId);
        const manifestObj = pluginRow
          ? (safeParse(pluginRow.manifestJson) as PluginManifest | null)
          : null;
        if (pluginRow && manifestObj) {
          await pluginCommandRegistry
            .syncFeatureCommandsForGuild(
              pluginRow,
              featureKey,
              guildId,
              enabled,
              manifestObj,
            )
            .catch(() => {
              /* logged inside the registry */
            });
        }
      }
      botEventLog.record(
        "info",
        "bot",
        `plugin guild feature ${enabledWasGiven ? (enabled ? "enabled" : "disabled") : "config updated"}: ${plugin.pluginKey}/${featureKey}@${guildId}`,
        { pluginId, guildId, featureKey, enabled, actor: request.authUserId },
      );
      return {
        feature: {
          pluginId: row.pluginId,
          guildId: row.guildId,
          featureKey: row.featureKey,
          enabled: row.enabled,
          // Don't echo back configJson in plaintext — the secrets in
          // it are encrypted, but exposing the encrypted blob serves
          // no purpose. UI re-fetches via the GET aggregate route.
        },
      };
    },
  );

  // ─── Cross-guild feature defaults ────────────────────────────────

  /**
   * GET /api/plugins/feature-defaults
   *
   * Cross-plugin "All Servers" overview: every plugin × feature, with
   *   - the manifest's enabled_by_default (author intent)
   *   - the operator's default override from plugin_feature_defaults (if any)
   *   - the per-guild row count (how many guilds opted in vs out)
   *
   * The frontend "All Servers" dashboard uses this for the defaults
   * editor + matrix. Defaults effective = override ?? manifest_default ?? false.
   */
  server.get("/api/plugins/feature-defaults", async (request, reply) => {
    if (!requireCapability(request, reply, "admin")) return;
    const plugins = await pluginRegistry.list();
    const overrides = await findAllFeatureDefaults();
    const overrideByKey = new Map<string, PluginFeatureDefaultRow>(
      overrides.map((o) => [`${o.pluginId}:${o.featureKey}`, o]),
    );
    const items: Array<{
      pluginId: number;
      pluginKey: string;
      pluginName: string;
      pluginEnabled: boolean;
      pluginStatus: "active" | "inactive";
      featureKey: string;
      featureName: string;
      featureDescription: string | undefined;
      featureIcon: string | undefined;
      manifestDefault: boolean;
      override: boolean | null;
      effectiveDefault: boolean;
      enabledGuildCount: number;
      disabledGuildCount: number;
    }> = [];
    for (const p of plugins) {
      const manifest = safeParse(p.manifestJson) as PluginManifest | null;
      if (!manifest) continue;
      const guildRows = await findFeatureRowsByPlugin(p.id);
      for (const f of manifest.guild_features ?? []) {
        const override = overrideByKey.get(`${p.id}:${f.key}`);
        const manifestDefault = !!f.enabled_by_default;
        const effective = override ? override.enabled : manifestDefault;
        const guildRowsForFeature = guildRows.filter(
          (r) => r.featureKey === f.key,
        );
        items.push({
          pluginId: p.id,
          pluginKey: p.pluginKey,
          pluginName: p.name,
          pluginEnabled: p.enabled,
          pluginStatus: p.status,
          featureKey: f.key,
          featureName: f.name,
          featureDescription: f.description,
          featureIcon: f.icon,
          manifestDefault,
          override: override ? override.enabled : null,
          effectiveDefault: effective,
          enabledGuildCount: guildRowsForFeature.filter((r) => r.enabled)
            .length,
          disabledGuildCount: guildRowsForFeature.filter((r) => !r.enabled)
            .length,
        });
      }
    }
    return { features: items };
  });

  /**
   * PUT /api/plugins/:id/feature-defaults/:featureKey
   * Body: { enabled: boolean }
   *
   * Operator override of the manifest's enabled_by_default. Resolution
   * for a guild is: per-guild row → this operator default → manifest
   * default → false (same as built-in features). Changing this default
   * therefore takes effect immediately in every guild that doesn't have
   * an explicit per-guild row — the slash commands are (un)registered
   * accordingly via pluginCommandRegistry.sync.
   */
  server.put<{
    Params: { id: string; featureKey: string };
    Body: { enabled?: unknown };
  }>(
    "/api/plugins/:id/feature-defaults/:featureKey",
    async (request, reply) => {
      if (!requireCapability(request, reply, "admin")) return;
      const pluginId = Number(request.params.id);
      const { featureKey } = request.params;
      if (!Number.isInteger(pluginId) || pluginId <= 0) {
        reply.code(400).send({ error: "invalid plugin id" });
        return;
      }
      if (typeof request.body?.enabled !== "boolean") {
        reply.code(400).send({ error: "enabled boolean required" });
        return;
      }
      const plugin = (await pluginRegistry.list()).find(
        (p) => p.id === pluginId,
      );
      if (!plugin) {
        reply.code(404).send({ error: "plugin not found" });
        return;
      }
      const manifest = safeParse(plugin.manifestJson) as PluginManifest | null;
      const feature = manifest?.guild_features?.find(
        (f) => f.key === featureKey,
      );
      if (!manifest || !feature) {
        reply
          .code(404)
          .send({ error: `feature '${featureKey}' not declared by plugin` });
        return;
      }
      const row = await upsertFeatureDefault(
        pluginId,
        featureKey,
        request.body.enabled,
      );
      // Re-evaluate this feature's slash commands across every guild —
      // un-overridden guilds now follow this default. Detached: this can
      // be one Discord API call per guild, so don't make the admin wait
      // (and don't fail the request if a guild errors — logged inside).
      if (plugin.enabled && plugin.status === "active") {
        void (async () => {
          try {
            await pluginCommandRegistry.syncFeatureCommandsAcrossGuilds(
              plugin,
              manifest,
              featureKey,
            );
          } catch (err) {
            request.log.warn(
              { err, pluginId, featureKey },
              "feature-default change: command re-sync failed",
            );
          }
        })();
      }
      botEventLog.record(
        "info",
        "bot",
        `plugin feature default ${row.enabled ? "enabled" : "disabled"}: ${plugin.pluginKey}/${featureKey}`,
        {
          pluginId,
          featureKey,
          enabled: row.enabled,
          actor: request.authUserId,
        },
      );
      return {
        default: {
          pluginId: row.pluginId,
          featureKey: row.featureKey,
          enabled: row.enabled,
        },
      };
    },
  );

  // (The old POST .../feature-defaults/:featureKey/apply-to-all route is
  //  gone: changing the default now takes effect in every un-overridden
  //  guild automatically — see the PUT route above.)

  // ─── Plugin-level config (admin-editable) ─────────────────────────

  /**
   * GET /api/plugins/:id/config
   *
   * Returns the plugin's manifest config_schema joined with currently-
   * stored values. `secret`-typed fields come back as a sentinel
   * marker so the admin UI can render a "leave blank to keep" state
   * without ever seeing decrypted plaintext on an admin response.
   *
   * Plugin-self KV (source='plugin') is excluded — that's the
   * plugin's private state, not admin-controlled.
   */
  server.get<{ Params: { id: string } }>(
    "/api/plugins/:id/config",
    async (request, reply) => {
      if (!requireCapability(request, reply, "admin")) return;
      const pluginId = Number(request.params.id);
      if (!Number.isInteger(pluginId) || pluginId <= 0) {
        reply.code(400).send({ error: "invalid plugin id" });
        return;
      }
      const plugin = (await pluginRegistry.list()).find(
        (p) => p.id === pluginId,
      );
      if (!plugin) {
        reply.code(404).send({ error: "plugin not found" });
        return;
      }
      const manifest = safeParse(plugin.manifestJson) as PluginManifest | null;
      const schema = manifest?.config_schema ?? [];
      const rows = await findConfigByPluginAndSource(pluginId, "admin");
      const byKey = new Map(rows.map((r) => [r.key, r]));
      return {
        schema,
        values: schema.map((field) => {
          const row = byKey.get(field.key);
          if (!row) return { key: field.key, set: false, value: null };
          if (field.type === "secret") {
            return { key: field.key, set: true, value: "********" };
          }
          return { key: field.key, set: true, value: row.value };
        }),
      };
    },
  );

  /**
   * PUT /api/plugins/:id/config
   * Body: { values: Record<string, string | null> }
   *
   * Upsert each provided key. `null` deletes the key. Secret values
   * coming in as the sentinel "********" are ignored (i.e. the
   * existing encrypted value is kept) — that's how the UI says "leave
   * this secret unchanged" without sending the plaintext back.
   *
   * Unknown keys (not in manifest.config_schema) are rejected so
   * admins can't bloat the table with stray entries.
   */
  server.put<{
    Params: { id: string };
    Body: { values?: unknown };
  }>("/api/plugins/:id/config", async (request, reply) => {
    if (!requireCapability(request, reply, "admin")) return;
    const pluginId = Number(request.params.id);
    if (!Number.isInteger(pluginId) || pluginId <= 0) {
      reply.code(400).send({ error: "invalid plugin id" });
      return;
    }
    const plugin = (await pluginRegistry.list()).find((p) => p.id === pluginId);
    if (!plugin) {
      reply.code(404).send({ error: "plugin not found" });
      return;
    }
    const manifest = safeParse(plugin.manifestJson) as PluginManifest | null;
    const schema = manifest?.config_schema ?? [];
    const schemaByKey = new Map(schema.map((f) => [f.key, f]));
    const body = request.body ?? {};
    if (!body.values || typeof body.values !== "object") {
      reply.code(400).send({ error: "values object required" });
      return;
    }
    const values = body.values as Record<string, unknown>;
    const accepted: string[] = [];
    const skipped: string[] = [];
    for (const [key, raw] of Object.entries(values)) {
      const field = schemaByKey.get(key);
      if (!field) {
        reply
          .code(400)
          .send({ error: `'${key}' not declared in plugin config_schema` });
        return;
      }
      // Sentinel "********" on a secret = leave unchanged.
      if (field.type === "secret" && raw === "********") {
        skipped.push(key);
        continue;
      }
      if (raw === null || raw === undefined) {
        // Delete by setting empty string — keep schema consistent;
        // operator can re-set later. (Hard delete via DELETE endpoint
        // is overkill for v1.)
        await upsertConfigKey(pluginId, key, "", "admin");
        accepted.push(key);
        continue;
      }
      let stored: string;
      if (typeof raw !== "string") {
        reply.code(400).send({ error: `'${key}' must be string` });
        return;
      }
      if (field.type === "secret" && raw.length > 0) {
        stored = encryptSecret(raw);
      } else {
        stored = raw;
      }
      await upsertConfigKey(pluginId, key, stored, "admin");
      accepted.push(key);
    }
    botEventLog.record(
      "info",
      "bot",
      `plugin '${plugin.pluginKey}' admin config updated (${accepted.length} keys)`,
      {
        pluginId,
        keys: accepted,
        skippedSecretKeys: skipped,
        actor: request.authUserId,
      },
    );
    return { accepted, skipped };
  });

  /** POST /api/plugins/:id/enable | /disable */
  server.post<{ Params: { id: string }; Body: { enabled?: unknown } }>(
    "/api/plugins/:id/enabled",
    async (request, reply) => {
      if (!requireCapability(request, reply, "admin")) return;
      const id = Number(request.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        reply.code(400).send({ error: "invalid id" });
        return;
      }
      const enabled = !!request.body?.enabled;
      const updated = await pluginRegistry.setEnabled(id, enabled);
      if (!updated) {
        reply.code(404).send({ error: "plugin not found" });
        return;
      }
      botEventLog.record(
        "info",
        "bot",
        `Plugin ${enabled ? "enabled" : "disabled"} by admin: ${updated.pluginKey}`,
        {
          pluginId: id,
          pluginKey: updated.pluginKey,
          enabled,
          actor: request.authUserId,
        },
      );
      // plugin disable 時：setEnabled 內部已呼叫 unregisterAll 刪 DB rows。
      // 但 global 軌三指令的 discordCommandId=null，deleteOne 無法直接刪 Discord 端。
      // 觸發 reconcileAll，讓 stale 清除機制從名冊 diff 刪除 Discord 端指令（Batch 1 #4）。
      if (!enabled) {
        getReconciler()
          .reconcileAll()
          .catch((err: unknown) => {
            botEventLog.record(
              "warn",
              "bot",
              `plugin-routes: plugin disable 後 reconcileAll 失敗: ${err instanceof Error ? err.message : String(err)}`,
              { pluginId: id },
            );
          });
      }
      return {
        plugin: {
          id: updated.id,
          pluginKey: updated.pluginKey,
          enabled: updated.enabled,
        },
      };
    },
  );

  /**
   * DELETE /api/plugins/:id
   *
   * Hard-delete a plugin that is currently inactive. Active plugins
   * cannot be deleted — the admin must wait for the reaper to mark
   * them inactive first (i.e. stop the plugin container and wait ~75 s).
   *
   * Side-effects on success:
   *   1. Revokes the in-memory auth token.
   *   2. Unregisters all Discord commands.
   *   3. Destroys the DB row (cascade wipes kv/config/features/commands).
   *   4. Rebuilds the event bridge index.
   *
   * Returns 204 on success.
   * Returns 409 if status === "active".
   * Returns 404 if the plugin is not found.
   *
   * Requires admin capability.
   */
  server.delete<{ Params: { id: string } }>(
    "/api/plugins/:id",
    async (request, reply) => {
      if (!requireCapability(request, reply, "admin")) return;
      const pluginId = Number(request.params.id);
      if (!Number.isInteger(pluginId) || pluginId <= 0) {
        reply.code(400).send({ error: "invalid id" });
        return;
      }
      const plugin = await findPluginById(pluginId);
      if (!plugin) {
        reply.code(404).send({ error: "plugin not found" });
        return;
      }
      if (plugin.status === "active") {
        reply.code(409).send({
          error:
            "cannot delete active plugin; stop the plugin process and wait ~75s for the heartbeat reaper to mark it inactive",
        });
        return;
      }

      // 1. Revoke in-memory token so any lingering bearer auth fails.
      pluginAuthStore.revokeByPluginId(pluginId);

      // 2. Unregister Discord commands (best-effort; logs internally).
      // unregisterAll 刪 DB rows + feature 半部 Discord 指令（discordCommandId 有值）。
      // global 軌三指令（discordCommandId=null）無法由 deleteOne 直接刪，
      // 由後續 reconcileAll 透過 stale 清除機制從名冊 diff 刪除 Discord 端（Batch 1 #4）。
      await pluginCommandRegistry.unregisterAll(pluginId).catch(() => {
        /* logged inside unregisterAll */
      });

      // 2b. Purge this plugin's RBAC capability grants from every role
      // (and drop its plugin_capabilities rows). ON DELETE CASCADE would
      // clear the rows anyway, but the `plugin:<key>:*` tokens stored in
      // admin_role_capabilities are plain strings with no FK, so they
      // must be removed explicitly — otherwise they'd linger and re-bind
      // if a plugin with the same key is ever registered again.
      try {
        const capKeys = await deleteAllCapabilities(pluginId);
        await purgePluginCapabilityGrants(plugin.pluginKey, capKeys);
      } catch (err) {
        botEventLog.record(
          "warn",
          "bot",
          `plugin-routes: capability cleanup failed during delete of ${plugin.pluginKey}: ${err instanceof Error ? err.message : String(err)}`,
          { pluginId },
        );
      }

      // 3. Destroy the DB row. ON DELETE CASCADE wipes related tables.
      await deletePlugin(pluginId);

      // 3b. reconcileAll：讓 reconciler stale 清除機制刪除 Discord 端 global 指令。
      // deletePlugin 後 desired set 不含此 plugin 的指令，reconciler diff 會發現名冊有但
      // desired set 沒，自動刪 Discord 端。非同步觸發，不阻擋 204 回應。
      getReconciler()
        .reconcileAll()
        .catch((err: unknown) => {
          botEventLog.record(
            "warn",
            "bot",
            `plugin-routes: plugin delete 後 reconcileAll 失敗: ${err instanceof Error ? err.message : String(err)}`,
            { pluginId },
          );
        });

      // 4. Rebuild the event-dispatch index so the deleted plugin is gone.
      await rebuildEventIndex().catch(() => {
        /* non-fatal; will self-heal on next bot restart */
      });

      // Audit + operation log.
      await recordAudit(
        request.authUserId ?? "system",
        "plugin.delete",
        String(pluginId),
        { pluginKey: plugin.pluginKey },
      );
      botEventLog.record(
        "warn",
        "bot",
        `Plugin deleted by admin: ${plugin.pluginKey} (id=${pluginId})`,
        { pluginId, pluginKey: plugin.pluginKey, actor: request.authUserId },
      );

      reply.code(204).send();
    },
  );

  /**
   * POST /api/plugins/setup-secret
   *
   * Admin pre-generates a per-plugin setup secret. The cleartext is
   * returned exactly once and must be placed in the plugin's .env as
   * KARYL_PLUGIN_SETUP_SECRET. The bot stores only the SHA-256 hash.
   *
   * If the pluginKey does not yet have a DB row, a placeholder row is
   * automatically created (status='inactive', enabled=false) so that the
   * secret can be stored before the plugin first registers.
   *
   * Body: { pluginKey: string, secret?: string }
   *   - pluginKey: the plugin's manifest id
   *   - secret:    optional; if omitted the bot generates a 32-byte hex secret
   *
   * Returns: { pluginKey, setupSecret: "<cleartext-once>", created: boolean }
   *   created=true when a placeholder row was auto-created for the pluginKey.
   *
   * Requires admin capability.
   */
  server.post<{
    Body: { pluginKey?: unknown; secret?: unknown };
  }>("/api/plugins/setup-secret", async (request, reply) => {
    if (!requireCapability(request, reply, "admin")) return;

    const { pluginKey, secret: bodySecret } = request.body ?? {};

    if (typeof pluginKey !== "string" || pluginKey.trim().length === 0) {
      reply.code(400).send({ error: "pluginKey required" });
      return;
    }
    const key = pluginKey.trim();

    if (
      bodySecret !== undefined &&
      (typeof bodySecret !== "string" || bodySecret.length === 0)
    ) {
      reply.code(400).send({ error: "secret must be a non-empty string" });
      return;
    }

    let pluginRow = await findPluginByKey(key);
    let created = false;
    if (!pluginRow) {
      // Auto-create a placeholder row so the secret can be stored before
      // the plugin first registers. The plugin's register call will fill in
      // the real manifest, url, and token via upsertPluginRegistration.
      pluginRow = await upsertPluginRegistration({
        pluginKey: key,
        name: key,
        version: "0.0.0",
        url: "http://placeholder",
        manifestJson: "{}",
        tokenHash: "",
        defaultEnabled: false,
      });
      created = true;
      botEventLog.record(
        "info",
        "bot",
        `Admin created placeholder plugin row for '${key}' via setup-secret`,
        { pluginKey: key, actor: request.authUserId },
      );
    }

    const cleartext =
      typeof bodySecret === "string" && bodySecret.length > 0
        ? bodySecret
        : randomBytes(32).toString("hex");

    const hash = hashSecret(cleartext);
    await setPluginSetupSecretHash(pluginRow.id, hash);

    await recordAudit(
      request.authUserId ?? "system",
      "plugin.setup_secret",
      String(pluginRow.id),
      {
        pluginKey: key,
        secretSource: bodySecret ? "supplied" : "generated",
        placeholderCreated: created,
      },
    );
    botEventLog.record(
      "info",
      "bot",
      `Per-plugin setup secret set by admin for ${key}`,
      {
        pluginId: pluginRow.id,
        pluginKey: key,
        actor: request.authUserId,
        placeholderCreated: created,
      },
    );

    return { pluginKey: key, setupSecret: cleartext, created };
  });
}

function safeParse(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/**
 * The RPC methods a plugin's manifest declares (`rpc_methods_used`).
 * These ARE the plugin's granted scopes — surfaced read-only in the
 * admin UI; there's no approval step. Malformed manifest → [].
 */
function manifestRpcMethods(manifestJson: string): string[] {
  const m = safeParse(manifestJson) as { rpc_methods_used?: unknown } | null;
  if (!m || !Array.isArray(m.rpc_methods_used)) return [];
  return m.rpc_methods_used.filter((s): s is string => typeof s === "string");
}
