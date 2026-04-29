import {
  ChannelType,
  type Client,
  type DMChannel,
  type MessageReaction,
  type PartialMessageReaction,
  type PartialUser,
  type User,
} from "discord.js";
import { dmInboxService, type DmRecipient } from "../web/dm-inbox.service.js";
import { dmEventBus } from "../web/dm-event-bus.js";
import { avatarUrlFor, toApiMessage } from "../modules/web-core/message-mapper.js";
import { botEventLog } from "../web/bot-event-log.js";

async function publishReactionUpdate(
  reaction: MessageReaction | PartialMessageReaction,
  user: User | PartialUser,
  client: Client,
): Promise<void> {
  const channel = reaction.message.channel;
  if (channel.type !== ChannelType.DM) return;
  // Skip our own reactions: the admin web that drove this change already
  // applied an optimistic update. Discord's REST view briefly lags behind
  // the gateway, so a refetch here would push back the pre-change state
  // and overwrite the operator's UI before reconciling.
  if (client.user && user.id === client.user.id) return;
  const channelId = reaction.message.channelId;
  const messageId = reaction.message.id;
  const message = await (channel as DMChannel).messages
    .fetch({ message: messageId, force: true })
    .catch(() => null);
  if (!message) return;
  dmEventBus.publish({
    type: "message-updated",
    channelId,
    message: toApiMessage(message),
  });
}

function recipientFor(channel: DMChannel): DmRecipient | null {
  const user = channel.recipient;
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    globalName: user.globalName ?? null,
    avatarUrl: avatarUrlFor(user.id, user.avatar),
  };
}

/**
 * After the gateway connects, walk the persisted DM channels and pull
 * the freshest `lastMessageId` from Discord. Messages that arrived
 * while the bot was offline don't replay as events, so without this
 * sync the unread-count endpoint compares the client's `lastSeen`
 * against a stale DB value and reports zero unreads.
 */
async function readySync(client: Client): Promise<void> {
  try {
    const summaries = await dmInboxService.listChannels();
    const totalCount = summaries.length;
    let syncedCount = 0;
    let skippedCount = 0;
    for (const summary of summaries) {
      try {
        const channel = await client.channels
          .fetch(summary.id)
          .catch(() => null);
        if (!channel || channel.type !== ChannelType.DM) {
          skippedCount++;
          continue;
        }
        const latest = (channel as DMChannel).lastMessageId;
        if (latest && latest !== summary.lastMessageId) {
          await dmInboxService.updateLatestMessageId(summary.id, latest);
          syncedCount++;
        } else {
          skippedCount++;
        }
      } catch (err) {
        console.warn("dm-inbox ready sync skip:", summary.id, err);
        skippedCount++;
      }
    }
    if (syncedCount > 0) {
      botEventLog.record(
        "info",
        "bot",
        `DM inbox sync complete: ${syncedCount}/${totalCount} channels`,
        { totalCount, syncedCount, skippedCount },
      );
    }
  } catch (err) {
    console.error("dm-inbox ready sync failed:", err);
  }
}

export function registerDmInboxEvents(client: Client): void {
  // Note: this 'ready' listener is in addition to the bot.once('ready')
  // in main.ts. discord.js v14 emits the same event for both
  // listeners; we share the queue without coordination.
  client.once("ready", () => {
    void readySync(client);
  });

  client.on("messageCreate", async (message) => {
    try {
      if (message.channel.type !== ChannelType.DM) return;
      const channel = message.channel as DMChannel;
      const recipient = recipientFor(channel);
      if (!recipient) return;
      const apiMessage = toApiMessage(message);
      const summary = await dmInboxService.recordActivity(
        channel.id,
        recipient,
        apiMessage,
      );
      dmEventBus.publish({ type: "channel-touched", channel: summary });
      dmEventBus.publish({
        type: "message-created",
        channelId: channel.id,
        message: apiMessage,
      });
    } catch (err) {
      console.error("dm-inbox messageCreate failed:", err);
    }
  });

  client.on("messageUpdate", async (_oldMessage, newMessage) => {
    try {
      if (newMessage.channel.type !== ChannelType.DM) return;
      const fetched = newMessage.partial
        ? await newMessage.fetch().catch(() => null)
        : newMessage;
      if (!fetched) return;
      dmEventBus.publish({
        type: "message-updated",
        channelId: fetched.channelId,
        message: toApiMessage(fetched),
      });
    } catch (err) {
      console.error("dm-inbox messageUpdate failed:", err);
    }
  });

  client.on("messageDelete", async (message) => {
    try {
      if (message.channel.type !== ChannelType.DM) return;
      dmEventBus.publish({
        type: "message-deleted",
        channelId: message.channelId,
        messageId: message.id,
      });
    } catch (err) {
      console.error("dm-inbox messageDelete failed:", err);
    }
  });

  client.on("messageReactionAdd", async (reaction, user) => {
    try {
      await publishReactionUpdate(reaction, user, client);
    } catch (err) {
      console.error("dm-inbox messageReactionAdd failed:", err);
    }
  });

  client.on("messageReactionRemove", async (reaction, user) => {
    try {
      await publishReactionUpdate(reaction, user, client);
    } catch (err) {
      console.error("dm-inbox messageReactionRemove failed:", err);
    }
  });
}
