import {
    accessTokenExpired,
    clearTokens,
    getAccessToken,
    getRefreshToken,
    setTokens,
    type IssuedTokens
} from '../auth';
import type { BotStatus, HealthStatus } from './types';

export class ApiError extends Error {
    constructor(public readonly status: number, message: string) {
        super(message);
        this.name = 'ApiError';
    }
}

let refreshInFlight: Promise<boolean> | null = null;

async function attemptRefresh(): Promise<boolean> {
    if (refreshInFlight) return refreshInFlight;
    const refreshToken = getRefreshToken();
    if (!refreshToken) return false;
    refreshInFlight = (async () => {
        try {
            const response = await fetch('/api/auth/refresh', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ refreshToken })
            });
            if (!response.ok) {
                clearTokens();
                return false;
            }
            const tokens = (await response.json()) as IssuedTokens;
            setTokens(tokens);
            return true;
        } catch {
            return false;
        } finally {
            refreshInFlight = null;
        }
    })();
    return refreshInFlight;
}

export async function authedFetch(path: string, init: RequestInit = {}): Promise<Response> {
    if (accessTokenExpired() && getRefreshToken()) {
        await attemptRefresh();
    }

    const sendWithAccess = async () => {
        const access = getAccessToken();
        const headers: Record<string, string> = {
            Accept: 'application/json',
            ...((init.headers as Record<string, string>) ?? {})
        };
        if (access) headers.Authorization = `Bearer ${access}`;
        return fetch(path, { credentials: 'same-origin', ...init, headers });
    };

    let response = await sendWithAccess();
    if (response.status === 401 && getRefreshToken()) {
        const refreshed = await attemptRefresh();
        if (refreshed) response = await sendWithAccess();
    }
    if (response.status === 401) clearTokens();
    return response;
}

async function getJson<T>(path: string): Promise<T> {
    const response = await authedFetch(path);
    if (!response.ok) {
        throw new ApiError(response.status, `${response.status} ${response.statusText}`);
    }
    return response.json() as Promise<T>;
}

export async function exchangeOneTimeToken(token: string): Promise<IssuedTokens> {
    const response = await fetch('/api/auth/exchange', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token })
    });
    if (!response.ok) {
        // Surface the server's actual error string when present — masking
        // every non-401 as "Exchange failed" hid the cause (rate-limit /
        // missing config / body-parse failure) on production hits.
        let message = response.status === 401 ? 'Invalid or expired token' : `Exchange failed (HTTP ${response.status})`;
        try {
            const body = await response.json();
            if (body && typeof body.error === 'string' && body.error.length > 0) {
                message = body.error;
            }
        } catch {
            // Non-JSON body (e.g. proxy error page). Keep the generic
            // status-coded message so the user at least sees the code.
        }
        throw new ApiError(response.status, message);
    }
    return (await response.json()) as IssuedTokens;
}

export async function logout(): Promise<void> {
    const refreshToken = getRefreshToken();
    try {
        if (refreshToken) {
            await fetch('/api/auth/logout', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ refreshToken })
            });
        }
    } finally {
        clearTokens();
    }
}

export const api = {
    getHealth: () => getJson<HealthStatus>('/api/health'),
    getBotStatus: () => getJson<BotStatus>('/api/bot/status')
};

interface SseTicket {
    ticket: string;
    expiresAt: number;
}

async function fetchSseTicket(): Promise<string | null> {
    const response = await authedFetch('/api/auth/sse-ticket', { method: 'POST' });
    if (!response.ok) return null;
    const body = (await response.json()) as SseTicket;
    return body.ticket;
}

export interface TicketedSseHandlers {
    /** Called for every event the server pushes — tracker handles the ticket dance. */
    onEvent: (raw: MessageEvent) => void;
    /** Bound on every fresh EventSource so consumers can register custom event names. */
    bindEventListeners: (source: EventSource) => void;
    /** Optional. Called when an EventSource opens (after handshake). */
    onOpen?: () => void;
    /** Optional. Called when an EventSource errors (before reconnect). */
    onError?: (event: Event) => void;
}

/**
 * Opens a SSE stream guarded by a single-use ticket from POST
 * /api/auth/sse-ticket. Native EventSource auto-reconnect re-uses the
 * URL, but our tickets are consumed on first use — so this helper owns
 * the lifecycle: on error or close it grabs a fresh ticket and opens a
 * new EventSource. Returns a stop function that prevents further
 * reconnects and closes the live socket.
 */
export function openTicketedSse(path: string, handlers: TicketedSseHandlers): () => void {
    let stopped = false;
    let current: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let backoffMs = 1000;
    const MAX_BACKOFF_MS = 30_000;

    async function connect() {
        if (stopped) return;
        const ticket = await fetchSseTicket();
        if (stopped) return;
        if (!ticket) {
            // Auth failed — give up silently. The user has likely been
            // signed out; the next route guard / 401 will redirect them.
            return;
        }
        const url = `${path}?ticket=${encodeURIComponent(ticket)}`;
        const source = new EventSource(url);
        current = source;
        source.onopen = () => {
            backoffMs = 1000;
            handlers.onOpen?.();
        };
        source.onerror = (event) => {
            handlers.onError?.(event);
            if (stopped) return;
            // EventSource will try to reconnect on its own with the same
            // (now-consumed) ticket → guaranteed 401 loop. Close it and
            // retry with a fresh ticket on a backoff schedule.
            source.close();
            if (current === source) current = null;
            scheduleReconnect();
        };
        handlers.bindEventListeners(source);
    }

    function scheduleReconnect() {
        if (stopped || reconnectTimer) return;
        const delay = backoffMs;
        backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
        reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            void connect();
        }, delay);
    }

    void connect();

    return () => {
        stopped = true;
        if (reconnectTimer) {
            clearTimeout(reconnectTimer);
            reconnectTimer = null;
        }
        if (current) {
            current.close();
            current = null;
        }
    };
}
