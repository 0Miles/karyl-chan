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

export interface FeatureSummary {
    todoChannels: number;
    pictureOnlyChannels: number;
    rconForwardChannels: number;
    roleEmojiGroups: number;
    roleEmojis: number;
    authorizedUsers: number;
    adminRoles: number;
    capabilityGrants: number;
    distinctGuilds: number;
}
