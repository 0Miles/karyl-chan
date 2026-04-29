import type { FastifyInstance } from "fastify";
import { ChannelType } from "discord.js";
import { requireGuildCapability } from "../web-core/route-guards.js";
import { isSnowflake } from "../web-core/validators.js";
import {
  type GuildManagementRoutesOptions,
  fetchTextLike,
} from "./guild-management-shared.js";
import type { GuildChannelEventBus } from "./guild-channel-event-bus.js";

export async function registerGuildChannelMgmtRoutes(
  server: FastifyInstance,
  options: GuildManagementRoutesOptions,
  events: GuildChannelEventBus,
): Promise<void> {
  const { bot } = options;

  // ── Invite revocation ────────────────────────────────────────────────

  server.delete<{
    Params: { guildId: string; code: string };
    Body: { reason?: unknown };
  }>("/api/guilds/:guildId/invites/:code", async (request, reply) => {
    if (
      !requireGuildCapability(request, reply, request.params.guildId, "manage")
    )
      return;
    const { guildId, code } = request.params;
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
      await guild.invites.delete(code, reason);
      reply.code(204).send();
    } catch (err) {
      request.log.error({ err }, "failed to revoke invite");
      reply.code(502).send({ error: "Failed to revoke invite" });
    }
  });

  // ── Emoji CRUD ──────────────────────────────────────────────────────

  server.get<{ Params: { guildId: string } }>(
    "/api/guilds/:guildId/emojis",
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
        reply.code(404).send({ error: "Unknown guild" });
        return;
      }
      return {
        emojis: [...guild.emojis.cache.values()].map((e) => ({
          id: e.id,
          name: e.name,
          animated: !!e.animated,
          url: e.imageURL({ size: 64 }),
        })),
      };
    },
  );

  server.post<{ Params: { guildId: string } }>(
    "/api/guilds/:guildId/emojis",
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
        reply.code(404).send({ error: "Unknown guild" });
        return;
      }
      if (!request.isMultipart()) {
        reply.code(400).send({ error: "multipart upload required" });
        return;
      }
      let name = "";
      let attachment: Buffer | null = null;
      for await (const part of request.parts()) {
        if (part.type === "file") attachment = await part.toBuffer();
        else if (part.fieldname === "name")
          name = String(part.value ?? "").trim();
      }
      if (!name || name.length < 2 || name.length > 32) {
        reply.code(400).send({ error: "name must be 2..32 chars" });
        return;
      }
      if (!attachment) {
        reply.code(400).send({ error: "image attachment required" });
        return;
      }
      try {
        const emoji = await guild.emojis.create({ attachment, name });
        return { id: emoji.id };
      } catch (err) {
        request.log.error({ err }, "failed to create emoji");
        reply.code(502).send({ error: "Failed to create emoji" });
      }
    },
  );

  server.patch<{
    Params: { guildId: string; emojiId: string };
    Body: { name?: unknown; reason?: unknown };
  }>("/api/guilds/:guildId/emojis/:emojiId", async (request, reply) => {
    if (
      !requireGuildCapability(request, reply, request.params.guildId, "manage")
    )
      return;
    const { guildId, emojiId } = request.params;
    const guild = bot.guilds.cache.get(guildId);
    if (!guild) {
      reply.code(404).send({ error: "Unknown guild" });
      return;
    }
    const name =
      typeof request.body?.name === "string" ? request.body.name.trim() : "";
    if (!name || name.length < 2 || name.length > 32) {
      reply.code(400).send({ error: "name must be 2..32 chars" });
      return;
    }
    const reason =
      typeof request.body?.reason === "string"
        ? request.body.reason
        : undefined;
    try {
      await guild.emojis.edit(emojiId, reason ? { name, reason } : { name });
      reply.code(204).send();
    } catch (err) {
      request.log.error({ err }, "failed to edit emoji");
      reply.code(502).send({ error: "Failed to edit emoji" });
    }
  });

  server.delete<{
    Params: { guildId: string; emojiId: string };
    Body: { reason?: unknown };
  }>("/api/guilds/:guildId/emojis/:emojiId", async (request, reply) => {
    if (
      !requireGuildCapability(request, reply, request.params.guildId, "manage")
    )
      return;
    const { guildId, emojiId } = request.params;
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
      await guild.emojis.delete(emojiId, reason);
      reply.code(204).send();
    } catch (err) {
      request.log.error({ err }, "failed to delete emoji");
      reply.code(502).send({ error: "Failed to delete emoji" });
    }
  });

  // ── Sticker CRUD ────────────────────────────────────────────────────

  server.get<{ Params: { guildId: string } }>(
    "/api/guilds/:guildId/stickers",
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
        reply.code(404).send({ error: "Unknown guild" });
        return;
      }
      try {
        const stickers =
          guild.stickers.cache.size > 0
            ? guild.stickers.cache
            : await guild.stickers.fetch();
        return {
          stickers: [...stickers.values()].map((s) => ({
            id: s.id,
            name: s.name,
            description: s.description,
            tags: s.tags,
            format: s.format,
            url: s.url,
          })),
        };
      } catch (err) {
        request.log.error({ err }, "failed to list stickers");
        reply.code(502).send({ error: "Failed to list stickers" });
      }
    },
  );

  server.post<{ Params: { guildId: string } }>(
    "/api/guilds/:guildId/stickers",
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
        reply.code(404).send({ error: "Unknown guild" });
        return;
      }
      if (!request.isMultipart()) {
        reply.code(400).send({ error: "multipart upload required" });
        return;
      }
      let name = "";
      let tags = "";
      let description = "";
      // Discord requires a filename hint even for in-memory buffers,
      // so we capture it alongside the body to feed into stickers.create.
      let file: { attachment: Buffer; name: string } | null = null;
      for await (const part of request.parts()) {
        if (part.type === "file") {
          file = { attachment: await part.toBuffer(), name: part.filename };
        } else if (part.fieldname === "name")
          name = String(part.value ?? "").trim();
        else if (part.fieldname === "tags")
          tags = String(part.value ?? "").trim();
        else if (part.fieldname === "description")
          description = String(part.value ?? "").trim();
      }
      if (!name || name.length < 2 || name.length > 30) {
        reply.code(400).send({ error: "name must be 2..30 chars" });
        return;
      }
      if (!tags || tags.length > 200) {
        reply.code(400).send({ error: "tags required (≤200 chars)" });
        return;
      }
      if (!description || description.length < 2 || description.length > 100) {
        reply.code(400).send({ error: "description must be 2..100 chars" });
        return;
      }
      if (!file) {
        reply.code(400).send({ error: "image attachment required" });
        return;
      }
      try {
        const sticker = await guild.stickers.create({
          file: file.attachment,
          name,
          tags,
          description,
        });
        return { id: sticker.id };
      } catch (err) {
        request.log.error({ err }, "failed to create sticker");
        reply.code(502).send({ error: "Failed to create sticker" });
      }
    },
  );

  server.patch<{
    Params: { guildId: string; stickerId: string };
    Body: {
      name?: unknown;
      tags?: unknown;
      description?: unknown;
      reason?: unknown;
    };
  }>("/api/guilds/:guildId/stickers/:stickerId", async (request, reply) => {
    if (
      !requireGuildCapability(request, reply, request.params.guildId, "manage")
    )
      return;
    const { guildId, stickerId } = request.params;
    const guild = bot.guilds.cache.get(guildId);
    if (!guild) {
      reply.code(404).send({ error: "Unknown guild" });
      return;
    }
    const body = request.body ?? {};
    const edit: { name?: string; tags?: string; description?: string } = {};
    if (typeof body.name === "string" && body.name.trim())
      edit.name = body.name.trim().slice(0, 30);
    if (typeof body.tags === "string")
      edit.tags = body.tags.trim().slice(0, 200);
    if (typeof body.description === "string")
      edit.description = body.description.trim().slice(0, 100);
    if (Object.keys(edit).length === 0) {
      reply.code(400).send({ error: "no editable fields supplied" });
      return;
    }
    const reason = typeof body.reason === "string" ? body.reason : undefined;
    try {
      await guild.stickers.edit(stickerId, reason ? { ...edit, reason } : edit);
      reply.code(204).send();
    } catch (err) {
      request.log.error({ err }, "failed to edit sticker");
      reply.code(502).send({ error: "Failed to edit sticker" });
    }
  });

  server.delete<{
    Params: { guildId: string; stickerId: string };
    Body: { reason?: unknown };
  }>("/api/guilds/:guildId/stickers/:stickerId", async (request, reply) => {
    if (
      !requireGuildCapability(request, reply, request.params.guildId, "manage")
    )
      return;
    const { guildId, stickerId } = request.params;
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
      await guild.stickers.delete(stickerId, reason);
      reply.code(204).send();
    } catch (err) {
      request.log.error({ err }, "failed to delete sticker");
      reply.code(502).send({ error: "Failed to delete sticker" });
    }
  });

  // ── Channel CRUD ─────────────────────────────────────────────────────

  server.post<{
    Params: { guildId: string };
    Body: {
      name?: unknown;
      type?: unknown;
      parentId?: unknown;
      topic?: unknown;
      rateLimitPerUser?: unknown;
      nsfw?: unknown;
      reason?: unknown;
    };
  }>("/api/guilds/:guildId/channels", async (request, reply) => {
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
    const body = request.body ?? {};
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name || name.length > 100) {
      reply.code(400).send({ error: "name required (1..100 chars)" });
      return;
    }
    // Only the channel kinds the UI can create are accepted; the
    // rest (DM, news-thread, group-DM, …) require flows we don't
    // expose. Numbers map to discord.js's ChannelType enum.
    const ALLOWED: Record<string, number> = {
      text: ChannelType.GuildText,
      voice: ChannelType.GuildVoice,
      category: ChannelType.GuildCategory,
      announcement: ChannelType.GuildAnnouncement,
      forum: ChannelType.GuildForum,
    };
    const typeKey = typeof body.type === "string" ? body.type : "text";
    const channelType = ALLOWED[typeKey];
    if (channelType === undefined) {
      reply
        .code(400)
        .send({
          error: `type must be one of: ${Object.keys(ALLOWED).join(", ")}`,
        });
      return;
    }
    const parentId =
      typeof body.parentId === "string" && isSnowflake(body.parentId)
        ? body.parentId
        : undefined;
    const topic =
      typeof body.topic === "string" ? body.topic.slice(0, 1024) : undefined;
    const rateLimitPerUser =
      typeof body.rateLimitPerUser === "number" &&
      Number.isFinite(body.rateLimitPerUser)
        ? Math.max(0, Math.min(21600, Math.floor(body.rateLimitPerUser)))
        : undefined;
    const nsfw = typeof body.nsfw === "boolean" ? body.nsfw : undefined;
    const reason = typeof body.reason === "string" ? body.reason : undefined;
    try {
      const created = await guild.channels.create({
        name,
        type: channelType as Parameters<
          typeof guild.channels.create
        >[0]["type"],
        parent: parentId,
        topic,
        rateLimitPerUser,
        nsfw,
        reason,
      });
      return { id: created.id };
    } catch (err) {
      request.log.error({ err }, "failed to create channel");
      reply.code(502).send({ error: "Failed to create channel" });
    }
  });

  server.delete<{
    Params: { guildId: string; channelId: string };
    Body: { reason?: unknown };
  }>("/api/guilds/:guildId/channels/:channelId", async (request, reply) => {
    if (
      !requireGuildCapability(request, reply, request.params.guildId, "manage")
    )
      return;
    const { guildId, channelId } = request.params;
    const guild = bot.guilds.cache.get(guildId);
    if (!guild) {
      reply.code(404).send({ error: "Unknown guild" });
      return;
    }
    const channel = guild.channels.cache.get(channelId);
    if (!channel) {
      reply.code(404).send({ error: "Unknown channel" });
      return;
    }
    const reason =
      typeof request.body?.reason === "string"
        ? request.body.reason
        : undefined;
    try {
      await channel.delete(reason);
      reply.code(204).send();
    } catch (err) {
      request.log.error({ err }, "failed to delete channel");
      reply.code(502).send({ error: "Failed to delete channel" });
    }
  });

  server.patch<{
    Params: { guildId: string; channelId: string };
    Body: {
      name?: unknown;
      topic?: unknown;
      parentId?: unknown;
      rateLimitPerUser?: unknown;
      nsfw?: unknown;
      archived?: unknown;
      locked?: unknown;
      autoArchiveDuration?: unknown;
      reason?: unknown;
    };
  }>("/api/guilds/:guildId/channels/:channelId", async (request, reply) => {
    if (
      !requireGuildCapability(request, reply, request.params.guildId, "manage")
    )
      return;
    const { guildId, channelId } = request.params;
    const guild = bot.guilds.cache.get(guildId);
    if (!guild) {
      reply.code(404).send({ error: "Unknown guild" });
      return;
    }
    const channel = guild.channels.cache.get(channelId);
    if (!channel) {
      reply.code(404).send({ error: "Unknown channel" });
      return;
    }
    const body = request.body ?? {};
    // Build the edit payload only with fields the caller actually
    // sent — discord.js ignores undefined keys but explicitly
    // setting null/empty would unset values we didn't mean to.
    const edit: Record<string, unknown> = {};
    if (typeof body.name === "string" && body.name.trim())
      edit.name = body.name.slice(0, 100);
    if (typeof body.topic === "string") edit.topic = body.topic.slice(0, 1024);
    if (typeof body.parentId === "string" && isSnowflake(body.parentId))
      edit.parent = body.parentId;
    else if (body.parentId === null) edit.parent = null;
    if (
      typeof body.rateLimitPerUser === "number" &&
      Number.isFinite(body.rateLimitPerUser)
    ) {
      edit.rateLimitPerUser = Math.max(
        0,
        Math.min(21600, Math.floor(body.rateLimitPerUser)),
      );
    }
    if (typeof body.nsfw === "boolean") edit.nsfw = body.nsfw;
    // Thread-only flags. Forwarded blindly — discord.js rejects
    // them with InvalidChannelType when applied to a regular text
    // channel, which surfaces as the 502 below.
    if (typeof body.archived === "boolean") edit.archived = body.archived;
    if (typeof body.locked === "boolean") edit.locked = body.locked;
    if (typeof body.autoArchiveDuration === "number") {
      const v = Math.floor(body.autoArchiveDuration);
      if ([60, 1440, 4320, 10080].includes(v)) edit.autoArchiveDuration = v;
    }
    const reason = typeof body.reason === "string" ? body.reason : undefined;
    if (Object.keys(edit).length === 0) {
      reply.code(400).send({ error: "no editable fields supplied" });
      return;
    }
    try {
      await (
        channel as unknown as {
          edit: (opts: unknown, reason?: string) => Promise<unknown>;
        }
      ).edit(edit, reason);
      reply.code(204).send();
    } catch (err) {
      request.log.error({ err }, "failed to edit channel");
      reply.code(502).send({ error: "Failed to edit channel" });
    }
  });

  // ── Private thread member management ───────────────────────────────

  server.get<{ Params: { guildId: string; threadId: string } }>(
    "/api/guilds/:guildId/threads/:threadId/members",
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
      const { guildId, threadId } = request.params;
      const guild = bot.guilds.cache.get(guildId);
      if (!guild) {
        reply.code(404).send({ error: "Unknown guild" });
        return;
      }
      const channel = guild.channels.cache.get(threadId);
      if (!channel || !channel.isThread()) {
        reply.code(404).send({ error: "Unknown thread" });
        return;
      }
      try {
        const members = await channel.members.fetch();
        return {
          members: [...members.values()].map((m) => ({
            userId: m.id,
            joinedAt: m.joinedAt?.toISOString() ?? null,
          })),
        };
      } catch (err) {
        request.log.error({ err }, "failed to list thread members");
        reply.code(502).send({ error: "Failed to list thread members" });
      }
    },
  );

  server.post<{
    Params: { guildId: string; threadId: string; userId: string };
  }>(
    "/api/guilds/:guildId/threads/:threadId/members/:userId",
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
      const { guildId, threadId, userId } = request.params;
      if (!isSnowflake(userId)) {
        reply.code(400).send({ error: "invalid userId" });
        return;
      }
      const guild = bot.guilds.cache.get(guildId);
      if (!guild) {
        reply.code(404).send({ error: "Unknown guild" });
        return;
      }
      const channel = guild.channels.cache.get(threadId);
      if (!channel || !channel.isThread()) {
        reply.code(404).send({ error: "Unknown thread" });
        return;
      }
      try {
        await channel.members.add(userId);
        reply.code(204).send();
      } catch (err) {
        request.log.error({ err }, "failed to add thread member");
        reply.code(502).send({ error: "Failed to add thread member" });
      }
    },
  );

  server.delete<{
    Params: { guildId: string; threadId: string; userId: string };
  }>(
    "/api/guilds/:guildId/threads/:threadId/members/:userId",
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
      const { guildId, threadId, userId } = request.params;
      if (!isSnowflake(userId)) {
        reply.code(400).send({ error: "invalid userId" });
        return;
      }
      const guild = bot.guilds.cache.get(guildId);
      if (!guild) {
        reply.code(404).send({ error: "Unknown guild" });
        return;
      }
      const channel = guild.channels.cache.get(threadId);
      if (!channel || !channel.isThread()) {
        reply.code(404).send({ error: "Unknown thread" });
        return;
      }
      try {
        await channel.members.remove(userId);
        reply.code(204).send();
      } catch (err) {
        request.log.error({ err }, "failed to remove thread member");
        reply.code(502).send({ error: "Failed to remove thread member" });
      }
    },
  );

  server.post<{
    Params: { guildId: string; channelId: string };
    Body: { messageIds?: unknown };
  }>(
    "/api/guilds/:guildId/text-channels/:channelId/messages/bulk-delete",
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
      const ids = Array.isArray(request.body?.messageIds)
        ? (request.body!.messageIds as unknown[]).filter(
            (id): id is string => typeof id === "string" && isSnowflake(id),
          )
        : [];
      // Discord requires 2..100 messages per bulkDelete and rejects
      // anything older than 14 days. We cap the count here; the
      // 14-day limit is enforced via discord.js's `filterOld` flag.
      if (ids.length < 2 || ids.length > 100) {
        reply.code(400).send({ error: "messageIds must be 2..100 snowflakes" });
        return;
      }
      const channel = fetchTextLike(bot, guildId, channelId);
      if (!channel) {
        reply.code(404).send({ error: "Unknown channel" });
        return;
      }
      try {
        // `filterOld = true` skips messages older than 14 days
        // instead of throwing on the whole batch.
        const deleted = await channel.bulkDelete(ids, true);
        for (const id of deleted.keys()) {
          events.publish({
            type: "guild-message-deleted",
            guildId,
            channelId,
            messageId: id,
          });
        }
        return { deletedCount: deleted.size };
      } catch (err) {
        request.log.error({ err }, "failed to bulk delete messages");
        reply.code(502).send({ error: "Failed to bulk delete" });
      }
    },
  );
}
