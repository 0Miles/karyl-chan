import {
  MessageReaction,
  PartialMessageReaction,
  Role,
  type Client,
} from "discord.js";
import { findRoleReceiveMessage } from "./role-receive-message.model.js";
import { findRoleEmojiInGroup } from "./role-emoji.model.js";
import { resolveBuiltinFeatureEnabled } from "../../feature-toggle/models/bot-feature-state.model.js";
import { botEventLog } from "../../../web/bot-event-log.js";

/**
 * Hydrate a partial reaction (and its parent message) before we read
 * `guildId` / `emoji.name` / etc. off of it.
 *
 * After a bot restart, reactions on uncached messages arrive as
 * partials — discord.js fills in only what the gateway packet carried,
 * which omits `guildId` on the partial Message in practice. Earlier
 * versions of this handler bailed on `if (!guildId) return;`, which
 * looked exactly like "watch doesn't work after a restart." `fetch()`
 * round-trips to Discord and rebuilds a full Reaction + Message so the
 * downstream lookups have what they need.
 */
async function hydrateReaction(
  messageReaction: MessageReaction | PartialMessageReaction,
): Promise<MessageReaction | null> {
  if (messageReaction.partial) {
    try {
      await messageReaction.fetch();
    } catch (err) {
      console.error("role-emoji: failed to fetch partial reaction:", err);
      return null;
    }
  }
  if (messageReaction.message.partial) {
    try {
      await messageReaction.message.fetch();
    } catch (err) {
      console.error("role-emoji: failed to fetch partial message:", err);
      return null;
    }
  }
  return messageReaction as MessageReaction;
}

/**
 * Look up the role mapped to the emoji on a watched message. Returns
 * null when the message isn't being watched, the emoji isn't in the
 * bound group, or the mapped role has been deleted from the guild.
 */
async function getRoleForReaction(
  messageReaction: MessageReaction,
): Promise<Role | null> {
  const guildId = messageReaction.message.guildId;
  if (!guildId) return null;
  const channelId = messageReaction.message.channelId;
  const messageId = messageReaction.message.id;
  const watched = await findRoleReceiveMessage(guildId, channelId, messageId);
  if (!watched) return null;

  const groupId = watched.getDataValue("groupId") as number;
  const emojiId = messageReaction.emoji.id ?? "";
  const emojiChar = emojiId ? "" : (messageReaction.emoji.name ?? "");
  const roleEmoji = await findRoleEmojiInGroup(groupId, emojiChar, emojiId);
  if (!roleEmoji) return null;
  const roleId = roleEmoji.getDataValue("roleId") as string;
  return messageReaction.message.guild?.roles.cache.get(roleId) ?? null;
}

export function registerRoleEmojiEvents(client: Client): void {
  client.on("messageReactionAdd", async (messageReaction, user) => {
    try {
      if (user.id === client.user?.id) return;
      const hydrated = await hydrateReaction(messageReaction);
      if (!hydrated) return;
      if (
        !(await resolveBuiltinFeatureEnabled(
          "role-emoji",
          hydrated.message.guildId,
        ))
      ) {
        return;
      }
      const role = await getRoleForReaction(hydrated);
      if (!role) return;
      const member = await hydrated.message.guild?.members
        .fetch(user.id)
        .catch(() => null);
      if (!member) return;
      try {
        await member.roles.add(role);
        botEventLog.record(
          "info",
          "feature",
          `Role auto-granted via reaction: ${role.name}`,
          {
            guildId: hydrated.message.guildId,
            channelId: hydrated.message.channelId,
            messageId: hydrated.message.id,
            userId: user.id,
            roleId: role.id,
            emoji: hydrated.emoji.id ?? hydrated.emoji.name ?? "",
          },
        );
      } catch (roleErr) {
        botEventLog.record(
          "error",
          "feature",
          `Role grant/revoke failed: ${(roleErr as Error).message}`,
          {
            guildId: hydrated.message.guildId,
            userId: user.id,
            roleId: role.id,
            action: "add",
          },
        );
        throw roleErr;
      }
    } catch (ex) {
      console.error("role-emoji messageReactionAdd failed:", ex);
    }
  });

  client.on("messageReactionRemove", async (messageReaction, user) => {
    try {
      if (user.id === client.user?.id) return;
      const hydrated = await hydrateReaction(messageReaction);
      if (!hydrated) return;
      if (
        !(await resolveBuiltinFeatureEnabled(
          "role-emoji",
          hydrated.message.guildId,
        ))
      ) {
        return;
      }
      const role = await getRoleForReaction(hydrated);
      if (!role) return;
      const member = await hydrated.message.guild?.members
        .fetch(user.id)
        .catch(() => null);
      if (!member) return;
      try {
        await member.roles.remove(role);
        botEventLog.record(
          "info",
          "feature",
          `Role auto-revoked via reaction: ${role.name}`,
          {
            guildId: hydrated.message.guildId,
            channelId: hydrated.message.channelId,
            messageId: hydrated.message.id,
            userId: user.id,
            roleId: role.id,
            emoji: hydrated.emoji.id ?? hydrated.emoji.name ?? "",
          },
        );
      } catch (roleErr) {
        botEventLog.record(
          "error",
          "feature",
          `Role grant/revoke failed: ${(roleErr as Error).message}`,
          {
            guildId: hydrated.message.guildId,
            userId: user.id,
            roleId: role.id,
            action: "remove",
          },
        );
        throw roleErr;
      }
    } catch (ex) {
      console.error("role-emoji messageReactionRemove failed:", ex);
    }
  });
}
