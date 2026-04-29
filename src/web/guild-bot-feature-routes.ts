import type { FastifyInstance } from "fastify";
import { requireGuildCapability } from "./route-guards.js";
import { isSnowflake } from "./validators.js";
import { TodoChannel } from "../modules/builtin-features/todo-channel/todo-channel.model.js";
import { PictureOnlyChannel } from "../modules/builtin-features/picture-only/picture-only-channel.model.js";
import { RconForwardChannel } from "../modules/builtin-features/rcon-forward/rcon-forward-channel.model.js";
import { RoleEmoji, addRoleEmoji } from "../modules/builtin-features/role-emoji/role-emoji.model.js";
import { RoleEmojiGroup } from "../modules/builtin-features/role-emoji/role-emoji-group.model.js";
import { RoleReceiveMessage } from "../modules/builtin-features/role-emoji/role-receive-message.model.js";
import {
  type GuildManagementRoutesOptions,
  EMOJI_REGEX,
  validateGroupId,
} from "./guild-management-shared.js";

export async function registerGuildBotFeatureRoutes(
  server: FastifyInstance,
  options: GuildManagementRoutesOptions,
): Promise<void> {
  // ── Bot-feature CRUD ───────────────────────────────────────────────
  //
  // Mirrors the slash commands (todo-channel, picture-only, rcon, role-emoji,
  // role-receive, capability grants) so admins can manage these from the
  // web panel without dropping into Discord. The data lives in our local
  // SQL models — Discord.js is only used for cosmetic name lookups.

  // Todo channels ─────────────────────────────────────────────────────
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

  // Picture-only channels ─────────────────────────────────────────────
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

  // RCON forward channels ─────────────────────────────────────────────
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

  // Role-emoji groups ─────────────────────────────────────────────────
  //
  // Groups bucket emoji→role mappings; one guild can have many. A
  // watched message can pin one or more groups (see the junction
  // routes below) so the same physical emoji can grant different
  // roles depending on which message it's reacted to.
  server.post<{ Params: { guildId: string }; Body: { name?: unknown } }>(
    "/api/guilds/:guildId/feature/role-emoji-groups",
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
      const name =
        typeof request.body?.name === "string" ? request.body.name.trim() : "";
      if (!name) {
        reply.code(400).send({ error: "name required" });
        return;
      }
      try {
        const created = await RoleEmojiGroup.create({ guildId, name });
        reply.code(200).send({ id: created.getDataValue("id"), name });
      } catch (err) {
        request.log.error({ err }, "failed to add role-emoji group");
        reply.code(409).send({ error: "group with that name already exists" });
      }
    },
  );
  server.delete<{ Params: { guildId: string; groupId: string } }>(
    "/api/guilds/:guildId/feature/role-emoji-groups/:groupId",
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
      const groupId = parseInt(request.params.groupId, 10);
      if (!Number.isFinite(groupId)) {
        reply.code(400).send({ error: "invalid groupId" });
        return;
      }
      // RoleEmojiGroup is the source of truth for "does this
      // group belong to this guild" — the where clause rejects
      // ids from another guild before we cascade.
      const deleted = await RoleEmojiGroup.destroy({
        where: { guildId, id: groupId },
      });
      if (deleted === 0) {
        reply.code(404).send({ error: "group not found" });
        return;
      }
      reply.code(204).send();
    },
  );

  // Role-emoji mapping ────────────────────────────────────────────────
  //
  // The `emoji` body parses with the same regex the slash command uses,
  // so the call site can pass a raw emoji literal (`👍` or `<:foo:123>`)
  // instead of having to mirror the parsing logic. Either branch fills
  // both PK columns (emojiChar / emojiId) so the SQL row is unique.
  server.post<{
    Params: { guildId: string };
    Body: { groupId?: unknown; roleId?: unknown; emoji?: unknown };
  }>("/api/guilds/:guildId/feature/role-emoji", async (request, reply) => {
    if (
      !requireGuildCapability(request, reply, request.params.guildId, "manage")
    )
      return;
    const { guildId } = request.params;
    const b = request.body ?? {};
    const groupId =
      typeof b.groupId === "number" ? b.groupId : Number(b.groupId);
    if (!Number.isFinite(groupId)) {
      reply.code(400).send({ error: "groupId required" });
      return;
    }
    if (typeof b.roleId !== "string" || !isSnowflake(b.roleId)) {
      reply.code(400).send({ error: "roleId required" });
      return;
    }
    if (typeof b.emoji !== "string" || !b.emoji.trim()) {
      reply.code(400).send({ error: "emoji required" });
      return;
    }
    // Reject mappings against a group from another guild — the
    // (groupId, emojiId, emojiChar) PK doesn't carry guildId so
    // we have to check ownership ourselves.
    const owning = await RoleEmojiGroup.findOne({
      where: { guildId, id: groupId },
    });
    if (!owning) {
      reply.code(404).send({ error: "group not found" });
      return;
    }
    const m = EMOJI_REGEX.exec(b.emoji);
    if (!m) {
      reply.code(400).send({ error: "unparseable emoji" });
      return;
    }
    try {
      await addRoleEmoji(groupId, b.roleId, m[1] ?? "", m[2] ?? "", m[3] ?? "");
      reply.code(204).send();
    } catch (err) {
      request.log.error({ err }, "failed to add role-emoji");
      reply.code(409).send({ error: "mapping already exists in this group" });
    }
  });
  server.delete<{
    Params: { guildId: string };
    Querystring: { groupId?: string; emojiChar?: string; emojiId?: string };
  }>("/api/guilds/:guildId/feature/role-emoji", async (request, reply) => {
    if (
      !requireGuildCapability(request, reply, request.params.guildId, "manage")
    )
      return;
    const { guildId } = request.params;
    const groupId = parseInt(request.query.groupId ?? "", 10);
    const emojiChar =
      typeof request.query.emojiChar === "string"
        ? request.query.emojiChar
        : "";
    const emojiId =
      typeof request.query.emojiId === "string" ? request.query.emojiId : "";
    if (!Number.isFinite(groupId)) {
      reply.code(400).send({ error: "groupId required" });
      return;
    }
    if (!emojiChar && !emojiId) {
      reply.code(400).send({ error: "emojiChar or emojiId required" });
      return;
    }
    const owning = await RoleEmojiGroup.findOne({
      where: { guildId, id: groupId },
    });
    if (!owning) {
      reply.code(404).send({ error: "group not found" });
      return;
    }
    await RoleEmoji.destroy({ where: { groupId, emojiChar, emojiId } });
    reply.code(204).send();
  });

  // Role-receive messages ─────────────────────────────────────────────
  server.post<{
    Params: { guildId: string };
    Body: { channelId?: unknown; messageId?: unknown; groupId?: unknown };
  }>(
    "/api/guilds/:guildId/feature/role-receive-messages",
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
      const b = request.body ?? {};
      if (typeof b.channelId !== "string" || !isSnowflake(b.channelId)) {
        reply.code(400).send({ error: "channelId required" });
        return;
      }
      if (typeof b.messageId !== "string" || !isSnowflake(b.messageId)) {
        reply.code(400).send({ error: "messageId required" });
        return;
      }
      const groupId = await validateGroupId(b.groupId, guildId);
      if (groupId === null) {
        reply.code(400).send({ error: "invalid groupId" });
        return;
      }
      await RoleReceiveMessage.upsert({
        guildId,
        channelId: b.channelId,
        messageId: b.messageId,
        groupId,
      });
      reply.code(204).send();
    },
  );
  server.put<{
    Params: { guildId: string; channelId: string; messageId: string };
    Body: { groupId?: unknown };
  }>(
    "/api/guilds/:guildId/feature/role-receive-messages/:channelId/:messageId/group",
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
      const existing = await RoleReceiveMessage.findOne({
        where: { guildId, channelId, messageId },
      });
      if (!existing) {
        reply.code(404).send({ error: "watched message not found" });
        return;
      }
      const groupId = await validateGroupId(request.body?.groupId, guildId);
      if (groupId === null) {
        reply.code(400).send({ error: "invalid groupId" });
        return;
      }
      await RoleReceiveMessage.update(
        { groupId },
        { where: { guildId, channelId, messageId } },
      );
      reply.code(204).send();
    },
  );
  server.delete<{
    Params: { guildId: string; channelId: string; messageId: string };
  }>(
    "/api/guilds/:guildId/feature/role-receive-messages/:channelId/:messageId",
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
      await RoleReceiveMessage.destroy({
        where: { guildId, channelId, messageId },
      });
      reply.code(204).send();
    },
  );
}
