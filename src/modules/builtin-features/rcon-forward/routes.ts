import type { FastifyInstance } from "fastify";
import { requireGuildCapability } from "../../web-core/route-guards.js";
import { isSnowflake } from "../../web-core/validators.js";
import { RconForwardChannel } from "./rcon-forward-channel.model.js";
import type { GuildManagementRoutesOptions } from "../../guild-management/guild-management-shared.js";

export async function registerRconForwardChannelRoutes(
  server: FastifyInstance,
  _options: GuildManagementRoutesOptions,
): Promise<void> {
  server.post<{
    Params: { guildId: string };
    Body: {
      channelId?: unknown;
      host?: unknown;
      port?: unknown;
      password?: unknown;
      commandPrefix?: unknown;
      triggerPrefix?: unknown;
    };
  }>("/api/guilds/:guildId/feature/rcon-channels", async (request, reply) => {
    if (
      !requireGuildCapability(request, reply, request.params.guildId, "manage")
    )
      return;
    const { guildId } = request.params;
    const b = request.body ?? {};
    if (typeof b.channelId !== "string" || !isSnowflake(b.channelId)) {
      reply.code(400).send({ error: "channelId required" });
      return;
    }
    await RconForwardChannel.upsert({
      channelId: b.channelId,
      guildId,
      host: typeof b.host === "string" ? b.host : null,
      port:
        typeof b.port === "number" && Number.isFinite(b.port)
          ? Math.floor(b.port)
          : null,
      password: typeof b.password === "string" ? b.password : null,
      commandPrefix:
        typeof b.commandPrefix === "string" ? b.commandPrefix : null,
      triggerPrefix:
        typeof b.triggerPrefix === "string" ? b.triggerPrefix : null,
    });
    reply.code(204).send();
  });
  server.delete<{ Params: { guildId: string; channelId: string } }>(
    "/api/guilds/:guildId/feature/rcon-channels/:channelId",
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
      await RconForwardChannel.destroy({ where: { guildId, channelId } });
      reply.code(204).send();
    },
  );
}
