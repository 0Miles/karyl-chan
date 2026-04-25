import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ApiError, authedFetch, exchangeOneTimeToken, logout } from './client';
import { clearTokens, setTokens } from '../auth';

const FUTURE = Date.now() + 60 * 60 * 1000;
const PAST = Date.now() - 60 * 1000;

function mockFetch(impl: (url: string, init?: RequestInit) => Promise<Response> | Response) {
    const spy = vi.fn((url: string, init?: RequestInit) => Promise.resolve(impl(url, init)));
    vi.stubGlobal('fetch', spy);
    return spy;
}

function jsonResponse(body: unknown, init: ResponseInit = { status: 200 }): Response {
    return new Response(JSON.stringify(body), {
        ...init,
        headers: { 'Content-Type': 'application/json', ...(init.headers as Record<string, string> ?? {}) }
    });
}

beforeEach(() => {
    localStorage.clear();
    clearTokens();
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('authedFetch', () => {
    it('attaches Bearer token + Accept JSON to outgoing requests', async () => {
        setTokens({
            accessToken: 'live-access',
            accessExpiresAt: FUTURE,
            refreshToken: 'live-refresh',
            refreshExpiresAt: FUTURE
        });
        const fetchSpy = mockFetch(() => jsonResponse({ ok: true }));
        await authedFetch('/api/admin/me');
        expect(fetchSpy).toHaveBeenCalledOnce();
        const init = fetchSpy.mock.calls[0][1] as RequestInit;
        const headers = init.headers as Record<string, string>;
        expect(headers.Authorization).toBe('Bearer live-access');
        expect(headers.Accept).toBe('application/json');
    });

    it('refreshes proactively when the access token has already expired', async () => {
        setTokens({
            accessToken: 'stale-access',
            accessExpiresAt: PAST,
            refreshToken: 'live-refresh',
            refreshExpiresAt: FUTURE
        });
        const calls: string[] = [];
        mockFetch((url) => {
            calls.push(url);
            if (url === '/api/auth/refresh') {
                return jsonResponse({
                    accessToken: 'fresh-access',
                    accessExpiresAt: FUTURE,
                    refreshToken: 'fresh-refresh',
                    refreshExpiresAt: FUTURE
                });
            }
            return jsonResponse({ ok: true });
        });
        await authedFetch('/api/admin/me');
        // First call must be the proactive refresh, not the user request.
        expect(calls[0]).toBe('/api/auth/refresh');
        expect(calls[1]).toBe('/api/admin/me');
    });

    it('refreshes once on a 401 and retries the original request with the new token', async () => {
        setTokens({
            accessToken: 'live-access',
            accessExpiresAt: FUTURE,
            refreshToken: 'live-refresh',
            refreshExpiresAt: FUTURE
        });
        let attempt = 0;
        const fetchSpy = mockFetch((url) => {
            if (url === '/api/auth/refresh') {
                return jsonResponse({
                    accessToken: 'fresh-access',
                    accessExpiresAt: FUTURE,
                    refreshToken: 'fresh-refresh',
                    refreshExpiresAt: FUTURE
                });
            }
            attempt += 1;
            if (attempt === 1) return jsonResponse({ error: 'expired' }, { status: 401 });
            return jsonResponse({ ok: true });
        });
        const r = await authedFetch('/api/admin/me');
        expect(r.status).toBe(200);
        // First user-call (401), refresh, then retry — three fetches total.
        expect(fetchSpy).toHaveBeenCalledTimes(3);
        // The retry must use the new token.
        const lastInit = fetchSpy.mock.calls[2][1] as RequestInit;
        expect((lastInit.headers as Record<string, string>).Authorization).toBe('Bearer fresh-access');
    });

    it('clears tokens when the retried request still 401s (refresh token also bad)', async () => {
        setTokens({
            accessToken: 'live-access',
            accessExpiresAt: FUTURE,
            refreshToken: 'live-refresh',
            refreshExpiresAt: FUTURE
        });
        mockFetch((url) => {
            if (url === '/api/auth/refresh') {
                return jsonResponse({ error: 'invalid' }, { status: 401 });
            }
            return jsonResponse({ error: 'unauthorized' }, { status: 401 });
        });
        await authedFetch('/api/admin/me');
        expect(localStorage.getItem('karyl-access-token')).toBeNull();
        expect(localStorage.getItem('karyl-refresh-token')).toBeNull();
    });

    it('does not attempt refresh when no refresh token exists', async () => {
        // No setTokens — simulates a fully-cold session.
        const fetchSpy = mockFetch(() => jsonResponse({ error: 'unauthorized' }, { status: 401 }));
        await authedFetch('/api/admin/me');
        // Single user call; no refresh round-trip.
        expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('coalesces concurrent refresh attempts into one round-trip', async () => {
        setTokens({
            accessToken: 'stale',
            accessExpiresAt: PAST,
            refreshToken: 'live-refresh',
            refreshExpiresAt: FUTURE
        });
        let refreshes = 0;
        const fetchSpy = mockFetch(async (url) => {
            if (url === '/api/auth/refresh') {
                refreshes += 1;
                // Hold the refresh open for a microtask so the second
                // caller can race in while we're in-flight.
                await new Promise(resolve => setTimeout(resolve, 0));
                return jsonResponse({
                    accessToken: 'fresh',
                    accessExpiresAt: FUTURE,
                    refreshToken: 'rt',
                    refreshExpiresAt: FUTURE
                });
            }
            return jsonResponse({ ok: true });
        });
        await Promise.all([
            authedFetch('/api/admin/me'),
            authedFetch('/api/admin/me')
        ]);
        expect(refreshes).toBe(1);
        // Two refresh + four user calls would mean two refreshes; we
        // expect 1 refresh + 2 user requests = 3 calls.
        expect(fetchSpy).toHaveBeenCalledTimes(3);
    });
});

describe('exchangeOneTimeToken', () => {
    it('returns the issued tokens on success', async () => {
        const issued = {
            accessToken: 'a', accessExpiresAt: FUTURE,
            refreshToken: 'r', refreshExpiresAt: FUTURE
        };
        mockFetch(() => jsonResponse(issued));
        const tokens = await exchangeOneTimeToken('one-time');
        expect(tokens).toEqual(issued);
    });

    it('surfaces the server-supplied error message on non-OK responses', async () => {
        mockFetch(() => jsonResponse({ error: 'Too many attempts, slow down' }, { status: 429 }));
        await expect(exchangeOneTimeToken('one-time')).rejects.toMatchObject({
            status: 429,
            message: 'Too many attempts, slow down'
        });
    });

    it('falls back to the canned 401 message when server error is missing', async () => {
        // Empty body / no JSON → the helper still produces a sensible
        // error rather than letting a parse error bubble up.
        mockFetch(() => new Response('', { status: 401 }));
        await expect(exchangeOneTimeToken('one-time')).rejects.toMatchObject({
            status: 401,
            message: 'Invalid or expired token'
        });
    });

    it('falls back to a status-coded message for non-401 non-JSON failures', async () => {
        mockFetch(() => new Response('<html>proxy error</html>', { status: 502 }));
        await expect(exchangeOneTimeToken('one-time')).rejects.toMatchObject({
            status: 502,
            message: expect.stringContaining('502')
        });
    });

    it('throws an ApiError instance', async () => {
        mockFetch(() => jsonResponse({ error: 'nope' }, { status: 400 }));
        try {
            await exchangeOneTimeToken('one-time');
            throw new Error('expected to throw');
        } catch (err) {
            expect(err).toBeInstanceOf(ApiError);
        }
    });
});

describe('logout', () => {
    it('POSTs the refresh token then clears local storage', async () => {
        setTokens({
            accessToken: 'a',
            accessExpiresAt: FUTURE,
            refreshToken: 'r',
            refreshExpiresAt: FUTURE
        });
        const fetchSpy = mockFetch(() => new Response(null, { status: 204 }));
        await logout();
        expect(fetchSpy).toHaveBeenCalledOnce();
        const [url, init] = fetchSpy.mock.calls[0];
        expect(url).toBe('/api/auth/logout');
        expect(JSON.parse((init as RequestInit).body as string)).toEqual({ refreshToken: 'r' });
        expect(localStorage.getItem('karyl-access-token')).toBeNull();
    });

    it('clears tokens even when the network call fails', async () => {
        setTokens({
            accessToken: 'a',
            accessExpiresAt: FUTURE,
            refreshToken: 'r',
            refreshExpiresAt: FUTURE
        });
        mockFetch(() => { throw new Error('offline'); });
        await expect(logout()).rejects.toThrow();
        // Tokens still gone — the finally block runs regardless.
        expect(localStorage.getItem('karyl-access-token')).toBeNull();
    });

    it('skips the network call when there is no refresh token', async () => {
        const fetchSpy = mockFetch(() => new Response(null, { status: 204 }));
        await logout();
        expect(fetchSpy).not.toHaveBeenCalled();
    });
});
