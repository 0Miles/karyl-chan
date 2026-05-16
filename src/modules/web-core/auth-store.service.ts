import { createHash, randomBytes } from "crypto";
import { config } from "../../config.js";

const ACCESS_TTL_MS = config.jwt.accessTtlMs;
const REFRESH_TTL_MS = config.jwt.refreshTtlMs;
// SSE tickets gate EventSource auth without leaking the long-lived
// access token in the URL. They live just long enough for the browser
// to open the connection after the API call returns.
const SSE_TICKET_TTL_MS = config.jwt.sseTicketTtlMs;
const CLEANUP_INTERVAL_MS = config.jwt.cleanupIntervalMs;

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
  /** The owner id these tokens belong to. Included so callers (e.g.
   *  the refresh endpoint) can re-check capabilities without a
   *  separate token-lookup step. */
  ownerId: string;
}

export interface RefreshStoreAdapter {
  load(): Promise<Array<{ hash: string } & RefreshRecord>>;
  put(record: { hash: string } & RefreshRecord): Promise<void>;
  delete(hash: string): Promise<void>;
  deleteByOwner(ownerId: string): Promise<void>;
  deleteExpired(now: number): Promise<void>;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function newToken(): string {
  return randomBytes(32).toString("hex");
}

/**
 * How long the hash of a just-rotated refresh token sticks around in
 * the reuse-detection set. Anything observed inside this window that
 * matches a rotated hash is treated as evidence of token theft —
 * we'd just have rotated it on the legitimate client's next refresh
 * anyway, so an attempt to use the rotated value AFTER it was
 * rotated means somebody else holds a copy.
 *
 * 5 min is generous — refresh cadence is usually well under access
 * TTL (10–15 min) so the rotated hash falls out of the window
 * before the same client rotates again under normal use, and a
 * stolen token replayed within 5 min still trips the alarm.
 */
const REFRESH_REUSE_WINDOW_MS = 5 * 60 * 1000;

export class AuthStore {
  private access = new Map<string, AccessRecord>();
  private refresh = new Map<string, RefreshRecord>();
  private sseTickets = new Map<string, SseTicketRecord>();
  /**
   * Hashes of recently-rotated refresh tokens, keyed by the
   * pre-rotation hash. If a caller presents one of these we know
   * (a) it WAS valid recently and (b) it isn't valid now — i.e. an
   * attacker has a copy and is replaying. We force-revoke every
   * session belonging to that owner so the legitimate user is
   * pushed back to the login flow and the attacker's session dies
   * with them.
   */
  private rotatedRefresh = new Map<
    string,
    { ownerId: string; expiresAt: number }
  >();
  private cleanupTimer: NodeJS.Timeout;
  private adapter: RefreshStoreAdapter | null;

  constructor(options: { refreshStore?: RefreshStoreAdapter } = {}) {
    this.adapter = options.refreshStore ?? null;
    this.cleanupTimer = setInterval(
      () => this.purgeExpired(),
      CLEANUP_INTERVAL_MS,
    );
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
        this.refresh.set(record.hash, {
          ownerId: record.ownerId,
          expiresAt: record.expiresAt,
        });
      } else {
        await this.adapter.delete(record.hash).catch(() => {});
      }
    }
  }

  async issueTokens(
    ownerId: string,
    now: number = Date.now(),
  ): Promise<IssuedTokens> {
    const accessToken = newToken();
    const refreshToken = newToken();
    const accessExpiresAt = now + ACCESS_TTL_MS;
    const refreshExpiresAt = now + REFRESH_TTL_MS;
    this.access.set(hashToken(accessToken), {
      ownerId,
      expiresAt: accessExpiresAt,
    });
    const refreshHash = hashToken(refreshToken);
    this.refresh.set(refreshHash, { ownerId, expiresAt: refreshExpiresAt });
    if (this.adapter) {
      await this.adapter.put({
        hash: refreshHash,
        ownerId,
        expiresAt: refreshExpiresAt,
      });
    }
    return { accessToken, accessExpiresAt, refreshToken, refreshExpiresAt, ownerId };
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

  async rotateRefresh(
    token: string,
    now: number = Date.now(),
  ): Promise<IssuedTokens | null> {
    const key = hashToken(token);
    const record = this.refresh.get(key);
    if (!record) {
      // Token isn't in the live set. Check whether we rotated it
      // recently — if so, an attacker is replaying a stolen token
      // after the legitimate client already moved on. Burn every
      // session for that owner so the thief loses access and the
      // real user is forced through fresh login.
      const reused = this.rotatedRefresh.get(key);
      if (reused && reused.expiresAt > now) {
        this.rotatedRefresh.delete(key);
        await this.revokeOwner(reused.ownerId);
      }
      return null;
    }
    this.refresh.delete(key);
    if (this.adapter) await this.adapter.delete(key).catch(() => {});
    if (record.expiresAt <= now) return null;
    // Stash the just-rotated hash so a future replay of this same
    // token trips the reuse alarm above. Bounded by the
    // REFRESH_REUSE_WINDOW_MS TTL purged in purgeExpired.
    this.rotatedRefresh.set(key, {
      ownerId: record.ownerId,
      expiresAt: now + REFRESH_REUSE_WINDOW_MS,
    });
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
  issueSseTicket(
    ownerId: string,
    now: number = Date.now(),
  ): { ticket: string; expiresAt: number } {
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
    // Also drop the owner's rotated-refresh hashes so a subsequent
    // login doesn't immediately trip the reuse alarm on a token that
    // belonged to the same person.
    for (const [key, record] of this.rotatedRefresh) {
      if (record.ownerId === ownerId) this.rotatedRefresh.delete(key);
    }
    if (this.adapter) await this.adapter.deleteByOwner(ownerId).catch(() => {});
  }

  private purgeExpired(now: number = Date.now()): void {
    for (const [key, record] of this.access) {
      if (record.expiresAt <= now) this.access.delete(key);
    }
    for (const [key, record] of this.refresh) {
      if (record.expiresAt <= now) this.refresh.delete(key);
    }
    for (const [key, record] of this.sseTickets) {
      if (record.expiresAt <= now) this.sseTickets.delete(key);
    }
    for (const [key, record] of this.rotatedRefresh) {
      if (record.expiresAt <= now) this.rotatedRefresh.delete(key);
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
