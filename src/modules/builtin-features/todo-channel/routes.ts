import type { FastifyInstance } from "fastify";
import { requireGuildCapability } from "../../web-core/route-guards.js";
import { isSnowflake } from "../../web-core/validators.js";
import { TodoChannel } from "./todo-channel.model.js";
import type { GuildManagementRoutesOptions } from "../../../web/guild-management-shared.js";

export async function registerTodoChannelRoutes(
  server: FastifyInstance,
  _options: GuildManagementRoutesOptions,
): Promise<void> {
  server.post<{ Params: { guildId: string }; Body: { channelId?: unknown } }>(
    "/api/guilds/:guildId/feature/todo-channels",
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
      await TodoChannel.upsert({ channelId, guildId });
      reply.code(204).send();
    },
  );
  server.delete<{ Params: { guildId: string; channelId: string } }>(
    "/api/guilds/:guildId/feature/todo-channels/:channelId",
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
      await TodoChannel.destroy({ where: { guildId, channelId } });
      reply.code(204).send();
    },
  );
}
