export interface HealthStatus {
    status: 'ok';
    uptime: number;
    timestamp: string;
}

export interface BotStatus {
    ready: boolean;
    userTag: string | null;
    userId: string | null;
    username: string | null;
    globalName: string | null;
    avatarUrl: string | null;
    guildCount: number;
    uptimeMs: number;
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

export interface AdminAuditEntry {
    id: number;
    actorUserId: string;
    action: string;
    target: string | null;
    context: Record<string, unknown> | null;
    createdAt: string;
    previousHash: string | null;
    hash: string;
}


export type BotEventLevel = 'info' | 'warn' | 'error';

export type BotEventCategory = 'bot' | 'auth' | 'feature' | 'web' | 'error';

export interface BotEvent {
    id: number;
    level: BotEventLevel;
    category: BotEventCategory;
    message: string;
    context: Record<string, unknown> | null;
    createdAt: string;
}

export interface AdminLoginEntry {
    userId: string;
    role: string;
    note: string | null;
    lastLoginAt: string | null;
    hasActiveSession: boolean;
    isOwner: boolean;
}
