import type { FastifyInstance } from "fastify";
import { requireGuildCapability } from "../modules/web-core/route-guards.js";
import { isSnowflake } from "../modules/web-core/validators.js";
import {
  type GuildManagementRoutesOptions,
  parseRoleBody,
} from "./guild-management-shared.js";

export async function registerGuildRoleRoutes(
  server: FastifyInstance,
  options: GuildManagementRoutesOptions,
): Promise<void> {
  const { bot } = options;

  // ── Role CRUD ────────────────────────────────────────────────────────

  server.post<{
    Params: { guildId: string };
    Body: {
      name?: unknown;
      color?: unknown;
      hoist?: unknown;
      mentionable?: unknown;
      permissions?: unknown;
      reason?: unknown;
    };
  }>("/api/guilds/:guildId/roles", async (request, reply) => {
    if (
      !requireGuildCapability(request, reply, request.params.guildId, "manage")
    )
      return;
    const { guildId } = request.params;
    const guild = bot.guilds.cache.get(guildId);
    if (!guild) {
      reply.code(404).send({ error: "Unknown guild" });
      return;
    }
    const opts = parseRoleBody(request.body ?? {});
    if (opts.error) {
      reply.code(400).send({ error: opts.error });
      return;
    }
    try {
      const role = await guild.roles.create({
        name: opts.name ?? undefined,
        color: opts.color ?? undefined,
        hoist: opts.hoist ?? undefined,
        mentionable: opts.mentionable ?? undefined,
        permissions: opts.permissions ?? undefined,
        reason: opts.reason,
      });
      return { id: role.id };
    } catch (err) {
      request.log.error({ err }, "failed to create role");
      reply.code(502).send({ error: "Failed to create role" });
    }
  });

  server.patch<{
    Params: { guildId: string; roleId: string };
    Body: {
      name?: unknown;
      color?: unknown;
      hoist?: unknown;
      mentionable?: unknown;
      permissions?: unknown;
      reason?: unknown;
    };
  }>("/api/guilds/:guildId/roles/:roleId", async (request, reply) => {
    if (
      !requireGuildCapability(request, reply, request.params.guildId, "manage")
    )
      return;
    const { guildId, roleId } = request.params;
    if (!isSnowflake(roleId)) {
      reply.code(400).send({ error: "invalid roleId" });
      return;
    }
    const guild = bot.guilds.cache.get(guildId);
    if (!guild) {
      reply.code(404).send({ error: "Unknown guild" });
      return;
    }
    const role = guild.roles.cache.get(roleId);
    if (!role) {
      reply.code(404).send({ error: "Unknown role" });
      return;
    }
    const opts = parseRoleBody(request.body ?? {});
    if (opts.error) {
      reply.code(400).send({ error: opts.error });
      return;
    }
    try {
      await role.edit({
        name: opts.name ?? undefined,
        color: opts.color ?? undefined,
        hoist: opts.hoist ?? undefined,
        mentionable: opts.mentionable ?? undefined,
        permissions: opts.permissions ?? undefined,
        reason: opts.reason,
      });
      reply.code(204).send();
    } catch (err) {
      request.log.error({ err }, "failed to edit role");
      reply.code(502).send({ error: "Failed to edit role" });
    }
  });

  server.delete<{
    Params: { guildId: string; roleId: string };
    Body: { reason?: unknown };
  }>("/api/guilds/:guildId/roles/:roleId", async (request, reply) => {
    if (
      !requireGuildCapability(request, reply, request.params.guildId, "manage")
    )
      return;
    const { guildId, roleId } = request.params;
    if (!isSnowflake(roleId)) {
      reply.code(400).send({ error: "invalid roleId" });
      return;
    }
    const guild = bot.guilds.cache.get(guildId);
    if (!guild) {
      reply.code(404).send({ error: "Unknown guild" });
      return;
    }
    const reason =
      typeof request.body?.reason === "string"
        ? request.body.reason
        : undefined;
    try {
      await guild.roles.delete(roleId, reason);
      reply.code(204).send();
    } catch (err) {
      request.log.error({ err }, "failed to delete role");
      reply.code(502).send({ error: "Failed to delete role" });
    }
  });
}
