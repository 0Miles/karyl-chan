import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Client } from "discord.js";
import { ManifestError, pluginRegistry } from "./plugin-registry.service.js";
import { pluginAuthStore, PluginAuthStore } from "./plugin-auth.service.js";
import { requireCapability } from "../web-core/route-guards.js";
import { botEventLog } from "../bot-events/bot-event-log.js";
import { shouldRecord } from "../bot-events/bot-event-dedup.js";
import {
  findFeatureRowsByGuild,
  findFeatureRowsByPlugin,
  upsertFeatureRow,
} from "../feature-toggle/models/plugin-guild-feature.model.js";
import {
  findAllFeatureDefaults,
  upsertFeatureDefault,
  type PluginFeatureDefaultRow,
} from "../feature-toggle/models/plugin-feature-default.model.js";
import {
  findConfigByPluginAndSource,
  upsertConfigKey,
} from "./models/plugin-config.model.js";
import { encryptSecret } from "../../utils/crypto.js";
import type { PluginManifest } from "./plugin-registry.service.js";
import { recordAudit } from "../admin/admin-audit.service.js";
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
import { CommandReconciler } from "../command-system/reconcile.service.js";
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
}

export async function registerPluginRoutes(
  server: FastifyInstance,
  options: PluginRoutesOptions = {},
): Promise<void> {
  const bot = options.bot;

  // Lazy getter for CommandReconciler（與 behavior-routes 同模式）
  let reconcilerInstance: CommandReconciler | null = null;
  function getReconciler(): CommandReconciler {
    if (!reconcilerInstance) {
      reconcilerInstance = new CommandReconciler(() => options.bot ?? null);
    }
    return reconcilerInstance;
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
        // Plugin has no pre-provisioned setup secret — admin must call
        // POST /api/plugins/setup-secret first.
        const ip = request.ip;
        if (shouldRecord(`pluginAuth:${ip}`)) {
          botEventLog.record(
            "warn",
            "auth",
            `Plugin registration rejected: plugin '${manifestPluginId}' has no setup secret; admin must run POST /api/plugins/setup-secret first`,
            { ip, pluginKey: manifestPluginId },
          );
        }
        reply.code(401).send({
          error: `plugin '${manifestPluginId}' has no setup secret; admin must run POST /api/plugins/setup-secret first`,
        });
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
   * No body. Returns { ok: true } on success. Used by plugins to
   * keep their `active` status; missing for >75s flips them to
   * `inactive` via the registry's reaper.
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
    return { ok: true };
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
        approvedScopes: safeParseArray(p.approvedScopesJson),
        pendingScopes: safeParseArray(p.pendingScopesJson ?? "[]"),
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
   *   - 其他欄位與 GET /api/plugins/:id 相同，加上 approvedScopes / pendingScopes
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
          approvedScopes: safeParseArray(p.approvedScopesJson),
          pendingScopes: safeParseArray(p.pendingScopesJson ?? "[]"),
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
      reply
        .code(400)
        .send({
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
        enabled: boolean;
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
            enabled: row?.enabled ?? false,
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
      const enabled = body.enabled === undefined ? undefined : !!body.enabled;
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
      // If the admin flipped enabled, sync the feature's guild-scoped
      // commands accordingly: enabled → register them in this guild;
      // disabled → delete them. Idempotent for "config-only" patches
      // (enabled === undefined) where no toggle change happened.
      if (enabled !== undefined) {
        const { pluginCommandRegistry } =
          await import("./plugin-command-registry.service.js");
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
        `plugin guild feature ${enabled === undefined ? "config updated" : enabled ? "enabled" : "disabled"}: ${plugin.pluginKey}/${featureKey}@${guildId}`,
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
   * Operator override of the manifest's enabled_by_default. Doesn't
   * touch existing per-guild rows; new guilds (without a row) will see
   * the override applied. Use the apply-to-all endpoint to bulk-flip
   * existing guilds.
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
      if (!feature) {
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

  /**
   * POST /api/plugins/:id/feature-defaults/:featureKey/apply-to-all
   * Body: { guildIds?: string[] }    // optional whitelist; default = all guilds bot is in
   *
   * Bulk-set every existing per-guild row for this feature to match
   * the current effective default (override ?? manifestDefault). Creates
   * rows for guilds that don't have one yet (so the bot's "guild has a
   * row → disabled by row, no row → use default" semantics stay intact).
   *
   * Returns: { updated: <count>, skipped: <count> }
   */
  server.post<{
    Params: { id: string; featureKey: string };
    Body: { guildIds?: unknown };
  }>(
    "/api/plugins/:id/feature-defaults/:featureKey/apply-to-all",
    async (request, reply) => {
      if (!requireCapability(request, reply, "admin")) return;
      const pluginId = Number(request.params.id);
      const { featureKey } = request.params;
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
      const feature = manifest?.guild_features?.find(
        (f) => f.key === featureKey,
      );
      if (!feature) {
        reply
          .code(404)
          .send({ error: `feature '${featureKey}' not declared by plugin` });
        return;
      }
      const overrides = await findAllFeatureDefaults();
      const override = overrides.find(
        (o) => o.pluginId === pluginId && o.featureKey === featureKey,
      );
      const effective = override
        ? override.enabled
        : !!feature.enabled_by_default;

      const requested = Array.isArray(request.body?.guildIds)
        ? (request.body.guildIds as unknown[]).filter(
            (g): g is string => typeof g === "string" && g.length > 0,
          )
        : null;
      // Default: all guilds the bot is currently in. Falling back to
      // existing rows would skip guilds that never had this feature
      // touched — and "apply default to all" is precisely the moment
      // we want to seed them.
      const allGuildIds = bot?.guilds?.cache
        ? [...bot.guilds.cache.keys()]
        : [];
      const targetGuildIds =
        requested && requested.length > 0 ? requested : allGuildIds;
      if (targetGuildIds.length === 0) {
        return { updated: 0, skipped: 0 };
      }
      let updated = 0;
      for (const guildId of targetGuildIds) {
        await upsertFeatureRow({
          pluginId,
          guildId,
          featureKey,
          enabled: effective,
        });
        updated++;
      }
      botEventLog.record(
        "info",
        "bot",
        `plugin feature default applied to ${updated} guilds: ${plugin.pluginKey}/${featureKey} -> ${effective ? "on" : "off"}`,
        {
          pluginId,
          featureKey,
          updated,
          enabled: effective,
          actor: request.authUserId,
        },
      );
      return { updated, skipped: 0 };
    },
  );

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

  /**
   * POST /api/plugins/:id/approve-scopes
   *
   * Admin approves all pending scopes for a plugin. Moves
   * pendingScopes → approvedScopes (union), clears pending. The plugin
   * must re-register to receive a token that includes the newly approved
   * scopes (tokens are only issued at registration time).
   *
   * Requires admin capability.
   */
  server.post<{ Params: { id: string } }>(
    "/api/plugins/:id/approve-scopes",
    async (request, reply) => {
      if (!requireCapability(request, reply, "admin")) return;
      const id = Number(request.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        reply.code(400).send({ error: "invalid id" });
        return;
      }
      const updated = await pluginRegistry.approveScopes(id);
      if (!updated) {
        reply.code(404).send({ error: "plugin not found" });
        return;
      }
      const approved = safeParseArray(updated.approvedScopesJson);
      await recordAudit(
        request.authUserId ?? "system",
        "plugin.approve_scopes",
        `plugin:${id}`,
        {
          pluginId: id,
          pluginKey: updated.pluginKey,
          approvedScopes: approved,
        },
      );
      botEventLog.record(
        "info",
        "bot",
        `Plugin scopes approved by admin: ${updated.pluginKey} scopes=${approved.join(",")}`,
        {
          pluginId: id,
          pluginKey: updated.pluginKey,
          approvedScopes: approved,
        },
      );
      return {
        approved,
        pending: [],
      };
    },
  );

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
      const { pluginCommandRegistry } =
        await import("./plugin-command-registry.service.js");
      await pluginCommandRegistry.unregisterAll(pluginId).catch(() => {
        /* logged inside unregisterAll */
      });

      // 3. Destroy the DB row. ON DELETE CASCADE wipes related tables.
      await deletePlugin(pluginId);

      // 4. Rebuild the event-dispatch index so the deleted plugin is gone.
      const { rebuildEventIndex } =
        await import("./plugin-event-bridge.service.js");
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
        approvedScopesJson: "[]",
        pendingScopesJson: null,
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

function safeParseArray(json: string): string[] {
  try {
    const parsed = JSON.parse(json);
    if (Array.isArray(parsed)) return parsed as string[];
  } catch {
    // ignore malformed
  }
  return [];
}
