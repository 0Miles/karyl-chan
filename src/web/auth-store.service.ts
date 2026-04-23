import { createHash, randomBytes } from 'crypto';

const ONE_TIME_TTL_MS = 5 * 60 * 1000;
const ACCESS_TTL_MS = 15 * 60 * 1000;
const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 60 * 1000;

interface OneTimeRecord {
    ownerId: string;
    expiresAt: number;
}

interface AccessRecord {
    ownerId: string;
    expiresAt: number;
}

interface RefreshRecord {
    ownerId: string;
    expiresAt: number;
}

export interface IssuedTokens {
    accessToken: string;
    accessExpiresAt: number;
    refreshToken: string;
    refreshExpiresAt: number;
}

function hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
}

function newToken(): string {
    return randomBytes(32).toString('hex');
}

export class AuthStore {
    private oneTime = new Map<string, OneTimeRecord>();
    private access = new Map<string, AccessRecord>();
    private refresh = new Map<string, RefreshRecord>();
    private cleanupTimer: NodeJS.Timeout;

    constructor() {
        this.cleanupTimer = setInterval(() => this.purgeExpired(), CLEANUP_INTERVAL_MS);
        this.cleanupTimer.unref();
    }

    createOneTimeToken(ownerId: string, now: number = Date.now()): { token: string; expiresAt: number } {
        const token = newToken();
        const expiresAt = now + ONE_TIME_TTL_MS;
        this.oneTime.set(hashToken(token), { ownerId, expiresAt });
        return { token, expiresAt };
    }

    consumeOneTimeToken(token: string, now: number = Date.now()): string | null {
        const key = hashToken(token);
        const record = this.oneTime.get(key);
        if (!record) return null;
        this.oneTime.delete(key);
        if (record.expiresAt <= now) return null;
        return record.ownerId;
    }

    issueTokens(ownerId: string, now: number = Date.now()): IssuedTokens {
        const accessToken = newToken();
        const refreshToken = newToken();
        const accessExpiresAt = now + ACCESS_TTL_MS;
        const refreshExpiresAt = now + REFRESH_TTL_MS;
        this.access.set(hashToken(accessToken), { ownerId, expiresAt: accessExpiresAt });
        this.refresh.set(hashToken(refreshToken), { ownerId, expiresAt: refreshExpiresAt });
        return { accessToken, accessExpiresAt, refreshToken, refreshExpiresAt };
    }

    verifyAccessToken(token: string, now: number = Date.now()): string | null {
        const record = this.access.get(hashToken(token));
        if (!record) return null;
        if (record.expiresAt <= now) {
            this.access.delete(hashToken(token));
            return null;
        }
        return record.ownerId;
    }

    rotateRefresh(token: string, now: number = Date.now()): IssuedTokens | null {
        const key = hashToken(token);
        const record = this.refresh.get(key);
        if (!record) return null;
        this.refresh.delete(key);
        if (record.expiresAt <= now) return null;
        return this.issueTokens(record.ownerId, now);
    }

    revokeRefresh(token: string): boolean {
        return this.refresh.delete(hashToken(token));
    }

    revokeOwner(ownerId: string): void {
        for (const [key, record] of this.access) {
            if (record.ownerId === ownerId) this.access.delete(key);
        }
        for (const [key, record] of this.refresh) {
            if (record.ownerId === ownerId) this.refresh.delete(key);
        }
    }

    private purgeExpired(now: number = Date.now()): void {
        for (const [key, record] of this.oneTime) {
            if (record.expiresAt <= now) this.oneTime.delete(key);
        }
        for (const [key, record] of this.access) {
            if (record.expiresAt <= now) this.access.delete(key);
        }
        for (const [key, record] of this.refresh) {
            if (record.expiresAt <= now) this.refresh.delete(key);
        }
    }

    stop(): void {
        clearInterval(this.cleanupTimer);
    }
}

export const authStore = new AuthStore();
