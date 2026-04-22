export interface HealthStatus {
    status: 'ok';
    uptime: number;
    timestamp: string;
}

export interface BotStatus {
    ready: boolean;
    userTag: string | null;
    userId: string | null;
    guildCount: number;
    uptimeMs: number;
}
