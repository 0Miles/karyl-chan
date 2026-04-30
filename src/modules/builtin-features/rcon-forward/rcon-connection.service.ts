import { TextChannel } from "discord.js";
import Rcon from "rcon";
import { config } from "../../../config.js";
import {
  DEFAULT_COLOR,
  FAILED_COLOR,
  SUCCEEDED_COLOR,
} from "../../../utils/constant.js";
import {
  assertAllowedTarget,
  HostPolicyError,
} from "../../../utils/host-policy.js";
import { botEventLog } from "../../bot-events/bot-event-log.js";
import { moduleLogger } from "../../../logger.js";

const log = moduleLogger("rcon-connection");

export interface RconConnection {
  conn: Rcon;
  channels: Set<TextChannel>;
  authenticated: boolean;
  queuedCommands: QueuedCommand[];
  lastUsed: Date;
  reconnectAttempts: number;
  maxQueueSize: number;
  host: string;
  port: number;
}

interface RconConnectionManager {
  [key: string]: RconConnection;
}

export interface QueuedCommand {
  content: string;
  timestamp: number;
  channelId: string;
}

const MAX_RETRY_ATTEMPTS = config.rcon.maxRetryAttempts;
const MAX_QUEUE_SIZE = config.rcon.maxQueueSize;
const CONNECTION_TIMEOUT = config.rcon.connectionTimeoutMs;
const MAX_CONNECTIONS = config.rcon.maxConnections;

export class RconLimitError extends Error {
  constructor(host: string, limit: number) {
    super(
      `RCON connection limit reached (${limit}): cannot open new connection to ${host}. Remove unused rcon-forward channels to free slots.`,
    );
    this.name = "RconLimitError";
  }
}

export class RconConnectionService {
  private static connectionMap: RconConnectionManager = {};
  private static connectionLocks = new Map<string, Promise<void>>();

  static async initializeConnection(
    connectionName: string,
    host: string,
    port: number,
    password: string,
    channel: TextChannel,
  ): Promise<boolean> {
    let connectionLockPromise = this.connectionLocks.get(connectionName);
    if (connectionLockPromise) {
      try {
        await connectionLockPromise;
        return (
          this.connectionMap[connectionName] !== undefined &&
          this.connectionMap[connectionName].authenticated
        );
      } catch {
        this.connectionLocks.delete(connectionName);
      }
    }

    let lockResolver: {
      resolve: () => void;
      reject: (error: Error) => void;
    } = { resolve: () => {}, reject: () => {} };

    connectionLockPromise = new Promise<void>((resolve, reject) => {
      lockResolver.resolve = resolve;
      lockResolver.reject = reject;
    });
    this.connectionLocks.set(connectionName, connectionLockPromise);

    try {
      const isNew = !this.connectionMap[connectionName];
      if (isNew && Object.keys(this.connectionMap).length >= MAX_CONNECTIONS) {
        botEventLog.record(
          "warn",
          "feature",
          `RCON connection limit reached (${MAX_CONNECTIONS}): refused new connection to ${host}:${port}`,
          { host, port, limit: MAX_CONNECTIONS },
        );
        throw new RconLimitError(host, MAX_CONNECTIONS);
      }

      await assertAllowedTarget(host, port);

      if (this.connectionMap[connectionName]) {
        try {
          await this.connectionMap[connectionName].conn.disconnect();
        } catch (error) {
          log.error({ err: error, connectionName }, "清理舊連接時發生錯誤");
        }
        delete this.connectionMap[connectionName];
      }

      const rconInstance = new Rcon(host, port, password);

      this.connectionMap[connectionName] = {
        conn: rconInstance,
        channels: new Set([channel]),
        authenticated: false,
        queuedCommands: [],
        lastUsed: new Date(),
        reconnectAttempts: 0,
        maxQueueSize: MAX_QUEUE_SIZE,
        host: host,
        port: port,
      };

      this.setupEventListeners(connectionName, host, port, password);

      const connectionTimeout = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("連接超時")), 10000);
      });

      await Promise.race([rconInstance.connect(), connectionTimeout]);

      lockResolver.resolve();
      return true;
    } catch (error) {
      if (error instanceof RconLimitError) {
        throw error;
      }
      log.error({ err: error, connectionName }, "Connection init failed");
      botEventLog.record(
        "error",
        "feature",
        `RCON connection failed: ${host}:${port} — ${(error as Error).message}`,
        {
          host,
          port,
          errorType:
            error instanceof HostPolicyError
              ? "HostPolicyError"
              : error instanceof Error && error.message.includes("超時")
                ? "timeout"
                : "other",
        },
      );
      const userMessage =
        error instanceof HostPolicyError
          ? error.message
          : "無法建立連接，請確認 host/port 設定是否正確。";
      await channel
        .send({
          embeds: [
            {
              color: FAILED_COLOR,
              title: "Connection Error",
              description: userMessage,
            },
          ],
        })
        .catch((err: unknown) =>
          log.error({ err }, "failed to send connection error embed"),
        );

      if (this.connectionMap[connectionName]) {
        try {
          await this.connectionMap[connectionName].conn.disconnect();
        } catch {}
        delete this.connectionMap[connectionName];
      }

      lockResolver.reject(
        error instanceof Error ? error : new Error("未知錯誤"),
      );
      return false;
    } finally {
      this.connectionLocks.delete(connectionName);
    }
  }

  static getConnection(connectionName: string): RconConnection | undefined {
    return this.connectionMap[connectionName];
  }

  static getAllConnections(): RconConnectionManager {
    return this.connectionMap;
  }

  static async cleanupConnection(connectionName: string): Promise<void> {
    return this.handleConnectionEnd(connectionName);
  }

  private static setupEventListeners(
    connectionName: string,
    host: string,
    port: number,
    password: string,
  ) {
    const connection = this.connectionMap[connectionName];
    if (!connection) return;

    connection.conn.removeAllListeners();
    log.debug({ connectionName }, "Removed all existing listeners");

    connection.conn
      .on("auth", () => {
        log.info({ connectionName }, "Connection authenticated");
        connection.authenticated = true;
        connection.reconnectAttempts = 0;
        this.processQueuedCommands(connectionName);
        botEventLog.record(
          "info",
          "feature",
          `RCON connected: ${host}:${port}`,
          {
            host,
            port,
          },
        );
      })
      .on("response", (str: string) => {
        log.debug(
          { connectionName, bytes: str?.length ?? 0 },
          "Received response",
        );
        connection.lastUsed = new Date();
        for (const channel of connection.channels) {
          channel
            .send({
              embeds: [
                {
                  color: SUCCEEDED_COLOR,
                  title:
                    !str || typeof str !== "string" ? "Sent successful" : str,
                },
              ],
            })
            .catch((error: unknown) => {
              log.error(
                { err: error, channelId: channel.id },
                "Error sending response to channel",
              );
            });
        }
      })
      .on("server", (str: string) => {
        log.debug(
          { connectionName, bytes: str?.length ?? 0 },
          "Received server message",
        );
        for (const channel of connection.channels) {
          channel
            .send({
              embeds: [
                {
                  color: SUCCEEDED_COLOR,
                  title: "Server Message",
                  description: str || "（無內容）",
                },
              ],
            })
            .catch((error: unknown) => {
              log.error(
                { err: error, channelId: channel.id },
                "Error sending server message to channel",
              );
            });
        }
      })
      .on("error", (err: Error) => {
        log.error({ err, connectionName }, "RCON connection error");
        for (const channel of connection.channels) {
          channel
            .send({
              embeds: [
                {
                  color: FAILED_COLOR,
                  title: "RCON Error",
                  description: "連線發生錯誤，將嘗試重新連線。",
                },
              ],
            })
            .catch((e: unknown) =>
              log.error({ err: e }, "failed to send RCON error embed"),
            );
        }
        this.handleConnectionError(connectionName, host, port, password);
      })
      .on("end", () => {
        log.info({ connectionName }, "Connection ended");
        this.handleConnectionEnd(connectionName);
      });
  }

  private static async handleConnectionEnd(connectionName: string) {
    const connection = this.connectionMap[connectionName];
    if (!connection) return;

    try {
      log.info(
        { host: connection.host, port: connection.port, connectionName },
        "與遠端的連接已關閉，未發送的指令將被清除",
      );

      // 清理所有待處理的指令
      if (connection.queuedCommands.length > 0) {
        log.debug(
          { connectionName, count: connection.queuedCommands.length },
          "清理未發送的指令",
        );
        connection.queuedCommands = [];
      }

      // 移除所有事件監聽器
      connection.conn.removeAllListeners();

      try {
        await connection.conn.disconnect();
      } catch (error) {
        log.error({ err: error, connectionName }, "關閉連接時發生錯誤");
      }

      delete this.connectionMap[connectionName];
      this.connectionLocks.delete(connectionName);
    } catch (error) {
      log.error({ err: error, connectionName }, "清理連接時發生錯誤");
    }
  }

  private static async handleConnectionError(
    connectionName: string,
    host: string,
    port: number,
    password: string,
  ) {
    const connection = this.connectionMap[connectionName];
    if (!connection) return;

    log.error({ connectionName }, "連接錯誤");

    if (connection.reconnectAttempts < MAX_RETRY_ATTEMPTS) {
      connection.reconnectAttempts++;
      const delay = Math.min(
        1000 * Math.pow(2, connection.reconnectAttempts),
        30000,
      );

      for (const channel of connection.channels) {
        try {
          await channel.send({
            embeds: [
              {
                color: DEFAULT_COLOR,
                title: "Connection Lost",
                description: `正在嘗試重新連接 (${connection.reconnectAttempts}/${MAX_RETRY_ATTEMPTS})...`,
              },
            ],
          });
        } catch (error) {
          log.error(
            { err: error, channelId: channel.id },
            "無法發送重連通知到頻道",
          );
        }
      }

      try {
        await new Promise((resolve) => setTimeout(resolve, delay));
        this.setupEventListeners(connectionName, host, port, password);
        await connection.conn.connect();
      } catch (error) {
        log.error(
          { err: error, connectionName, attempt: connection.reconnectAttempts },
          "重新連接嘗試失敗",
        );

        if (connection.reconnectAttempts >= MAX_RETRY_ATTEMPTS) {
          // 如果達到最大重試次數，清理連接並通知用戶
          for (const channel of connection.channels) {
            try {
              await channel.send({
                embeds: [
                  {
                    color: FAILED_COLOR,
                    title: "Connection Failed",
                    description:
                      "重連次數已達上限，連接將被關閉。所有未發送的指令將被清除。",
                  },
                ],
              });
            } catch (error) {
              log.error(
                { err: error, channelId: channel.id },
                "無法發送連接失敗通知到頻道",
              );
            }
          }
          botEventLog.record(
            "error",
            "feature",
            `RCON reconnect exhausted: ${host}:${port}`,
            {
              host,
              port,
              attempts: connection.reconnectAttempts,
            },
          );
          await this.handleConnectionEnd(connectionName);
        }
      }
    } else {
      await this.handleConnectionEnd(connectionName);
    }
  }

  private static processQueuedCommands(connectionName: string) {
    const connection = this.connectionMap[connectionName];
    if (connection && connection.authenticated) {
      const now = Date.now();
      const validCommands = connection.queuedCommands.filter(
        (cmd) => now - cmd.timestamp < 5 * 60 * 1000, // 5 minutes timeout
      );

      connection.queuedCommands = validCommands;

      while (connection.queuedCommands.length > 0) {
        const command = connection.queuedCommands.shift();
        if (command) {
          connection.conn.send(command.content);
        }
      }
    }
  }

  static get connectionTimeout(): number {
    return CONNECTION_TIMEOUT;
  }
}
