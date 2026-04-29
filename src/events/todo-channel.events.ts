import {
  type Client,
  Message,
  MessageReaction,
  MessageType,
  PartialMessageReaction,
} from "discord.js";
import { findTodoChannel } from "../models/todo-channel.model.js";
import {
  addTodoMessage,
  removeTodoMessage,
  findChannelTodoMessages,
} from "../models/todo-message.model.js";
import { resolveBuiltinFeatureEnabled } from "../models/bot-feature-state.model.js";
import { botEventLog } from "../web/bot-event-log.js";

/**
 * Hydrate a partial reaction (and its parent message) before any code
 * reads `guildId`, `type`, `reference`, or `createdAt` off of it.
 *
 * After a bot restart, reactions on uncached messages arrive as
 * partials — `Partials.Message`/`Partials.Reaction` only opt us in to
 * receiving them, the gateway packet doesn't carry every field on the
 * partial Message. In particular `guildId` is often null, which made
 * the legacy handler short-circuit on `findTodoChannel(null, …)` and
 * silently drop every reaction; `addTodoMessage` would also try to
 * write `createdAt: null` and reinsert duplicates.
 */
async function hydrateReaction(
  reaction: MessageReaction | PartialMessageReaction,
): Promise<MessageReaction | null> {
  if (reaction.partial) {
    try {
      await reaction.fetch();
    } catch (err) {
      console.error("todo-channel: failed to fetch partial reaction:", err);
      return null;
    }
  }
  if (reaction.message.partial) {
    try {
      await reaction.message.fetch();
    } catch (err) {
      console.error("todo-channel: failed to fetch partial message:", err);
      return null;
    }
  }
  return reaction as MessageReaction;
}

async function loadTodoMessage(message: Message) {
  const todoMessageIds = await findChannelTodoMessages(
    message.guildId as string,
    message.channelId,
  );
  const results = await Promise.allSettled(
    todoMessageIds.map(async (x) => {
      try {
        return await message.channel.messages.fetch({
          message: x.getDataValue("messageId"),
        });
      } catch (error) {
        await removeTodoMessage(
          x.getDataValue("guildId"),
          x.getDataValue("channelId"),
          x.getDataValue("messageId"),
        );
        botEventLog.record("info", "feature", "Orphan todo message pruned", {
          guildId: x.getDataValue("guildId") as string,
          channelId: x.getDataValue("channelId") as string,
          messageId: x.getDataValue("messageId") as string,
        });
        throw error;
      }
    }),
  );
  const messages = results
    .filter(
      (r): r is PromiseFulfilledResult<Message> => r.status === "fulfilled",
    )
    .map((r) => r.value);
  return messages.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

export function registerTodoChannelEvents(client: Client): void {
  client.on("messageCreate", async (message) => {
    try {
      // Operator gate — toggle off skips all todo bookkeeping for the
      // guild. Configuration rows persist so re-enabling restores them.
      if (!(await resolveBuiltinFeatureEnabled("todo", message.guildId))) {
        return;
      }
      if (
        (await findTodoChannel(message.guildId as string, message.channelId)) &&
        !message.author.bot
      ) {
        if (message.mentions.members?.find((x) => x.id === client.user?.id)) {
          const todoMessages = await loadTodoMessage(message);
          for (let eachMessage of todoMessages) {
            try {
              if (
                eachMessage.reactions.cache.size > 0 ||
                (eachMessage.mentions.users?.size ?? 0) === 0
              ) {
                await removeTodoMessage(
                  eachMessage.guildId as string,
                  eachMessage.channelId,
                  eachMessage.id,
                );
              } else if (
                eachMessage.author.id === client.user?.id &&
                eachMessage.type === MessageType.Reply
              ) {
                await eachMessage.delete();
                await removeTodoMessage(
                  eachMessage.guildId as string,
                  eachMessage.channelId,
                  eachMessage.id,
                );
              } else if (eachMessage.hasThread) {
                const newMessage = await eachMessage.reply(eachMessage.content);
                await addTodoMessage(newMessage);
              } else {
                const newMessage = await message.channel.send({
                  content: eachMessage.content,
                  files: eachMessage.attachments.map(
                    (attachmentValue) => attachmentValue,
                  ),
                });
                await addTodoMessage(newMessage);
                await eachMessage.delete();
                await removeTodoMessage(
                  eachMessage.guildId as string,
                  eachMessage.channelId,
                  eachMessage.id,
                );
              }
            } catch (ex) {
              console.error(ex);
              botEventLog.record(
                "error",
                "feature",
                `Todo rotation failed: ${(ex as Error).message}`,
                {
                  guildId: eachMessage.guildId,
                  channelId: eachMessage.channelId,
                  messageId: eachMessage.id,
                },
              );
            }
          }
          await message.delete();
        } else {
          await addTodoMessage(message);
        }
      }
    } catch (ex) {
      console.error(ex);
    }
  });

  client.on("messageReactionAdd", async (messageReaction) => {
    try {
      const hydrated = await hydrateReaction(messageReaction);
      if (!hydrated) return;
      const guildId = hydrated.message.guildId;
      if (!guildId) return;
      if (!(await resolveBuiltinFeatureEnabled("todo", guildId))) return;
      if (
        (await findTodoChannel(guildId, hydrated.message.channelId)) &&
        (hydrated.count ?? 0) > 0
      ) {
        if (hydrated.message.type === MessageType.Reply) {
          const refMessage = await hydrated.message.channel.messages.fetch(
            hydrated.message.reference?.messageId ?? "",
          );
          if (refMessage) {
            await refMessage.react("👍");
          }
        }
        await removeTodoMessage(
          guildId,
          hydrated.message.channelId,
          hydrated.message.id,
        );
      }
    } catch (ex) {
      console.error(ex);
    }
  });

  client.on("messageReactionRemove", async (messageReaction) => {
    try {
      const hydrated = await hydrateReaction(messageReaction);
      if (!hydrated) return;
      const guildId = hydrated.message.guildId;
      if (!guildId) return;
      if (!(await resolveBuiltinFeatureEnabled("todo", guildId))) return;
      if (
        (await findTodoChannel(guildId, hydrated.message.channelId)) &&
        hydrated.count === 0
      ) {
        if (hydrated.message.type === MessageType.Reply) {
          const refMessage = await hydrated.message.channel.messages.fetch(
            hydrated.message.reference?.messageId ?? "",
          );
          if (refMessage) {
            await refMessage?.reactions?.resolve("👍")?.remove();
          }
        }
        // hydrate guarantees message is fully populated; the
        // discord.js typing of `MessageReaction.message` stays
        // wide because partials can recur after eviction.
        await addTodoMessage(hydrated.message as Message);
      }
    } catch (ex) {
      console.error(ex);
    }
  });
}
