import type { ArgsOf, Client } from "discordx";
import { Discord, On } from "discordx";
import { RconForwardChannel } from "../models/rcon-forward-channel.model.js";
import { FAILED_COLOR } from "../utils/constant.js";
import { RconQueueService } from "../services/rcon-queue.service.js";
import { RconConnectionService } from "../services/rcon-connection.service.js";
import { decryptSecret } from "../utils/crypto.js";
import { hasCapability } from "../permission/permission.service.js";
import { botEventLog } from "../web/bot-event-log.js";
import { shouldRecord } from "../web/bot-event-dedup.js";

const CLEANUP_INTERVAL = 5 * 60 * 1000; // 5 minutes

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

@Discord()
export class RconForwardChannelEvents {
  @On()
  async messageCreate(
    [message]: ArgsOf<"messageCreate">,
    client: Client,
  ): Promise<void> {
    try {
      if (message.author.bot) return;
      if (!message.guild || !message.member) return;

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

        if (
          !(await hasCapability(message.guild, message.member, "rcon.execute"))
        ) {
          console.log(
            `rcon.execute denied: user=${message.author.id} channel=${message.channelId}`,
          );
          if (shouldRecord(`rcon-deny:${message.author.id}`)) {
            botEventLog.record(
              "warn",
              "feature",
              `RCON forward denied (no capability): ${message.author.id}`,
              {
                guildId: message.guildId,
                channelId: message.channelId,
                userId: message.author.id,
              },
            );
          }
          return;
        }

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
  }
}
