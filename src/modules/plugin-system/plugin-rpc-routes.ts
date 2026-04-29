import type { Client } from "discord.js";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ChannelType, Routes, MessageFlags } from "discord.js";
import { findPluginById } from "./models/plugin.model.js";
import {
  deleteKv,
  getKv,
  incrementKv,
  listKvKeys,
  setKv,
  sumGuildBytes,
} from "./models/plugin-kv.model.js";
import {
  deleteConfigKey,
  findConfigByPlugin,
  upsertConfigKey,
} from "./models/plugin-config.model.js";
import { decryptSecret } from "../../utils/crypto.js";
import { botEventLog } from "../../web/bot-event-log.js";
import type { PluginManifest } from "./plugin-registry.service.js";

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
  reply.code(403).send({ error: `plugin token missing scope '${scope}'` });
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
    const content = typeof body.content === "string" ? body.content : undefined;
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
      reply.code(400).send({ error: "channel is not text-sendable" });
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
        {
          pluginId: ctx.pluginId,
          channelId: body.channel_id,
          messageId: sent.id,
        },
      );
      return { id: sent.id, channel_id: sent.channelId };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      reply.code(400).send({ error: `send failed: ${msg}` });
      return;
    }
  });

  // ─── messages.send_dm ─────────────────────────────────────────────
  /**
   * POST /api/plugin/messages.send_dm
   * Body: { user_id: string, content?: string, embeds?: APIEmbed[],
   *         allowed_mentions?: { parse?: ('users'|'roles'|'everyone')[] } }
   * Returns: { id, channel_id }
   *
   * Higher-level than messages.send: the plugin gives a Discord user
   * id and we resolve / create the DM channel for them, then send.
   * Without this, the plugin would need a way to discover the user's
   * DM channel id (which Discord doesn't expose to bots), so DM
   * relay-style plugins were impossible to implement at all.
   *
   * Subject to the same allowed_mentions default-deny as messages.send.
   * 404 if the user_id doesn't resolve; 400 if the user has DMs
   * disabled (Discord raises CANNOT_SEND_MESSAGES_TO_THIS_USER).
   */
  server.post<{
    Body: {
      user_id?: unknown;
      content?: unknown;
      embeds?: unknown;
      allowed_mentions?: unknown;
    };
  }>("/api/plugin/messages.send_dm", async (request, reply) => {
    const ctx = await requireScope(request, reply, "messages.send_dm");
    if (!ctx) return;
    if (!bot) {
      reply.code(503).send({ error: "bot client unavailable" });
      return;
    }
    const body = request.body ?? {};
    if (typeof body.user_id !== "string" || body.user_id.length === 0) {
      reply.code(400).send({ error: "user_id required" });
      return;
    }
    const content = typeof body.content === "string" ? body.content : undefined;
    const embeds = Array.isArray(body.embeds) ? body.embeds : undefined;
    if (!content && !embeds) {
      reply.code(400).send({ error: "content or embeds required" });
      return;
    }
    let user;
    try {
      user = await bot.users.fetch(body.user_id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      reply.code(404).send({ error: `user fetch failed: ${msg}` });
      return;
    }
    const allowedMentions =
      body.allowed_mentions && typeof body.allowed_mentions === "object"
        ? (body.allowed_mentions as Record<string, unknown>)
        : { parse: [] };
    try {
      const sent = await user.send({
        content,
        embeds: embeds as never,
        allowedMentions: allowedMentions as never,
      });
      botEventLog.record(
        "info",
        "bot",
        `plugin ${ctx.pluginKey} DM'd user ${body.user_id}`,
        {
          pluginId: ctx.pluginId,
          userId: body.user_id,
          messageId: sent.id,
        },
      );
      return { id: sent.id, channel_id: sent.channelId };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      reply.code(400).send({ error: `send_dm failed: ${msg}` });
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
      if (
        !channel ||
        !channel.isTextBased() ||
        channel.type === ChannelType.GroupDM
      ) {
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

  // ─── config.get ────────────────────────────────────────────────────
  /**
   * POST /api/plugin/config.get
   * Body: {} (no params; plugin only sees its own config)
   * Returns:
   *   { values: Record<string, string>, schema: ManifestConfigField[] }
   *
   * Surfaces the plugin's combined config map. Values for `secret`-
   * typed admin fields are decrypted on the way out — the plugin
   * needs the real value to act on it. Plugin-self KV (config.set
   * source='plugin') is included alongside admin-edited fields so the
   * plugin sees one flat map.
   *
   * Rate-limit-friendly: rebuilding the full map per call is fine
   * (config rows are O(few-dozen) per plugin). Plugins that hot-loop
   * config.get on every event should cache locally and rely on
   * push-style update via re-poll on a known cadence.
   */
  server.post("/api/plugin/config.get", async (request, reply) => {
    const ctx = await requireScope(request, reply, "config.get");
    if (!ctx) return;
    const plugin = await findPluginById(ctx.pluginId);
    if (!plugin) {
      reply.code(404).send({ error: "plugin row vanished" });
      return;
    }
    const manifest = (() => {
      try {
        return JSON.parse(plugin.manifestJson) as PluginManifest;
      } catch {
        return null;
      }
    })();
    const schemaByKey = new Map(
      (manifest?.config_schema ?? []).map((f) => [f.key, f]),
    );
    const rows = await findConfigByPlugin(ctx.pluginId);
    const values: Record<string, string> = {};
    for (const row of rows) {
      if (row.source === "admin") {
        const field = schemaByKey.get(row.key);
        if (field?.type === "secret" && row.value.length > 0) {
          try {
            values[row.key] = decryptSecret(row.value);
          } catch (err) {
            // A decrypt failure means the row was written with a
            // different ENCRYPTION_KEY (rare; key rotation). Skip
            // rather than crash the RPC; the plugin will see the
            // missing key and can ask the operator to re-enter.
            const msg = err instanceof Error ? err.message : String(err);
            botEventLog.record(
              "warn",
              "bot",
              `config.get: decrypt failed for ${plugin.pluginKey}/${row.key}: ${msg}`,
              { pluginId: ctx.pluginId, key: row.key },
            );
          }
        } else {
          values[row.key] = row.value;
        }
      } else {
        values[row.key] = row.value;
      }
    }
    return { values, schema: manifest?.config_schema ?? [] };
  });

  // ─── config.set ────────────────────────────────────────────────────
  /**
   * POST /api/plugin/config.set
   * Body: { key: string, value: string | null }
   *
   * Plugin-self KV write. Stored under source='plugin' so it never
   * collides with admin-controlled config_schema rows. `null` deletes.
   *
   * For admin-controlled config_schema fields the plugin can READ
   * via config.get but CANNOT set — the plugin's value would be
   * silently overwritten by the next admin save and the source-
   * isolation rule in upsertConfigKey rejects the write outright.
   */
  server.post<{ Body: { key?: unknown; value?: unknown } }>(
    "/api/plugin/config.set",
    async (request, reply) => {
      const ctx = await requireScope(request, reply, "config.set");
      if (!ctx) return;
      const body = request.body ?? {};
      if (typeof body.key !== "string" || body.key.length === 0) {
        reply.code(400).send({ error: "key required" });
        return;
      }
      if (body.key.length > 200) {
        reply.code(400).send({ error: "key exceeds 200 chars" });
        return;
      }
      if (
        body.value !== null &&
        body.value !== undefined &&
        typeof body.value !== "string"
      ) {
        reply.code(400).send({ error: "value must be string or null" });
        return;
      }
      try {
        if (body.value === null || body.value === undefined) {
          const removed = await deleteConfigKey(
            ctx.pluginId,
            body.key,
            "plugin",
          );
          return { removed };
        }
        await upsertConfigKey(ctx.pluginId, body.key, body.value, "plugin");
        return { ok: true };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("cannot overwrite") || msg.includes("cannot delete")) {
          reply.code(409).send({ error: msg });
          return;
        }
        reply.code(500).send({ error: `config.set failed: ${msg}` });
      }
    },
  );

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
      reply.code(400).send({ error: `key required (max ${KV_KEY_MAX} chars)` });
      return;
    }
    if (typeof body.value !== "string") {
      reply.code(400).send({ error: "value must be a string" });
      return;
    }
    const incomingBytes = Buffer.byteLength(body.value, "utf8");
    if (incomingBytes > KV_VALUE_MAX_BYTES) {
      reply.code(413).send({
        error: `value exceeds per-row hard cap (${KV_VALUE_MAX_BYTES}B)`,
      });
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
    const row = await setKv(ctx.pluginId, body.guild_id, body.key, body.value);
    return {
      ok: true,
      bytes: row.bytes,
      total_bytes: currentTotal - (existing?.bytes ?? 0) + row.bytes,
      quota_bytes: quota,
    };
  });

  // ─── storage.kv_increment ─────────────────────────────────────────
  /**
   * POST /api/plugin/storage.kv_increment
   * Body: { guild_id: string, key: string, delta?: number = 1 }
   * Returns: { value: <new number after increment>, bytes, total_bytes, quota_bytes }
   *
   * Atomic counter: read-modify-write inside a single SQLite transaction
   * with row-level lock. Replaces the kv_get + kv_set sequence that
   * lost increments under concurrent calls. Existing value must parse
   * as a finite number; non-numeric existing values 422 (caller bug).
   *
   * Counts as a kv_set for quota purposes — the same per-guild byte
   * cap applies to the post-increment serialised value.
   */
  server.post<{
    Body: { guild_id?: unknown; key?: unknown; delta?: unknown };
  }>("/api/plugin/storage.kv_increment", async (request, reply) => {
    const ctx = await requireScope(request, reply, "storage.kv_increment");
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
    if (body.key.length > KV_KEY_MAX) {
      reply.code(400).send({ error: `key exceeds ${KV_KEY_MAX} chars` });
      return;
    }
    const deltaRaw = body.delta ?? 1;
    if (typeof deltaRaw !== "number" || !Number.isFinite(deltaRaw)) {
      reply.code(400).send({ error: "delta must be a finite number" });
      return;
    }
    try {
      const result = await incrementKv(
        ctx.pluginId,
        body.guild_id,
        body.key,
        deltaRaw,
      );
      const totalBytes = await sumGuildBytes(ctx.pluginId, body.guild_id);
      const quotaBytes = await quotaForGuildKv(ctx.pluginId);
      return {
        value: result.value,
        bytes: result.row.bytes,
        total_bytes: totalBytes,
        quota_bytes: quotaBytes,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Existing-value-not-numeric is the caller's bug, not the bot's
      // — surface it as 422 so the plugin's logs blame the right side.
      if (msg.includes("not a finite number")) {
        reply.code(422).send({ error: msg });
        return;
      }
      reply.code(500).send({ error: `kv_increment failed: ${msg}` });
    }
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

  // ─── interactions.respond ─────────────────────────────────────────
  /**
   * POST /api/plugin/interactions.respond
   * Body: { interaction_token, content?, embeds?, ephemeral? }
   *
   * Completes a deferred interaction reply. The bot defers immediately
   * on receipt; the plugin processes the command, then calls this to
   * fill in the placeholder reply within Discord's 15-minute window.
   *
   * `ephemeral` flips the message visible-to-others bit. If the
   * plugin doesn't pass it, we keep whatever ephemeral state the
   * defer already used (Discord won't let you change ephemerality
   * after defer anyway — the flag here is informational for follow
   * ups).
   */
  server.post<{
    Body: {
      interaction_token?: unknown;
      content?: unknown;
      embeds?: unknown;
      ephemeral?: unknown;
    };
  }>("/api/plugin/interactions.respond", async (request, reply) => {
    const ctx = await requireScope(request, reply, "interactions.respond");
    if (!ctx) return;
    if (!bot || !bot.application) {
      reply.code(503).send({ error: "bot client unavailable" });
      return;
    }
    const body = request.body ?? {};
    if (
      typeof body.interaction_token !== "string" ||
      body.interaction_token.length === 0
    ) {
      reply.code(400).send({ error: "interaction_token required" });
      return;
    }
    const content = typeof body.content === "string" ? body.content : undefined;
    const embeds = Array.isArray(body.embeds) ? body.embeds : undefined;
    if (!content && !embeds) {
      reply.code(400).send({ error: "content or embeds required" });
      return;
    }
    const ephemeral = body.ephemeral === true;
    try {
      // Edit the original (deferred) interaction reply via Discord
      // REST. Discord's webhook-message-edit endpoint accepts the
      // same shape as initial response except flags is read-only;
      // the ephemeral state was locked at defer time.
      await bot.rest.patch(
        Routes.webhookMessage(
          bot.application.id,
          body.interaction_token,
          "@original",
        ),
        {
          body: {
            content,
            embeds,
            // Honor `ephemeral` only as a signal — if defer was
            // public, Discord rejects this flag. Pass through and
            // let Discord ignore on mismatch.
            flags: ephemeral ? MessageFlags.Ephemeral : undefined,
            allowed_mentions: { parse: [] },
          },
        },
      );
      return { ok: true };
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      reply.code(400).send({ error: `respond failed: ${m}` });
    }
  });

  // ─── interactions.followup ────────────────────────────────────────
  /**
   * POST /api/plugin/interactions.followup
   * Body: { interaction_token, content?, embeds?, ephemeral? }
   *
   * Append a follow-up message to an existing interaction. Plugins
   * use this for streaming output / multi-message replies. Discord
   * caps at 5 follow-ups per interaction.
   */
  server.post<{
    Body: {
      interaction_token?: unknown;
      content?: unknown;
      embeds?: unknown;
      ephemeral?: unknown;
    };
  }>("/api/plugin/interactions.followup", async (request, reply) => {
    const ctx = await requireScope(request, reply, "interactions.followup");
    if (!ctx) return;
    if (!bot || !bot.application) {
      reply.code(503).send({ error: "bot client unavailable" });
      return;
    }
    const body = request.body ?? {};
    if (
      typeof body.interaction_token !== "string" ||
      body.interaction_token.length === 0
    ) {
      reply.code(400).send({ error: "interaction_token required" });
      return;
    }
    const content = typeof body.content === "string" ? body.content : undefined;
    const embeds = Array.isArray(body.embeds) ? body.embeds : undefined;
    if (!content && !embeds) {
      reply.code(400).send({ error: "content or embeds required" });
      return;
    }
    const ephemeral = body.ephemeral === true;
    try {
      const created = (await bot.rest.post(
        Routes.webhook(bot.application.id, body.interaction_token),
        {
          body: {
            content,
            embeds,
            flags: ephemeral ? MessageFlags.Ephemeral : undefined,
            allowed_mentions: { parse: [] },
          },
        },
      )) as { id?: string };
      return { ok: true, id: created.id ?? null };
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      reply.code(400).send({ error: `followup failed: ${m}` });
    }
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
