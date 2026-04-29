import type { FastifyInstance } from "fastify";
import {
  BUILTIN_FEATURE_KEYS,
  findAllStateRows,
  isKnownBuiltinFeature,
  upsertStateRow,
  type BotFeatureStateRow,
} from "../models/bot-feature-state.model.js";
import { requireCapability } from "./route-guards.js";
import { botEventLog } from "./bot-event-log.js";

/**
 * Admin endpoints for the bot's in-process feature on/off table.
 * Plugin features have their own separate routes (plugin-routes.ts);
 * this file only deals with the four built-in groups (todo /
 * picture-only / role-emoji / rcon).
 *
 * URL shape:
 *   GET  /api/bot-features/state              → list every state row
 *   PUT  /api/bot-features/state/:featureKey  body: { guildId?: string|null, enabled: boolean }
 *
 * `guildId === null` (or absent) means "set the operator default for
 * new guilds". A concrete guildId means "override for this guild".
 */
export async function registerBotFeatureRoutes(
  server: FastifyInstance,
): Promise<void> {
  server.get("/api/bot-features/state", async (request, reply) => {
    if (!requireCapability(request, reply, "admin")) return;
    const rows = await findAllStateRows();
    const byKey = new Map<
      string,
      { default: BotFeatureStateRow | null; perGuild: BotFeatureStateRow[] }
    >();
    for (const k of BUILTIN_FEATURE_KEYS) {
      byKey.set(k, { default: null, perGuild: [] });
    }
    for (const r of rows) {
      const slot = byKey.get(r.featureKey);
      if (!slot) continue; // ignore stale rows for removed features
      if (r.guildId === null) slot.default = r;
      else slot.perGuild.push(r);
    }
    return {
      features: BUILTIN_FEATURE_KEYS.map((key) => {
        const slot = byKey.get(key)!;
        return {
          featureKey: key,
          default: slot.default
            ? {
                enabled: slot.default.enabled,
                updatedAt: slot.default.updatedAt,
              }
            : null,
          // Built-in features default ON when no row exists at all;
          // surface the effective default explicitly so the UI doesn't
          // have to re-derive precedence.
          effectiveDefault: slot.default ? slot.default.enabled : true,
          perGuild: slot.perGuild.map((g) => ({
            guildId: g.guildId!,
            enabled: g.enabled,
            updatedAt: g.updatedAt,
          })),
        };
      }),
    };
  });

  server.put<{
    Params: { featureKey: string };
    Body: { guildId?: unknown; enabled?: unknown };
  }>("/api/bot-features/state/:featureKey", async (request, reply) => {
    if (!requireCapability(request, reply, "admin")) return;
    const { featureKey } = request.params;
    if (!isKnownBuiltinFeature(featureKey)) {
      reply
        .code(404)
        .send({ error: `unknown built-in feature '${featureKey}'` });
      return;
    }
    const body = request.body ?? {};
    if (typeof body.enabled !== "boolean") {
      reply.code(400).send({ error: "enabled boolean required" });
      return;
    }
    const guildId =
      body.guildId === undefined || body.guildId === null || body.guildId === ""
        ? null
        : typeof body.guildId === "string"
          ? body.guildId
          : null;
    const row = await upsertStateRow(guildId, featureKey, body.enabled);
    botEventLog.record(
      "info",
      "bot",
      `built-in feature '${featureKey}' ${row.enabled ? "enabled" : "disabled"}${
        row.guildId ? ` for guild ${row.guildId}` : " (default)"
      }`,
      {
        featureKey,
        guildId: row.guildId,
        enabled: row.enabled,
        actor: request.authUserId,
      },
    );
    return {
      state: {
        featureKey: row.featureKey,
        guildId: row.guildId,
        enabled: row.enabled,
      },
    };
  });
}
