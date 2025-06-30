import { TextChannel } from 'discord.js';
import Rcon from 'rcon';
import { DEFAULT_COLOR, FAILED_COLOR, SUCCEEDED_COLOR } from '../utils/constant.js';

interface RconConnection {
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

interface QueuedCommand {
    content: string;
    timestamp: number;
    channelId: string;
}

const MAX_RETRY_ATTEMPTS = 3;
const MAX_QUEUE_SIZE = 100;
const CONNECTION_TIMEOUT = 30 * 60 * 1000; // 30 minutes

export class RconConnectionService {
    private static connectionMap: RconConnectionManager = {};
    private static connectionLocks = new Map<string, Promise<void>>();

    static async initializeConnection(connectionName: string, host: string, port: number, password: string, channel: TextChannel): Promise<boolean> {
        let connectionLockPromise = this.connectionLocks.get(connectionName);
        if (connectionLockPromise) {
            try {
                await connectionLockPromise;
                return this.connectionMap[connectionName] !== undefined && this.connectionMap[connectionName].authenticated;
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
            if (!this.isValidHostname(host)) {
                throw new Error('無效的主機名稱');
            }
            if (!this.isValidPort(port)) {
                throw new Error('無效的端口號碼');
            }

            if (this.connectionMap[connectionName]) {
                try {
                    await this.connectionMap[connectionName].conn.disconnect();
                } catch (error) {
                    console.error(`清理舊連接時發生錯誤: ${connectionName}`, error);
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
                port: port
            };

            this.setupEventListeners(connectionName, host, port, password);
            
            const connectionTimeout = new Promise<never>((_, reject) => {
                setTimeout(() => reject(new Error('連接超時')), 10000);
            });

            await Promise.race([
                rconInstance.connect(),
                connectionTimeout
            ]);

            lockResolver.resolve();
            return true;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : '未知錯誤';
            await channel.send({
                embeds: [{
                    color: FAILED_COLOR,
                    title: 'Connection Error',
                    description: `無法建立連接: ${errorMessage}`
                }]
            }).catch(console.error);

            if (this.connectionMap[connectionName]) {
                try {
                    await this.connectionMap[connectionName].conn.disconnect();
                } catch {}
                delete this.connectionMap[connectionName];
            }

            lockResolver.reject(error instanceof Error ? error : new Error(errorMessage));
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

    private static isValidHostname(host: string): boolean {
        return /^[a-zA-Z0-9]([a-zA-Z0-9\-\.]*[a-zA-Z0-9])?$/.test(host) || 
               /^(\d{1,3}\.){3}\d{1,3}$/.test(host);
    }

    private static isValidPort(port: number): boolean {
        return Number.isInteger(port) && port > 0 && port < 65536;
    }

    private static setupEventListeners(connectionName: string, host: string, port: number, password: string) {
        const connection = this.connectionMap[connectionName];
        if (!connection) return;

        connection.conn.removeAllListeners();
        console.log(`Removed all existing listeners for ${connectionName}`);

        connection.conn
            .on('auth', () => {
                console.log(`Connection authenticated: ${connectionName}`);
                connection.authenticated = true;
                connection.reconnectAttempts = 0;
                this.processQueuedCommands(connectionName);
            })
            .on('response', (str: string) => {
                console.log(`Received response from ${connectionName}: ${str}`);
                connection.lastUsed = new Date();
                for(const channel of connection.channels) {
                    channel.send({
                        embeds: [{
                            color: SUCCEEDED_COLOR,
                            title: !str || (typeof str !== 'string') ? 'Sent successful' : str
                        }]
                    }).catch(error => {
                        console.error(`Error sending response to channel ${channel.id}:`, error);
                    });
                }
            })
            .on('error', (err: Error) => {
                console.error(`RCON connection error for ${connectionName}:`, err.message);
                for(const channel of connection.channels) {
                    channel.send({
                        embeds: [{
                            color: FAILED_COLOR,
                            title: 'RCON Error',
                            description: `連接錯誤: ${err.message}`
                        }]
                    }).catch(console.error);
                }
                this.handleConnectionError(connectionName, host, port, password);
            })
            .on('end', () => {
                console.log(`Connection ended: ${connectionName}`);
                this.handleConnectionEnd(connectionName);
            });
    }

    private static async handleConnectionEnd(connectionName: string) {
        const connection = this.connectionMap[connectionName];
        if (!connection) return;

        try {
            console.log(`與 ${connection.host}:${connection.port} 的連接已關閉。未發送的指令將被清除。`)

            // 清理所有待處理的指令
            if (connection.queuedCommands.length > 0) {
                console.log(`清理 ${connection.queuedCommands.length} 個未發送的指令`);
                connection.queuedCommands = [];
            }

            // 移除所有事件監聽器
            connection.conn.removeAllListeners();
            
            try {
                await connection.conn.disconnect();
            } catch (error) {
                console.error(`關閉連接時發生錯誤: ${connectionName}`, error);
            }

            delete this.connectionMap[connectionName];
            this.connectionLocks.delete(connectionName);
        } catch (error) {
            console.error(`清理連接時發生錯誤: ${connectionName}`, error);
        }
    }

    private static async handleConnectionError(connectionName: string, host: string, port: number, password: string) {
        const connection = this.connectionMap[connectionName];
        if (!connection) return;

        console.error(`連接錯誤: ${connectionName}`);

        if (connection.reconnectAttempts < MAX_RETRY_ATTEMPTS) {
            connection.reconnectAttempts++;
            const delay = Math.min(1000 * Math.pow(2, connection.reconnectAttempts), 30000);

            for (const channel of connection.channels) {
                try {
                    await channel.send({
                        embeds: [{
                            color: DEFAULT_COLOR,
                            title: 'Connection Lost',
                            description: `正在嘗試重新連接 (${connection.reconnectAttempts}/${MAX_RETRY_ATTEMPTS})...`
                        }]
                    });
                } catch (error) {
                    console.error(`無法發送重連通知到頻道 ${channel.id}:`, error);
                }
            }

            try {
                await new Promise(resolve => setTimeout(resolve, delay));
                this.setupEventListeners(connectionName, host, port, password);
                await connection.conn.connect();
            } catch (error) {
                console.error(`重新連接嘗試 ${connection.reconnectAttempts} 失敗:`, error);
                
                if (connection.reconnectAttempts >= MAX_RETRY_ATTEMPTS) {
                    // 如果達到最大重試次數，清理連接並通知用戶
                    for (const channel of connection.channels) {
                        try {
                            await channel.send({
                                embeds: [{
                                    color: FAILED_COLOR,
                                    title: 'Connection Failed',
                                    description: '重連次數已達上限，連接將被關閉。所有未發送的指令將被清除。'
                                }]
                            });
                        } catch (error) {
                            console.error(`無法發送連接失敗通知到頻道 ${channel.id}:`, error);
                        }
                    }
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
            const validCommands = connection.queuedCommands.filter(cmd => 
                now - cmd.timestamp < 5 * 60 * 1000 // 5 minutes timeout
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
