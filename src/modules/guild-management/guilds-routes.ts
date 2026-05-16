import type { FastifyInstance } from "fastify";
import type { Client } from "discord.js";
import { getGuildBuiltinSnapshot } from "../builtin-features/guild-builtin.service.js";
import { ChannelType } from "discord.js";
import {
  guildAccessFilter,
  requireAnyGuildCapability,
  requireGuildCapability,
} from "../web-core/route-guards.js";

export interface GuildsRoutesOptions {
  bot: Client;
}

interface GuildSummary {
  id: string;
  name: string;
  iconUrl: string | null;
  memberCount: number;
  ownerId: string | null;
  joinedAt: string | null;
}

function summariseGuilds(bot: Client): GuildSummary[] {
  return [...bot.guilds.cache.values()].map((g) => ({
    id: g.id,
    name: g.name,
    iconUrl: g.iconURL({ size: 128 }) ?? null,
    memberCount: g.memberCount ?? g.members.cache.size,
    ownerId: g.ownerId ?? null,
    joinedAt: g.joinedAt ? g.joinedAt.toISOString() : null,
  }));
}

export async function registerGuildsRoutes(
  server: FastifyInstance,
  options: GuildsRoutesOptions,
): Promise<void> {
  const { bot } = options;

  server.get("/api/guilds", async (request) => {
    // Listing intentionally returns 200 with an empty array for
    // callers with no guild grants — surfacing 403 here would make
    // it easy to fingerprint user permissions, and the empty list
    // is the same outcome from the UI's perspective.
    const allow = guildAccessFilter(request);
    const guilds = summariseGuilds(bot)
      .filter((g) => allow(g.id))
      .sort((a, b) => a.name.localeCompare(b.name));
    return { guilds };
  });

  server.get<{ Params: { guildId: string } }>(
    "/api/guilds/:guildId",
    async (request, reply) => {
      // Detail is the entry point for both message and manage UIs;
      // either scope is enough to read it.
      if (
        !requireAnyGuildCapability(request, reply, request.params.guildId, [
          "message",
          "manage",
        ])
      )
        return;
      const guild = bot.guilds.cache.get(request.params.guildId);
      if (!guild) {
        reply.code(404).send({ error: "Bot is not in this guild" });
        return;
      }
      // Refresh the guild from REST so memberCount, description, and the
      // rest of the cached payload aren't whatever stale snapshot was
      // captured at GUILD_CREATE — Discord doesn't push memberCount on
      // member join/leave for guilds without GUILD_MEMBERS intent.
      try {
        await guild.fetch();
      } catch (err) {
        request.log.warn(
          { err, guildId: guild.id },
          "guild.fetch failed (detail)",
        );
      }

      const snapshot = await getGuildBuiltinSnapshot(guild.id);

      // Channel / role names are derived from the live discord.js
      // cache here at response time — they're not stored in our DB
      // so the service layer can't know them. Same closures attach
      // them to each row before returning.
      const channelName = (id: string) =>
        guild.channels.cache.get(id)?.name ?? null;
      const roleName = (id: string) => guild.roles.cache.get(id)?.name ?? null;

      return {
        guild: {
          id: guild.id,
          name: guild.name,
          iconUrl: guild.iconURL({ size: 256 }) ?? null,
          memberCount: guild.memberCount ?? guild.members.cache.size,
          ownerId: guild.ownerId ?? null,
          joinedAt: guild.joinedAt ? guild.joinedAt.toISOString() : null,
          description: guild.description ?? null,
        },
        todoChannels: snapshot.todoChannels.map((r) => ({
          channelId: r.channelId,
          channelName: channelName(r.channelId),
        })),
        pictureOnlyChannels: snapshot.pictureOnlyChannels.map((r) => ({
          channelId: r.channelId,
          channelName: channelName(r.channelId),
        })),
        rconForwardChannels: snapshot.rconForwardChannels.map((r) => ({
          channelId: r.channelId,
          channelName: channelName(r.channelId),
          commandPrefix: r.commandPrefix,
          triggerPrefix: r.triggerPrefix,
          host: r.host,
          port: r.port,
        })),
        roleEmojiGroups: snapshot.roleEmojiGroups,
        roleEmojis: snapshot.roleEmojis.map((r) => ({
          groupId: r.groupId,
          roleId: r.roleId,
          roleName: roleName(r.roleId),
          emojiName: r.emojiName,
          emojiId: r.emojiId,
          emojiChar: r.emojiChar,
        })),
        roleReceiveMessages: snapshot.roleReceiveMessages.map((r) => ({
          channelId: r.channelId,
          channelName: channelName(r.channelId),
          messageId: r.messageId,
          groupId: r.groupId,
        })),
      };
    },
  );

  server.get<{ Params: { guildId: string } }>(
    "/api/guilds/:guildId/invites",
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
      const guild = bot.guilds.cache.get(request.params.guildId);
      if (!guild) {
        reply.code(404).send({ error: "Bot is not in this guild" });
        return;
      }
      try {
        const invites = await guild.invites.fetch();
        return {
          invites: [...invites.values()].map((inv) => ({
            code: inv.code,
            url: inv.url,
            channelId: inv.channelId ?? null,
            channelName: inv.channel?.name ?? null,
            inviterId: inv.inviterId ?? null,
            inviterName: inv.inviter?.username ?? null,
            uses: inv.uses ?? 0,
            maxUses: inv.maxUses ?? 0,
            maxAge: inv.maxAge ?? 0,
            temporary: !!inv.temporary,
            expiresAt: inv.expiresAt ? inv.expiresAt.toISOString() : null,
            createdAt: inv.createdAt ? inv.createdAt.toISOString() : null,
          })),
        };
      } catch (err) {
        request.log.error({ err }, "failed to fetch invites");
        reply.code(502).send({ error: "Failed to fetch invites" });
      }
    },
  );

  server.post<{
    Params: { guildId: string };
    Body: {
      channelId?: string;
      maxAge?: number;
      maxUses?: number;
      temporary?: boolean;
      unique?: boolean;
      reason?: string;
    };
  }>("/api/guilds/:guildId/invites", async (request, reply) => {
    if (
      !requireGuildCapability(request, reply, request.params.guildId, "manage")
    )
      return;
    const guild = bot.guilds.cache.get(request.params.guildId);
    if (!guild) {
      reply.code(404).send({ error: "Bot is not in this guild" });
      return;
    }
    const body = request.body ?? {};
    // Default to a known channel — we need an invitable target. The
    // caller supplies it explicitly when they have a preference;
    // otherwise we fall back to the system channel, then any text
    // channel we can write in.
    let channel = body.channelId
      ? guild.channels.cache.get(body.channelId)
      : (guild.systemChannel ??
        guild.channels.cache.find((c) => c.type === ChannelType.GuildText) ??
        null);
    if (!channel || !("createInvite" in channel)) {
      reply.code(400).send({ error: "No invitable channel found" });
      return;
    }
    // Bound the input — Discord's max age is 7 days (604800s); 0 means
    // never expire. maxUses 0 means unlimited. Anything else is rejected.
    const maxAge = Number.isFinite(body.maxAge)
      ? Math.max(0, Math.min(Number(body.maxAge), 604800))
      : 86400;
    const maxUses = Number.isFinite(body.maxUses)
      ? Math.max(0, Math.min(Number(body.maxUses), 100))
      : 0;
    const reason = typeof body.reason === "string" ? body.reason : undefined;
    try {
      const invite = await (
        channel as {
          createInvite: (
            opts: object,
          ) => Promise<{ code: string; url: string; expiresAt: Date | null }>;
        }
      ).createInvite({
        maxAge,
        maxUses,
        temporary: !!body.temporary,
        // `unique: false` reuses an existing equivalent invite when
        // one exists; `true` always mints a fresh code. Default to
        // true so the button is predictable.
        unique: body.unique !== false,
        reason,
      });
      return {
        code: invite.code,
        url: invite.url,
        expiresAt: invite.expiresAt ? invite.expiresAt.toISOString() : null,
      };
    } catch (err) {
      request.log.error({ err }, "failed to create invite");
      reply.code(502).send({ error: "Failed to create invite" });
    }
  });
}
