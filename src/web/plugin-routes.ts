import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  ManifestError,
  pluginRegistry,
} from "../services/plugin-registry.service.js";
import { pluginAuthStore, PluginAuthStore } from "./plugin-auth.service.js";
import { requireCapability } from "./route-guards.js";
import { botEventLog } from "./bot-event-log.js";
import { shouldRecord } from "./bot-event-dedup.js";
import {
  findFeatureRowsByGuild,
  upsertFeatureRow,
} from "../models/plugin-guild-feature.model.js";
import { encryptSecret } from "../utils/crypto.js";
import type { PluginManifest } from "../services/plugin-registry.service.js";

/**
 * Plugin-facing endpoints (register / heartbeat) AND admin-facing
 * endpoints (list / enable / disable). Lives in one file because
 * everything's small and the auth split is the point — the file
 * makes both halves visible side by side.
 *
 * Auth model:
 *   /api/plugins/register   — gated by shared KARYL_PLUGIN_SECRET
 *                             header (X-Plugin-Setup-Secret). Plugins
 *                             that don't have the secret can't register.
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

function getSetupSecret(): string | null {
  const v = process.env.KARYL_PLUGIN_SECRET?.trim();
  return v && v.length > 0 ? v : null;
}

function presentedSetupSecret(req: FastifyRequest): string | null {
  const v = req.headers[PLUGIN_SETUP_SECRET_HEADER];
  if (typeof v !== "string") return null;
  return v;
}

function presentedBearerToken(req: FastifyRequest): string | null {
  const auth = req.headers.authorization;
  if (typeof auth !== "string") return null;
  if (!auth.startsWith("Bearer ")) return null;
  return auth.slice(7);
}

export async function registerPluginRoutes(
  server: FastifyInstance,
): Promise<void> {
  // ─── Plugin-facing ───────────────────────────────────────────────

  /**
   * POST /api/plugins/register
   *
   * Body: { manifest: <Manifest> }
   * Headers: X-Plugin-Setup-Secret: <KARYL_PLUGIN_SECRET>
   *
   * Returns: { plugin: { id, pluginKey, ... }, token: "<cleartext>" }
   * The token is the only time it's ever returned in cleartext —
   * server-side we keep just the SHA-256 hash.
   */
  server.post<{ Body: { manifest?: unknown } }>(
    "/api/plugins/register",
    async (request, reply) => {
      const required = getSetupSecret();
      if (!required) {
        // Refuse to do anything until the operator has set the
        // secret. Fail loud so dev mode doesn't quietly accept
        // anybody-can-register registrations.
        reply.code(503).send({
          error:
            "KARYL_PLUGIN_SECRET not configured on the bot — plugin registration disabled",
        });
        return;
      }
      const presented = presentedSetupSecret(request);
      if (
        !presented ||
        !PluginAuthStore.constantTimeEqual(presented, required)
      ) {
        const ip = request.ip;
        if (shouldRecord(`pluginAuth:${ip}`)) {
          botEventLog.record(
            "warn",
            "auth",
            "Plugin registration rejected (bad setup secret)",
            { ip },
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
}

function safeParse(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}
