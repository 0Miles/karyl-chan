import type { FastifyInstance } from "fastify";
import { AuditLogEvent } from "discord.js";
import { requireGuildCapability } from "./route-guards.js";
import { isSnowflake } from "./validators.js";
import { avatarUrlFor } from "./message-mapper.js";
import { guildChannelEventBus } from "./guild-channel-event-bus.js";
import { type GuildManagementRoutesOptions } from "./guild-management-shared.js";
import { registerGuildMemberRoutes } from "./guild-member-routes.js";
import { registerGuildMessageRoutes } from "./guild-message-routes.js";
import { registerGuildRoleRoutes } from "./guild-role-routes.js";
import { registerGuildSettingsRoutes } from "./guild-settings-routes.js";
import { registerGuildAutomodRoutes } from "./guild-automod-routes.js";
import { registerGuildChannelMgmtRoutes } from "./guild-channel-mgmt-routes.js";
import { registerGuildBotFeatureRoutes } from "./guild-bot-feature-routes.js";

export type { GuildManagementRoutesOptions };

/**
 * Routes for guild-level moderation actions: member kick / ban / timeout /
 * nickname / role assignment, and message-channel ops that affect a single
 * message (pin, unpin, crosspost) plus channel-level bulk delete.
 *
 * All endpoints require `guild.write` and forward to discord.js, which
 * surfaces a 50013 when the bot lacks the underlying Discord permission
 * (KickMembers / BanMembers / ModerateMembers / ManageNicknames /
 * ManageRoles / ManageMessages). We don't pre-check those because Discord
 * is the source of truth and double-checking just creates drift.
 */
export async function registerGuildManagementRoutes(
  server: FastifyInstance,
  options: GuildManagementRoutesOptions,
): Promise<void> {
  const { bot } = options;
  const events = options.eventBus ?? guildChannelEventBus;

  await registerGuildMemberRoutes(server, options);
  await registerGuildMessageRoutes(server, options);
  await registerGuildRoleRoutes(server, options);
  await registerGuildSettingsRoutes(server, options);
  await registerGuildAutomodRoutes(server, options);
  await registerGuildChannelMgmtRoutes(server, options, events);
  await registerGuildBotFeatureRoutes(server, options);

  // ── Audit log ──────────────────────────────────────────────────────

  server.get<{
    Params: { guildId: string };
    Querystring: {
      limit?: string;
      before?: string;
      type?: string;
      user?: string;
    };
  }>("/api/guilds/:guildId/audit-logs", async (request, reply) => {
    if (
      !requireGuildCapability(request, reply, request.params.guildId, "manage")
    )
      return;
    const guild = bot.guilds.cache.get(request.params.guildId);
    if (!guild) {
      reply.code(404).send({ error: "Unknown guild" });
      return;
    }
    const limit = Math.min(
      Math.max(Number(request.query.limit ?? 50) || 50, 1),
      100,
    );
    const before =
      typeof request.query.before === "string" &&
      isSnowflake(request.query.before)
        ? request.query.before
        : undefined;
    const userId =
      typeof request.query.user === "string" && isSnowflake(request.query.user)
        ? request.query.user
        : undefined;
    const typeNum = request.query.type ? Number(request.query.type) : undefined;
    const type =
      typeof typeNum === "number" && Number.isFinite(typeNum)
        ? typeNum
        : undefined;
    try {
      const logs = await guild.fetchAuditLogs({
        limit,
        before,
        user: userId,
        type,
      });
      const entries = [...logs.entries.values()].map((e) => ({
        id: e.id,
        actionType: Number(e.action),
        actionTypeName: AuditLogEvent[e.action] ?? `Action ${e.action}`,
        targetId: e.targetId,
        executor: e.executor
          ? {
              id: e.executor.id,
              username: e.executor.username,
              globalName: e.executor.globalName ?? null,
              avatarUrl: avatarUrlFor(e.executor.id, e.executor.avatar, 64),
            }
          : null,
        reason: e.reason ?? null,
        createdAt: e.createdAt.toISOString(),
        changes: (e.changes ?? []).map((c) => ({
          key: c.key,
          oldValue: c.old ?? null,
          newValue: c.new ?? null,
        })),
      }));
      return { entries };
    } catch (err) {
      request.log.error({ err }, "failed to fetch audit logs");
      reply.code(502).send({ error: "Failed to fetch audit logs" });
    }
  });
}
