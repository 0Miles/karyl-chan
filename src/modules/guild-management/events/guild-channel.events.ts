import {
  ChannelType,
  type Client,
  type Message,
  type MessageReaction,
  type PartialMessage,
  type PartialMessageReaction,
  type PartialUser,
  type TextChannel,
  type User,
} from "discord.js";
import { guildChannelEventBus } from "../guild-channel-event-bus.js";
import { toApiMessage } from "../../web-core/message-mapper.js";
import { moduleLogger } from "../../../logger.js";

const log = moduleLogger("guild-channel-events");

async function publishReactionUpdate(
  reaction: MessageReaction | PartialMessageReaction,
  user: User | PartialUser,
  client: Client,
): Promise<void> {
  const channel = reaction.message.channel;
  if (channel.type !== ChannelType.GuildText) return;
  if (client.user && user.id === client.user.id) return;
  const guildId = (channel as TextChannel).guildId;
  const channelId = reaction.message.channelId;
  const messageId = reaction.message.id;
  // Wipe the cached message's reactions before the force-fetch, so
  // discord.js's `_patch` preserve-when-omitted logic preserves an
  // empty cache instead of stale ghost entries — same root cause as
  // the bulk-message route. (See guild-channel-routes' fetch path.)
  const cached = (channel as TextChannel).messages.cache.get(messageId);
  if (cached) cached.reactions.cache.clear();
  const message = await (channel as TextChannel).messages
    .fetch({ message: messageId, force: true })
    .catch(() => null);
  if (!message) return;
  guildChannelEventBus.publish({
    type: "guild-message-updated",
    guildId,
    channelId,
    message: toApiMessage(message),
  });
}

export function registerGuildChannelEvents(client: Client): void {
  client.on("messageCreate", async (message) => {
    try {
      if (message.channel.type !== ChannelType.GuildText) return;
      const guildId = message.guildId;
      if (!guildId) return;
      guildChannelEventBus.publish({
        type: "guild-message-created",
        guildId,
        channelId: message.channelId,
        message: toApiMessage(message),
      });
    } catch (err) {
      log.error({ err }, "guild-channel messageCreate failed");
    }
  });

  client.on("messageUpdate", async (_old, newMessage) => {
    try {
      if (newMessage.channel.type !== ChannelType.GuildText) return;
      const guildId = newMessage.guildId;
      if (!guildId) return;
      const fetched = newMessage.partial
        ? await (newMessage as unknown as PartialMessage)
            .fetch()
            .catch(() => null)
        : (newMessage as Message);
      if (!fetched) return;
      guildChannelEventBus.publish({
        type: "guild-message-updated",
        guildId,
        channelId: fetched.channelId,
        message: toApiMessage(fetched),
      });
    } catch (err) {
      log.error({ err }, "guild-channel messageUpdate failed");
    }
  });

  client.on("messageDelete", async (message) => {
    try {
      if (message.channel.type !== ChannelType.GuildText) return;
      const guildId = message.guildId;
      if (!guildId) return;
      guildChannelEventBus.publish({
        type: "guild-message-deleted",
        guildId,
        channelId: message.channelId,
        messageId: message.id,
      });
    } catch (err) {
      log.error({ err }, "guild-channel messageDelete failed");
    }
  });

  client.on("messageReactionAdd", async (reaction, user) => {
    try {
      await publishReactionUpdate(reaction, user, client);
    } catch (err) {
      log.error({ err }, "guild-channel messageReactionAdd failed");
    }
  });

  client.on("messageReactionRemove", async (reaction, user) => {
    try {
      await publishReactionUpdate(reaction, user, client);
    } catch (err) {
      log.error({ err }, "guild-channel messageReactionRemove failed");
    }
  });
}
