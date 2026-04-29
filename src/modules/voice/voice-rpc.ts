/**
 * Plugin RPC for voice control.
 *
 * Plugins call these to make the bot join/leave a guild voice channel
 * and stream an audio URL. Mounted by plugin-rpc-routes alongside its
 * other endpoints — a thin auth wrapper checks the plugin's scope set.
 *
 * Required scopes (manifest.scopes / token.scopes):
 *   voice.join     — joinVoiceChannel
 *   voice.leave    — leave
 *   voice.play     — play a URL
 *   voice.stop     — stop playback
 *   voice.status   — read connection status
 *
 * The plugin must already know the channel id (it gets one via the
 * Discord events bridge or its own discovery). We don't auto-join from
 * the message author's voice state because that requires guild member
 * intent and a richer body shape; plugins that want that pattern can
 * implement it themselves and just hand us a channel_id.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Client } from "discord.js";
import { ChannelType } from "discord.js";
import {
  joinVoice,
  leaveVoice,
  playUrl,
  stopPlayback,
  getStatus,
} from "./voice-manager.service.js";
import { findPluginById } from "../plugin-system/models/plugin.model.js";

interface VoiceRpcOptions {
  bot?: Client;
}

async function requireScope(
  request: FastifyRequest,
  reply: FastifyReply,
  scope: string,
): Promise<{ pluginId: number } | null> {
  const auth = request.pluginAuth;
  if (!auth) {
    reply.code(401).send({ error: "plugin auth missing" });
    return null;
  }
  if (!auth.scopes.has(scope)) {
    reply.code(403).send({ error: `plugin token missing scope '${scope}'` });
    return null;
  }
  const plugin = await findPluginById(auth.pluginId);
  if (!plugin || !plugin.enabled || plugin.status !== "active") {
    reply
      .code(403)
      .send({ error: "plugin is disabled or inactive on the bot" });
    return null;
  }
  return { pluginId: auth.pluginId };
}

export async function registerVoiceRpcRoutes(
  server: FastifyInstance,
  options: VoiceRpcOptions,
): Promise<void> {
  const bot = options.bot;

  // POST /api/plugin/voice.join
  // Body: { guild_id: string, channel_id: string, self_deaf?: boolean,
  //         self_mute?: boolean }
  server.post<{
    Body: {
      guild_id?: unknown;
      channel_id?: unknown;
      self_deaf?: unknown;
      self_mute?: unknown;
    };
  }>("/api/plugin/voice.join", async (request, reply) => {
    const ctx = await requireScope(request, reply, "voice.join");
    if (!ctx) return;
    if (!bot) {
      reply.code(503).send({ error: "bot client unavailable" });
      return;
    }
    const body = request.body ?? {};
    if (
      typeof body.guild_id !== "string" ||
      typeof body.channel_id !== "string"
    ) {
      reply.code(400).send({ error: "guild_id and channel_id required" });
      return;
    }
    const guild = await bot.guilds.fetch(body.guild_id).catch(() => null);
    if (!guild) {
      reply.code(404).send({ error: "guild not found or bot not in it" });
      return;
    }
    const channel = await guild.channels
      .fetch(body.channel_id)
      .catch(() => null);
    if (
      !channel ||
      (channel.type !== ChannelType.GuildVoice &&
        channel.type !== ChannelType.GuildStageVoice)
    ) {
      reply.code(404).send({ error: "voice channel not found" });
      return;
    }
    const status = await joinVoice({
      guildId: body.guild_id,
      channelId: body.channel_id,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: typeof body.self_deaf === "boolean" ? body.self_deaf : true,
      selfMute: typeof body.self_mute === "boolean" ? body.self_mute : false,
    });
    return status;
  });

  server.post<{ Body: { guild_id?: unknown } }>(
    "/api/plugin/voice.leave",
    async (request, reply) => {
      const ctx = await requireScope(request, reply, "voice.leave");
      if (!ctx) return;
      const body = request.body ?? {};
      if (typeof body.guild_id !== "string") {
        reply.code(400).send({ error: "guild_id required" });
        return;
      }
      return leaveVoice(body.guild_id);
    },
  );

  server.post<{ Body: { guild_id?: unknown; url?: unknown } }>(
    "/api/plugin/voice.play",
    async (request, reply) => {
      const ctx = await requireScope(request, reply, "voice.play");
      if (!ctx) return;
      const body = request.body ?? {};
      if (typeof body.guild_id !== "string") {
        reply.code(400).send({ error: "guild_id required" });
        return;
      }
      if (typeof body.url !== "string" || body.url.length === 0) {
        reply.code(400).send({ error: "url required" });
        return;
      }
      let parsed: URL;
      try {
        parsed = new URL(body.url);
      } catch {
        reply.code(400).send({ error: "url not a valid URL" });
        return;
      }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        reply.code(400).send({ error: "only http(s) URLs accepted" });
        return;
      }
      try {
        return playUrl(body.guild_id, body.url);
      } catch (err) {
        if (err instanceof Error && err.message === "not_joined") {
          reply
            .code(409)
            .send({ error: "bot not joined to a voice channel in that guild" });
          return;
        }
        if (err instanceof Error && err.message === "ffmpeg_not_available") {
          reply.code(503).send({ error: "ffmpeg unavailable" });
          return;
        }
        throw err;
      }
    },
  );

  server.post<{ Body: { guild_id?: unknown } }>(
    "/api/plugin/voice.stop",
    async (request, reply) => {
      const ctx = await requireScope(request, reply, "voice.stop");
      if (!ctx) return;
      const body = request.body ?? {};
      if (typeof body.guild_id !== "string") {
        reply.code(400).send({ error: "guild_id required" });
        return;
      }
      return stopPlayback(body.guild_id);
    },
  );

  server.post<{ Body: { guild_id?: unknown } }>(
    "/api/plugin/voice.status",
    async (request, reply) => {
      const ctx = await requireScope(request, reply, "voice.status");
      if (!ctx) return;
      const body = request.body ?? {};
      if (typeof body.guild_id !== "string") {
        reply.code(400).send({ error: "guild_id required" });
        return;
      }
      return getStatus(body.guild_id);
    },
  );
}
