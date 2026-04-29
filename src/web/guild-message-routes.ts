import type { FastifyInstance } from "fastify";
import { ChannelType } from "discord.js";
import { requireGuildCapability } from "../modules/web-core/route-guards.js";
import { isSnowflake } from "../modules/web-core/validators.js";
import {
  type GuildManagementRoutesOptions,
  fetchTextLike,
} from "./guild-management-shared.js";

export async function registerGuildMessageRoutes(
  server: FastifyInstance,
  options: GuildManagementRoutesOptions,
): Promise<void> {
  const { bot } = options;

  // ── Message ops (pin, unpin, crosspost) ─────────────────────────────

  server.post<{
    Params: { guildId: string; channelId: string; messageId: string };
  }>(
    "/api/guilds/:guildId/text-channels/:channelId/messages/:messageId/pin",
    async (request, reply) => {
      if (
        !requireGuildCapability(
          request,
          reply,
          request.params.guildId,
          "manage",
        )
      )
        return;
      const { guildId, channelId, messageId } = request.params;
      if (!isSnowflake(messageId)) {
        reply.code(400).send({ error: "invalid messageId" });
        return;
      }
      const channel = fetchTextLike(bot, guildId, channelId);
      if (!channel) {
        reply.code(404).send({ error: "Unknown channel" });
        return;
      }
      try {
        const message = await channel.messages.fetch(messageId);
        await message.pin();
        reply.code(204).send();
      } catch (err) {
        request.log.error({ err }, "failed to pin message");
        reply.code(502).send({ error: "Failed to pin message" });
      }
    },
  );

  server.delete<{
    Params: { guildId: string; channelId: string; messageId: string };
  }>(
    "/api/guilds/:guildId/text-channels/:channelId/messages/:messageId/pin",
    async (request, reply) => {
      if (
        !requireGuildCapability(
          request,
          reply,
          request.params.guildId,
          "manage",
        )
      )
        return;
      const { guildId, channelId, messageId } = request.params;
      if (!isSnowflake(messageId)) {
        reply.code(400).send({ error: "invalid messageId" });
        return;
      }
      const channel = fetchTextLike(bot, guildId, channelId);
      if (!channel) {
        reply.code(404).send({ error: "Unknown channel" });
        return;
      }
      try {
        const message = await channel.messages.fetch(messageId);
        await message.unpin();
        reply.code(204).send();
      } catch (err) {
        request.log.error({ err }, "failed to unpin message");
        reply.code(502).send({ error: "Failed to unpin message" });
      }
    },
  );

  server.post<{
    Params: { guildId: string; channelId: string; messageId: string };
  }>(
    "/api/guilds/:guildId/text-channels/:channelId/messages/:messageId/crosspost",
    async (request, reply) => {
      if (
        !requireGuildCapability(
          request,
          reply,
          request.params.guildId,
          "manage",
        )
      )
        return;
      const { guildId, channelId, messageId } = request.params;
      if (!isSnowflake(messageId)) {
        reply.code(400).send({ error: "invalid messageId" });
        return;
      }
      const channel = fetchTextLike(bot, guildId, channelId);
      if (!channel) {
        reply.code(404).send({ error: "Unknown channel" });
        return;
      }
      // crosspost is only valid in announcement channels — Discord
      // returns 50068 otherwise. We pre-check so the UI can hide the
      // entry; the route is the safety net.
      const ch = bot.guilds.cache.get(guildId)?.channels.cache.get(channelId);
      if (!ch || ch.type !== ChannelType.GuildAnnouncement) {
        reply
          .code(400)
          .send({ error: "crosspost only valid in announcement channels" });
        return;
      }
      try {
        const message = await channel.messages.fetch(messageId);
        await message.crosspost();
        reply.code(204).send();
      } catch (err) {
        request.log.error({ err }, "failed to crosspost message");
        reply.code(502).send({ error: "Failed to crosspost message" });
      }
    },
  );
}
