import type { FastifyInstance } from "fastify";
import { requireGuildCapability } from "../../web-core/route-guards.js";
import { isSnowflake } from "../../web-core/validators.js";
import { PictureOnlyChannel } from "./picture-only-channel.model.js";
import type { GuildManagementRoutesOptions } from "../../guild-management/guild-management-shared.js";

export async function registerPictureOnlyChannelRoutes(
  server: FastifyInstance,
  _options: GuildManagementRoutesOptions,
): Promise<void> {
  server.post<{ Params: { guildId: string }; Body: { channelId?: unknown } }>(
    "/api/guilds/:guildId/feature/picture-only-channels",
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
      const { guildId } = request.params;
      const channelId = request.body?.channelId;
      if (typeof channelId !== "string" || !isSnowflake(channelId)) {
        reply.code(400).send({ error: "channelId required" });
        return;
      }
      await PictureOnlyChannel.upsert({ channelId, guildId });
      reply.code(204).send();
    },
  );
  server.delete<{ Params: { guildId: string; channelId: string } }>(
    "/api/guilds/:guildId/feature/picture-only-channels/:channelId",
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
      const { guildId, channelId } = request.params;
      await PictureOnlyChannel.destroy({ where: { guildId, channelId } });
      reply.code(204).send();
    },
  );
}
