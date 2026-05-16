import { TodoChannel } from "./todo-channel/todo-channel.model.js";
import { PictureOnlyChannel } from "./picture-only/picture-only-channel.model.js";
import { RconForwardChannel } from "./rcon-forward/rcon-forward-channel.model.js";
import { RoleEmoji } from "./role-emoji/role-emoji.model.js";
import { RoleEmojiGroup } from "./role-emoji/role-emoji-group.model.js";
import { RoleReceiveMessage } from "./role-emoji/role-receive-message.model.js";

/**
 * Cross-module accessors that read the per-guild rows from every
 * built-in feature in one place. The `guild-management` and `admin`
 * modules used to import each feature's model directly to assemble
 * their summary endpoints — that broke the module boundary (a model
 * rename in `role-emoji` would silently break unrelated route
 * files) and bloated those routes with raw Sequelize.
 *
 * Anything that needs to know "what does feature X look like for
 * guild Y" goes through here; the feature module owns the query
 * shape.
 */

export interface TodoChannelView {
  channelId: string;
}

export interface PictureOnlyChannelView {
  channelId: string;
}

export interface RconForwardChannelView {
  channelId: string;
  commandPrefix: string | null;
  triggerPrefix: string | null;
  host: string | null;
  port: number | null;
}

export interface RoleEmojiGroupView {
  id: number;
  name: string;
}

export interface RoleEmojiView {
  groupId: number;
  roleId: string;
  emojiName: string;
  emojiId: string;
  emojiChar: string;
}

export interface RoleReceiveMessageView {
  channelId: string;
  messageId: string;
  groupId: number;
}

export interface GuildBuiltinSnapshot {
  todoChannels: TodoChannelView[];
  pictureOnlyChannels: PictureOnlyChannelView[];
  rconForwardChannels: RconForwardChannelView[];
  roleEmojiGroups: RoleEmojiGroupView[];
  roleEmojis: RoleEmojiView[];
  roleReceiveMessages: RoleReceiveMessageView[];
}

/**
 * Snapshot of every built-in-feature row for one guild. The data
 * is what `GET /api/guilds/:guildId` returns under each per-feature
 * field. Emoji mappings are pulled by `groupId` (not `guildId`)
 * because a stale FK could otherwise leak rows from another guild.
 */
export async function getGuildBuiltinSnapshot(
  guildId: string,
): Promise<GuildBuiltinSnapshot> {
  const [
    todoChannels,
    pictureOnlyChannels,
    rconForwardChannels,
    roleEmojiGroups,
    roleReceiveMessages,
  ] = await Promise.all([
    TodoChannel.findAll({ where: { guildId } }),
    PictureOnlyChannel.findAll({ where: { guildId } }),
    RconForwardChannel.findAll({ where: { guildId } }),
    RoleEmojiGroup.findAll({
      where: { guildId },
      order: [["name", "ASC"]],
    }),
    RoleReceiveMessage.findAll({ where: { guildId } }),
  ]);
  const groupIds = roleEmojiGroups.map((g) => g.getDataValue("id") as number);
  const roleEmojis =
    groupIds.length === 0
      ? []
      : await RoleEmoji.findAll({
          where: { groupId: groupIds },
          order: [
            ["groupId", "ASC"],
            ["sortOrder", "ASC"],
            ["createdAt", "ASC"],
          ],
        });
  return {
    todoChannels: todoChannels.map((r) => ({
      channelId: r.getDataValue("channelId") as string,
    })),
    pictureOnlyChannels: pictureOnlyChannels.map((r) => ({
      channelId: r.getDataValue("channelId") as string,
    })),
    rconForwardChannels: rconForwardChannels.map((r) => ({
      channelId: r.getDataValue("channelId") as string,
      commandPrefix: r.getDataValue("commandPrefix") as string | null,
      triggerPrefix: r.getDataValue("triggerPrefix") as string | null,
      host: r.getDataValue("host") as string | null,
      port: r.getDataValue("port") as number | null,
    })),
    roleEmojiGroups: roleEmojiGroups.map((g) => ({
      id: g.getDataValue("id") as number,
      name: g.getDataValue("name") as string,
    })),
    roleEmojis: roleEmojis.map((r) => ({
      groupId: r.getDataValue("groupId") as number,
      roleId: r.getDataValue("roleId") as string,
      emojiName: r.getDataValue("emojiName") as string,
      emojiId: r.getDataValue("emojiId") as string,
      emojiChar: r.getDataValue("emojiChar") as string,
    })),
    roleReceiveMessages: roleReceiveMessages.map((r) => ({
      channelId: r.getDataValue("channelId") as string,
      messageId: r.getDataValue("messageId") as string,
      groupId: r.getDataValue("groupId") as number,
    })),
  };
}

export interface BuiltinFeatureStats {
  rowCounts: {
    todoChannels: number;
    pictureOnlyChannels: number;
    rconForwardChannels: number;
    roleEmojiGroups: number;
    roleEmojis: number;
  };
  /** Union of guild ids that have at least one feature configured. */
  configuredGuildIds: Set<string>;
}

/**
 * Aggregate counts + the union of guild ids that have any built-in
 * feature configured. Feeds the admin dashboard's stats card.
 */
export async function getBuiltinFeatureStats(): Promise<BuiltinFeatureStats> {
  const [
    todoCount,
    pictureCount,
    rconCount,
    groupCount,
    emojiCount,
    todoGuilds,
    pictureGuilds,
    rconGuilds,
    groupGuilds,
  ] = await Promise.all([
    TodoChannel.count(),
    PictureOnlyChannel.count(),
    RconForwardChannel.count(),
    RoleEmojiGroup.count(),
    RoleEmoji.count(),
    TodoChannel.findAll({ attributes: ["guildId"], group: ["guildId"] }),
    PictureOnlyChannel.findAll({ attributes: ["guildId"], group: ["guildId"] }),
    RconForwardChannel.findAll({
      attributes: ["guildId"],
      group: ["guildId"],
    }),
    RoleEmojiGroup.findAll({ attributes: ["guildId"], group: ["guildId"] }),
  ]);
  const configuredGuildIds = new Set<string>();
  for (const rows of [todoGuilds, pictureGuilds, rconGuilds, groupGuilds]) {
    for (const row of rows) {
      configuredGuildIds.add(row.get("guildId") as string);
    }
  }
  return {
    rowCounts: {
      todoChannels: todoCount,
      pictureOnlyChannels: pictureCount,
      rconForwardChannels: rconCount,
      roleEmojiGroups: groupCount,
      roleEmojis: emojiCount,
    },
    configuredGuildIds,
  };
}
