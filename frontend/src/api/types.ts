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

export interface SystemEvent {
    id: number;
    type: 'bot-ready' | 'bot-disconnect' | 'guild-join' | 'guild-leave' | 'error' | 'server-start';
    message: string;
    timestamp: string;
}

export interface SystemStats {
    memory: {
        heapUsedMb: number;
        heapTotalMb: number;
        rssMb: number;
    };
    dbConnected: boolean;
    guildCount: number;
    dmChannelCount: number;
    dmActivity: { date: string; count: number }[];
}
