import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  ManifestError,
  pluginRegistry,
} from "../services/plugin-registry.service.js";
import { pluginAuthStore, PluginAuthStore } from "./plugin-auth.service.js";
import { requireCapability } from "./route-guards.js";
import { botEventLog } from "./bot-event-log.js";
import { shouldRecord } from "./bot-event-dedup.js";

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

export async function registerPluginRoutes(server: FastifyInstance): Promise<void> {
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
