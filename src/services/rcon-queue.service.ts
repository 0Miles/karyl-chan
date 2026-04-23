import { Message, TextChannel } from 'discord.js';
import { RconConnectionService, type RconConnection } from './rcon-connection.service.js';
import { RateLimiter } from '../utils/rate-limiter.js';
import { FAILED_COLOR } from '../utils/constant.js';

export class RconQueueService {
    private static rateLimiter = new RateLimiter();
    private static readonly QUEUE_COMMAND_EXPIRY = 5 * 60 * 1000;

    private static cleanExpiredCommands(connection: RconConnection) {
        const now = Date.now();
        const before = connection.queuedCommands.length;
        connection.queuedCommands = connection.queuedCommands.filter(
            cmd => now - cmd.timestamp < this.QUEUE_COMMAND_EXPIRY
        );
        const removed = before - connection.queuedCommands.length;
        if (removed > 0) {
            console.log(`Cleaned ${removed} expired commands from queue for ${connection.host}:${connection.port}`);
        }
    }

    static async send(message: Message, host: string, port: number, password: string, content: string) {
        try {
            if (this.rateLimiter.isRateLimited(message.channelId)) {
                await message.reply({
                    embeds: [{
                        color: FAILED_COLOR,
                        title: 'Rate Limited',
                        description: `請稍後再試。每分鐘最多可發送 ${this.rateLimiter.maxCommandsPerWindow} 條指令。`
                    }]
                });
                return;
            }

            const connectionName = `${host}:${port}`;
            let connection = RconConnectionService.getConnection(connectionName);

            if (!connection) {
                const success = await RconConnectionService.initializeConnection(connectionName, host, port, password, message.channel as TextChannel);
                if (!success) return;
                connection = RconConnectionService.getConnection(connectionName);
            } else {
                connection.lastUsed = new Date();
                if (!connection.channels.has(message.channel as TextChannel)) {
                    connection.channels.add(message.channel as TextChannel);
                }
            }

            if (!connection) {
                throw new Error('連接初始化失敗');
            }

            this.cleanExpiredCommands(connection);

            if (connection.authenticated) {
                connection.conn.send(content);
            } else if (connection.queuedCommands.length < connection.maxQueueSize) {
                connection.queuedCommands.push({
                    content,
                    timestamp: Date.now(),
                    channelId: message.channelId
                });
            } else {
                await message.reply({
                    embeds: [{
                        color: FAILED_COLOR,
                        title: 'Queue Full',
                        description: '指令佇列已滿，請稍後再試。'
                    }]
                });
            }
        } catch (error) {
            console.error('RCON send error:', error);
            await message.reply({
                embeds: [{
                    color: FAILED_COLOR,
                    title: 'Error',
                    description: '發送指令時發生錯誤。'
                }]
            }).catch(console.error);
        }
    }
}
