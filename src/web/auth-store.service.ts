import { createHash, randomBytes } from 'crypto';

const ONE_TIME_TTL_MS = 5 * 60 * 1000;
const ACCESS_TTL_MS = 15 * 60 * 1000;
const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// SSE tickets gate EventSource auth without leaking the long-lived
// access token in the URL. They live just long enough for the browser
// to open the connection after the API call returns.
const SSE_TICKET_TTL_MS = 60 * 1000;
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

interface SseTicketRecord {
    ownerId: string;
    expiresAt: number;
}

export interface IssuedTokens {
    accessToken: string;
    accessExpiresAt: number;
    refreshToken: string;
    refreshExpiresAt: number;
}

export interface RefreshStoreAdapter {
    load(): Promise<Array<{ hash: string } & RefreshRecord>>;
    put(record: { hash: string } & RefreshRecord): Promise<void>;
    delete(hash: string): Promise<void>;
    deleteByOwner(ownerId: string): Promise<void>;
    deleteExpired(now: number): Promise<void>;
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
    private sseTickets = new Map<string, SseTicketRecord>();
    private cleanupTimer: NodeJS.Timeout;
    private adapter: RefreshStoreAdapter | null;

    constructor(options: { refreshStore?: RefreshStoreAdapter } = {}) {
        this.adapter = options.refreshStore ?? null;
        this.cleanupTimer = setInterval(() => this.purgeExpired(), CLEANUP_INTERVAL_MS);
        this.cleanupTimer.unref();
    }

    attach(adapter: RefreshStoreAdapter): void {
        this.adapter = adapter;
    }

    async init(now: number = Date.now()): Promise<void> {
        if (!this.adapter) return;
        const records = await this.adapter.load();
        for (const record of records) {
            if (record.expiresAt > now) {
                this.refresh.set(record.hash, { ownerId: record.ownerId, expiresAt: record.expiresAt });
            } else {
                await this.adapter.delete(record.hash).catch(() => {});
            }
        }
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

    async issueTokens(ownerId: string, now: number = Date.now()): Promise<IssuedTokens> {
        const accessToken = newToken();
        const refreshToken = newToken();
        const accessExpiresAt = now + ACCESS_TTL_MS;
        const refreshExpiresAt = now + REFRESH_TTL_MS;
        this.access.set(hashToken(accessToken), { ownerId, expiresAt: accessExpiresAt });
        const refreshHash = hashToken(refreshToken);
        this.refresh.set(refreshHash, { ownerId, expiresAt: refreshExpiresAt });
        if (this.adapter) {
            await this.adapter.put({ hash: refreshHash, ownerId, expiresAt: refreshExpiresAt });
        }
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

    async rotateRefresh(token: string, now: number = Date.now()): Promise<IssuedTokens | null> {
        const key = hashToken(token);
        const record = this.refresh.get(key);
        if (!record) return null;
        this.refresh.delete(key);
        if (this.adapter) await this.adapter.delete(key).catch(() => {});
        if (record.expiresAt <= now) return null;
        return this.issueTokens(record.ownerId, now);
    }

    async revokeRefresh(token: string): Promise<boolean> {
        const key = hashToken(token);
        const removed = this.refresh.delete(key);
        if (this.adapter) await this.adapter.delete(key).catch(() => {});
        return removed;
    }

    // SSE tickets bridge the gap between Bearer-auth API calls and the
    // EventSource API (which can't send custom headers). Caller flow:
    // client hits POST /api/auth/sse-ticket with the access token, gets
    // a single-use ticket, then opens EventSource("…?ticket=<ticket>").
    // The ticket is invalidated on first read so URL leakage (history,
    // logs) only buys an attacker a stale value.
    issueSseTicket(ownerId: string, now: number = Date.now()): { ticket: string; expiresAt: number } {
        const ticket = newToken();
        const expiresAt = now + SSE_TICKET_TTL_MS;
        this.sseTickets.set(hashToken(ticket), { ownerId, expiresAt });
        return { ticket, expiresAt };
    }

    consumeSseTicket(ticket: string, now: number = Date.now()): string | null {
        const key = hashToken(ticket);
        const record = this.sseTickets.get(key);
        if (!record) return null;
        this.sseTickets.delete(key);
        if (record.expiresAt <= now) return null;
        return record.ownerId;
    }

    revokeAccess(token: string): boolean {
        // In-process access tokens give us the luxury real JWTs don't — a
        // logout can actually invalidate the presented access token, not
        // just the refresh. Caller flow: client sends access in the auth
        // header, refresh in the body; we revoke both.
        return this.access.delete(hashToken(token));
    }

    async revokeOwner(ownerId: string): Promise<void> {
        for (const [key, record] of this.access) {
            if (record.ownerId === ownerId) this.access.delete(key);
        }
        for (const [key, record] of this.refresh) {
            if (record.ownerId === ownerId) this.refresh.delete(key);
        }
        for (const [key, record] of this.sseTickets) {
            if (record.ownerId === ownerId) this.sseTickets.delete(key);
        }
        if (this.adapter) await this.adapter.deleteByOwner(ownerId).catch(() => {});
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
        for (const [key, record] of this.sseTickets) {
            if (record.expiresAt <= now) this.sseTickets.delete(key);
        }
        if (this.adapter) {
            void this.adapter.deleteExpired(now).catch(() => {});
        }
    }

    stop(): void {
        clearInterval(this.cleanupTimer);
    }
}

export const authStore = new AuthStore();
