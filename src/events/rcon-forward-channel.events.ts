import type { ArgsOf, Client } from 'discordx';
import { Discord, On } from 'discordx';
import { RconForwardChannel } from '../models/rcon-forward-channel.model.js';
import { FAILED_COLOR } from '../utils/constant.js';
import { RconQueueService } from '../services/rcon-queue.service.js';
import { RconConnectionService } from '../services/rcon-connection.service.js';

const CLEANUP_INTERVAL = 5 * 60 * 1000; // 5 minutes

@Discord()
export class RconForwardChannelEvents {
    private cleanupInterval: NodeJS.Timeout | null = null;

    constructor() {
        this.startCleanupInterval();
        this.setupProcessHandlers();
    }

    private setupProcessHandlers() {
        process.on('SIGINT', () => this.cleanup());
        process.on('SIGTERM', () => this.cleanup());
    }

    private startCleanupInterval() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
        }

        this.cleanupInterval = setInterval(async () => {
            const now = new Date();
            const connections = RconConnectionService.getAllConnections();
            
            // 清理過期的連接
            for (const [connectionName, connection] of Object.entries(connections)) {
                if (now.getTime() - connection.lastUsed.getTime() > RconConnectionService.connectionTimeout) {
                    console.log(`Cleaning up inactive connection: ${connectionName}`);
                    await RconConnectionService.cleanupConnection(connectionName);
                }
            }
        }, CLEANUP_INTERVAL);
    }

    private async cleanup() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }

        const connections = RconConnectionService.getAllConnections();
        for (const [connectionName, connection] of Object.entries(connections)) {
            await RconConnectionService.cleanupConnection(connectionName);
        }
    }

    @On()
    async messageCreate([message]: ArgsOf<'messageCreate'>, client: Client): Promise<void> {
        try {
            if (message.author.bot) return;

            const existingRecord = await RconForwardChannel.findOne({
                where: {
                    channelId: message.channelId,
                    guildId: message.guildId
                }
            });

            if (existingRecord) {
                const triggerPrefix: string = existingRecord.getDataValue('triggerPrefix');
                const commandPrefix: string = existingRecord.getDataValue('commandPrefix');
                if (message.content.startsWith(triggerPrefix)) {
                    const command = commandPrefix + message.content.substring(triggerPrefix.length);
                    await RconQueueService.send(
                        message, 
                        existingRecord.getDataValue('host'), 
                        existingRecord.getDataValue('port'), 
                        existingRecord.getDataValue('password'), 
                        command
                    );
                }
            }
        } catch (error) {
            console.error('Message handling error:', error);
            if (message.channel.isTextBased()) {
                await message.channel.send({
                    embeds: [{
                        color: FAILED_COLOR,
                        title: 'Error',
                        description: '處理指令時發生錯誤。'
                    }]
                }).catch(console.error);
            }
        }
    }
}