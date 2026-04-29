import type { Client } from "discordx";
import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from "fastify";
import { ChannelType } from "discord.js";
import { findPluginById } from "../models/plugin.model.js";
import {
  deleteKv,
  getKv,
  listKvKeys,
  setKv,
  sumGuildBytes,
} from "../models/plugin-kv.model.js";
import { botEventLog } from "./bot-event-log.js";
import type { PluginManifest } from "../services/plugin-registry.service.js";

/**
 * Plugin RPC endpoints: the things plugins are allowed to ask the bot
 * to do on their behalf. Auth (bearer plugin token → request.pluginAuth)
 * is enforced by server.ts onRequest hook before any handler runs.
 *
 * Each handler additionally enforces:
 *   - the manifest's `rpc_methods_used` allowlist (least privilege)
 *   - the plugin must still be `enabled=true` and `status='active'`
 *     in the DB at call time (the in-memory token cache outlives a
 *     disable; we re-check on every call)
 *
 * Endpoints intentionally use a flat `/api/plugin/<verb>` shape
 * rather than nested resources because RPC verbs map cleanly to
 * Discord.js method calls and we want a 1:1 audit story.
 */

export interface PluginRpcOptions {
  bot?: Client;
}

const KV_KEY_MAX = 200;
const KV_VALUE_MAX_BYTES = 64 * 1024; // hard ceiling regardless of manifest quota
const DEFAULT_KV_QUOTA_BYTES = 64 * 1024;

function rejectForbidden(reply: FastifyReply, scope: string): void {
  reply
    .code(403)
    .send({ error: `plugin token missing scope '${scope}'` });
}

async function requireScope(
  request: FastifyRequest,
  reply: FastifyReply,
  scope: string,
): Promise<{ pluginId: number; pluginKey: string } | null> {
  const auth = request.pluginAuth;
  if (!auth) {
    reply.code(401).send({ error: "plugin auth missing" });
    return null;
  }
  if (!auth.scopes.has(scope)) {
    rejectForbidden(reply, scope);
    return null;
  }
  // The token was minted with scopes baked in, but the plugin row may
  // have been admin-disabled or expired since then. Re-check liveness.
  const plugin = await findPluginById(auth.pluginId);
  if (!plugin || !plugin.enabled || plugin.status !== "active") {
    reply
      .code(403)
      .send({ error: "plugin is disabled or inactive on the bot" });
    return null;
  }
  return { pluginId: auth.pluginId, pluginKey: auth.pluginKey };
}

function getManifest(manifestJson: string): PluginManifest | null {
  try {
    return JSON.parse(manifestJson) as PluginManifest;
  } catch {
    return null;
  }
}

async function quotaForGuildKv(pluginId: number): Promise<number> {
  // Read quota from the plugin's stored manifest. Falls back to a
  // bot-wide default if the plugin didn't declare one.
  const plugin = await findPluginById(pluginId);
  if (!plugin) return DEFAULT_KV_QUOTA_BYTES;
  const manifest = getManifest(plugin.manifestJson);
  const declaredKb = manifest?.storage?.guild_kv_quota_kb;
  if (typeof declaredKb === "number" && declaredKb > 0) {
    return Math.min(declaredKb * 1024, KV_VALUE_MAX_BYTES * 16);
  }
  return DEFAULT_KV_QUOTA_BYTES;
}

export async function registerPluginRpcRoutes(
  server: FastifyInstance,
  options: PluginRpcOptions,
): Promise<void> {
  const bot = options.bot;

  // ─── messages.send ────────────────────────────────────────────────
  /**
   * POST /api/plugin/messages.send
   * Body: { channel_id: string, content?: string, embeds?: APIEmbed[],
   *         allowed_mentions?: { parse?: ('users'|'roles'|'everyone')[] } }
   * Returns: { id, channel_id }
   *
   * The plugin can target any text channel the bot has access to in
   * any guild it's in, plus DM channels of any user. Phase 2 may
   * narrow this to the plugin's own guild_features scope; Phase 1.5
   * trusts the operator-installed plugins to behave.
   */
  server.post<{
    Body: {
      channel_id?: unknown;
      content?: unknown;
      embeds?: unknown;
      allowed_mentions?: unknown;
    };
  }>("/api/plugin/messages.send", async (request, reply) => {
    const ctx = await requireScope(request, reply, "messages.send");
    if (!ctx) return;
    if (!bot) {
      reply.code(503).send({ error: "bot client unavailable" });
      return;
    }
    const body = request.body ?? {};
    if (typeof body.channel_id !== "string" || body.channel_id.length === 0) {
      reply.code(400).send({ error: "channel_id required" });
      return;
    }
    const content =
      typeof body.content === "string" ? body.content : undefined;
    const embeds = Array.isArray(body.embeds) ? body.embeds : undefined;
    if (!content && !embeds) {
      reply.code(400).send({ error: "content or embeds required" });
      return;
    }
    let channel;
    try {
      channel = await bot.channels.fetch(body.channel_id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      reply.code(404).send({ error: `channel fetch failed: ${msg}` });
      return;
    }
    if (!channel || !channel.isTextBased() || !("send" in channel)) {
      reply
        .code(400)
        .send({ error: "channel is not text-sendable" });
      return;
    }
    // Block @everyone / @here / role pings unless the plugin
    // explicitly opts in. Default to "no parsed mentions" so a
    // misbehaving plugin can't surprise everyone.
    const allowedMentions =
      body.allowed_mentions && typeof body.allowed_mentions === "object"
        ? (body.allowed_mentions as Record<string, unknown>)
        : { parse: [] };
    try {
      const sent = await channel.send({
        content,
        // discord.js v14 accepts raw embed objects; if it's malformed
        // it'll throw, which we surface as a 400.
        embeds: embeds as never,
        allowedMentions: allowedMentions as never,
      });
      botEventLog.record(
        "info",
        "bot",
        `plugin ${ctx.pluginKey} sent message in channel ${body.channel_id}`,
        { pluginId: ctx.pluginId, channelId: body.channel_id, messageId: sent.id },
      );
      return { id: sent.id, channel_id: sent.channelId };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      reply.code(400).send({ error: `send failed: ${msg}` });
      return;
    }
  });

  // ─── messages.delete ──────────────────────────────────────────────
  server.post<{
    Body: { channel_id?: unknown; message_id?: unknown };
  }>("/api/plugin/messages.delete", async (request, reply) => {
    const ctx = await requireScope(request, reply, "messages.delete");
    if (!ctx) return;
    if (!bot) {
      reply.code(503).send({ error: "bot client unavailable" });
      return;
    }
    const body = request.body ?? {};
    if (
      typeof body.channel_id !== "string" ||
      typeof body.message_id !== "string"
    ) {
      reply.code(400).send({ error: "channel_id + message_id required" });
      return;
    }
    try {
      const channel = await bot.channels.fetch(body.channel_id);
      if (!channel || !channel.isTextBased() || channel.type === ChannelType.GroupDM) {
        reply.code(400).send({ error: "channel not text-based" });
        return;
      }
      const msg = await channel.messages.fetch(body.message_id);
      await msg.delete();
      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      reply.code(400).send({ error: `delete failed: ${msg}` });
    }
  });

  // ─── messages.add_reaction ────────────────────────────────────────
  server.post<{
    Body: { channel_id?: unknown; message_id?: unknown; emoji?: unknown };
  }>("/api/plugin/messages.add_reaction", async (request, reply) => {
    const ctx = await requireScope(request, reply, "messages.add_reaction");
    if (!ctx) return;
    if (!bot) {
      reply.code(503).send({ error: "bot client unavailable" });
      return;
    }
    const body = request.body ?? {};
    if (
      typeof body.channel_id !== "string" ||
      typeof body.message_id !== "string" ||
      typeof body.emoji !== "string"
    ) {
      reply
        .code(400)
        .send({ error: "channel_id + message_id + emoji required" });
      return;
    }
    try {
      const channel = await bot.channels.fetch(body.channel_id);
      if (!channel || !channel.isTextBased()) {
        reply.code(400).send({ error: "channel not text-based" });
        return;
      }
      const msg = await channel.messages.fetch(body.message_id);
      await msg.react(body.emoji);
      return { ok: true };
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      reply.code(400).send({ error: `add_reaction failed: ${m}` });
    }
  });

  // ─── storage.kv_get ───────────────────────────────────────────────
  server.post<{
    Body: { guild_id?: unknown; key?: unknown };
  }>("/api/plugin/storage.kv_get", async (request, reply) => {
    const ctx = await requireScope(request, reply, "storage.kv_get");
    if (!ctx) return;
    const body = request.body ?? {};
    if (typeof body.guild_id !== "string" || body.guild_id.length === 0) {
      reply.code(400).send({ error: "guild_id required" });
      return;
    }
    if (typeof body.key !== "string" || body.key.length === 0) {
      reply.code(400).send({ error: "key required" });
      return;
    }
    const row = await getKv(ctx.pluginId, body.guild_id, body.key);
    if (!row) {
      return { found: false, value: null };
    }
    return { found: true, value: row.value, bytes: row.bytes };
  });

  // ─── storage.kv_set ───────────────────────────────────────────────
  server.post<{
    Body: { guild_id?: unknown; key?: unknown; value?: unknown };
  }>("/api/plugin/storage.kv_set", async (request, reply) => {
    const ctx = await requireScope(request, reply, "storage.kv_set");
    if (!ctx) return;
    const body = request.body ?? {};
    if (typeof body.guild_id !== "string" || body.guild_id.length === 0) {
      reply.code(400).send({ error: "guild_id required" });
      return;
    }
    if (
      typeof body.key !== "string" ||
      body.key.length === 0 ||
      body.key.length > KV_KEY_MAX
    ) {
      reply
        .code(400)
        .send({ error: `key required (max ${KV_KEY_MAX} chars)` });
      return;
    }
    if (typeof body.value !== "string") {
      reply.code(400).send({ error: "value must be a string" });
      return;
    }
    const incomingBytes = Buffer.byteLength(body.value, "utf8");
    if (incomingBytes > KV_VALUE_MAX_BYTES) {
      reply
        .code(413)
        .send({ error: `value exceeds per-row hard cap (${KV_VALUE_MAX_BYTES}B)` });
      return;
    }
    // Quota check: sum existing bytes minus what this key already
    // holds (we're overwriting, so subtract it from the budget).
    const quota = await quotaForGuildKv(ctx.pluginId);
    const currentTotal = await sumGuildBytes(ctx.pluginId, body.guild_id);
    const existing = await getKv(ctx.pluginId, body.guild_id, body.key);
    const projected = currentTotal - (existing?.bytes ?? 0) + incomingBytes;
    if (projected > quota) {
      reply.code(413).send({
        error: `would exceed plugin guild_kv quota (${projected}B / ${quota}B)`,
      });
      return;
    }
    const row = await setKv(
      ctx.pluginId,
      body.guild_id,
      body.key,
      body.value,
    );
    return {
      ok: true,
      bytes: row.bytes,
      total_bytes: currentTotal - (existing?.bytes ?? 0) + row.bytes,
      quota_bytes: quota,
    };
  });

  // ─── storage.kv_delete ────────────────────────────────────────────
  server.post<{
    Body: { guild_id?: unknown; key?: unknown };
  }>("/api/plugin/storage.kv_delete", async (request, reply) => {
    const ctx = await requireScope(request, reply, "storage.kv_delete");
    if (!ctx) return;
    const body = request.body ?? {};
    if (typeof body.guild_id !== "string" || typeof body.key !== "string") {
      reply.code(400).send({ error: "guild_id + key required" });
      return;
    }
    const removed = await deleteKv(ctx.pluginId, body.guild_id, body.key);
    return { removed };
  });

  // ─── storage.kv_list ──────────────────────────────────────────────
  server.post<{
    Body: {
      guild_id?: unknown;
      prefix?: unknown;
      limit?: unknown;
      offset?: unknown;
    };
  }>("/api/plugin/storage.kv_list", async (request, reply) => {
    const ctx = await requireScope(request, reply, "storage.kv_list");
    if (!ctx) return;
    const body = request.body ?? {};
    if (typeof body.guild_id !== "string") {
      reply.code(400).send({ error: "guild_id required" });
      return;
    }
    const prefix = typeof body.prefix === "string" ? body.prefix : undefined;
    const limit = typeof body.limit === "number" ? body.limit : 100;
    const offset = typeof body.offset === "number" ? body.offset : 0;
    const result = await listKvKeys(ctx.pluginId, body.guild_id, {
      prefix,
      limit,
      offset,
    });
    return { keys: result.keys, total: result.total };
  });

  // ─── plugin self-info ─────────────────────────────────────────────
  /**
   * GET /api/plugin/me
   * Returns the plugin's own row from the bot's perspective. Useful
   * for plugins to confirm their effective scopes / id without
   * needing a debug endpoint of their own.
   */
  server.get("/api/plugin/me", async (request, reply) => {
    const auth = request.pluginAuth;
    if (!auth) {
      reply.code(401).send({ error: "plugin auth missing" });
      return;
    }
    const plugin = await findPluginById(auth.pluginId);
    if (!plugin) {
      reply.code(404).send({ error: "plugin row not found" });
      return;
    }
    return {
      id: plugin.id,
      pluginKey: plugin.pluginKey,
      version: plugin.version,
      enabled: plugin.enabled,
      status: plugin.status,
      scopes: Array.from(auth.scopes),
    };
  });
}
