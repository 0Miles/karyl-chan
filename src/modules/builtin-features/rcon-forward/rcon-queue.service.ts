import { Message, TextChannel } from "discord.js";
import {
  RconConnectionService,
  type RconConnection,
} from "./rcon-connection.service.js";
import { RateLimiter } from "../../../utils/rate-limiter.js";
import { FAILED_COLOR } from "../../../utils/constant.js";
import { botEventLog } from "../../bot-events/bot-event-log.js";
import { shouldRecord } from "../../bot-events/bot-event-dedup.js";
import { moduleLogger } from "../../../logger.js";

const log = moduleLogger("rcon-queue");

export class RconQueueService {
  private static rateLimiter = new RateLimiter();
  private static readonly QUEUE_COMMAND_EXPIRY = 5 * 60 * 1000;

  private static cleanExpiredCommands(connection: RconConnection) {
    const now = Date.now();
    const before = connection.queuedCommands.length;
    connection.queuedCommands = connection.queuedCommands.filter(
      (cmd) => now - cmd.timestamp < this.QUEUE_COMMAND_EXPIRY,
    );
    const removed = before - connection.queuedCommands.length;
    if (removed > 0) {
      log.debug(
        { removed, host: connection.host, port: connection.port },
        "Cleaned expired commands from queue",
      );
    }
  }

  static async send(
    message: Message,
    host: string,
    port: number,
    password: string,
    content: string,
  ) {
    try {
      if (this.rateLimiter.isRateLimited(message.channelId)) {
        await message.reply({
          embeds: [
            {
              color: FAILED_COLOR,
              title: "Rate Limited",
              description: `請稍後再試。每分鐘最多可發送 ${this.rateLimiter.maxCommandsPerWindow} 條指令。`,
            },
          ],
        });
        if (shouldRecord(`rcon-rate:${message.channelId}`)) {
          botEventLog.record(
            "warn",
            "feature",
            `RCON rate limit hit on channel ${message.channelId}`,
            {
              channelId: message.channelId,
              guildId: message.guildId,
            },
          );
        }
        return;
      }

      const connectionName = `${host}:${port}`;
      let connection = RconConnectionService.getConnection(connectionName);

      if (!connection) {
        const success = await RconConnectionService.initializeConnection(
          connectionName,
          host,
          port,
          password,
          message.channel as TextChannel,
        );
        if (!success) return;
        connection = RconConnectionService.getConnection(connectionName);
      } else {
        connection.lastUsed = new Date();
        if (!connection.channels.has(message.channel as TextChannel)) {
          connection.channels.add(message.channel as TextChannel);
        }
      }

      if (!connection) {
        throw new Error("連接初始化失敗");
      }

      this.cleanExpiredCommands(connection);

      if (connection.authenticated) {
        connection.conn.send(content);
      } else if (connection.queuedCommands.length < connection.maxQueueSize) {
        connection.queuedCommands.push({
          content,
          timestamp: Date.now(),
          channelId: message.channelId,
        });
      } else {
        await message.reply({
          embeds: [
            {
              color: FAILED_COLOR,
              title: "Queue Full",
              description: "指令佇列已滿，請稍後再試。",
            },
          ],
        });
        botEventLog.record("warn", "feature", "RCON queue full", {
          host: connection.host,
          port: connection.port,
          channelId: message.channelId,
        });
      }
    } catch (error) {
      log.error({ err: error }, "RCON send error");
      await message
        .reply({
          embeds: [
            {
              color: FAILED_COLOR,
              title: "Error",
              description: "發送指令時發生錯誤。",
            },
          ],
        })
        .catch((err: unknown) => log.error({ err }, "failed to send RCON error reply"));
    }
  }
}
