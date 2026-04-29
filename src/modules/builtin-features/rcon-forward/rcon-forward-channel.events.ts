import type { Client } from "discord.js";
import { RconForwardChannel } from "./rcon-forward-channel.model.js";
import { config } from "../../../config.js";
import { resolveBuiltinFeatureEnabled } from "../../feature-toggle/models/bot-feature-state.model.js";
import { FAILED_COLOR } from "../../../utils/constant.js";
import { RconQueueService } from "./rcon-queue.service.js";
import { RconConnectionService } from "./rcon-connection.service.js";
import { decryptSecret } from "../../../utils/crypto.js";
import { botEventLog } from "../../bot-events/bot-event-log.js";
import { shouldRecord } from "../../bot-events/bot-event-dedup.js";

const CLEANUP_INTERVAL = config.rcon.cleanupIntervalMs;

const cleanupTimer = setInterval(async () => {
  const now = new Date();
  const connections = RconConnectionService.getAllConnections();
  for (const [connectionName, connection] of Object.entries(connections)) {
    if (
      now.getTime() - connection.lastUsed.getTime() >
      RconConnectionService.connectionTimeout
    ) {
      console.log(`Cleaning up inactive connection: ${connectionName}`);
      await RconConnectionService.cleanupConnection(connectionName);
    }
  }
}, CLEANUP_INTERVAL);
cleanupTimer.unref();

async function shutdownAllConnections() {
  clearInterval(cleanupTimer);
  const connections = RconConnectionService.getAllConnections();
  for (const connectionName of Object.keys(connections)) {
    await RconConnectionService.cleanupConnection(connectionName);
  }
}

process.once("SIGINT", shutdownAllConnections);
process.once("SIGTERM", shutdownAllConnections);

export function registerRconForwardChannelEvents(client: Client): void {
  client.on("messageCreate", async (message) => {
    try {
      if (message.author.bot) return;
      if (!message.guild || !message.member) return;
      if (!(await resolveBuiltinFeatureEnabled("rcon", message.guildId))) {
        return;
      }

      const existingRecord = await RconForwardChannel.findOne({
        where: {
          channelId: message.channelId,
          guildId: message.guildId,
        },
      });

      if (existingRecord) {
        const triggerPrefix: string =
          existingRecord.getDataValue("triggerPrefix");
        if (!message.content.startsWith(triggerPrefix)) return;

        // No additional capability gate here: any user who can send
        // a message in this channel can trigger an RCON forward by
        // typing the prefix. Discord's channel-level Send Messages
        // permission is the gate; the in-house capability_grants
        // layer that used to sit on top has been removed.

        const commandPrefix: string =
          existingRecord.getDataValue("commandPrefix");
        const command =
          commandPrefix + message.content.substring(triggerPrefix.length);
        await RconQueueService.send(
          message,
          existingRecord.getDataValue("host"),
          existingRecord.getDataValue("port"),
          decryptSecret(existingRecord.getDataValue("password")),
          command,
        );
      }
    } catch (error) {
      console.error("Message handling error:", error);
      if (message.channel.isTextBased()) {
        await message.channel
          .send({
            embeds: [
              {
                color: FAILED_COLOR,
                title: "Error",
                description: "處理指令時發生錯誤。",
              },
            ],
          })
          .catch(console.error);
      }
    }
  });
}
