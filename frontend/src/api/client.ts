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

async function authedFetch(path: string, init: RequestInit = {}): Promise<Response> {
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
        throw new ApiError(response.status, response.status === 401 ? 'Invalid or expired token' : 'Exchange failed');
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
