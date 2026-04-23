import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Client } from 'discordx';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createWebServer } from '../src/web/server.js';
import { AuthStore } from '../src/web/auth-store.service.js';

interface FakeBotOptions {
    ready?: boolean;
    userTag?: string | null;
    userId?: string | null;
    guildCount?: number;
    uptime?: number | null;
}

function makeFakeBot(options: FakeBotOptions = {}): Client {
    const ready = options.ready ?? false;
    const user = options.userTag || options.userId
        ? { tag: options.userTag ?? null, id: options.userId ?? null }
        : null;
    return {
        isReady: () => ready,
        user,
        guilds: { cache: { size: options.guildCount ?? 0 } },
        uptime: options.uptime ?? null
    } as unknown as Client;
}

describe('web server', () => {
    const originalOwnerId = process.env.BOT_OWNER_ID;
    beforeAll(() => { delete process.env.BOT_OWNER_ID; });
    afterAll(() => {
        if (originalOwnerId === undefined) delete process.env.BOT_OWNER_ID;
        else process.env.BOT_OWNER_ID = originalOwnerId;
    });

    describe('without static root', () => {
        let server: FastifyInstance;

        beforeAll(async () => {
            server = await createWebServer({ staticRoot: undefined });
            await server.ready();
        });

        afterAll(async () => {
            await server.close();
        });

        describe('GET /api/health', () => {
            it('responds 200 with status ok', async () => {
                const response = await server.inject({ method: 'GET', url: '/api/health' });
                expect(response.statusCode).toBe(200);
                const body = response.json();
                expect(body.status).toBe('ok');
            });

            it('includes uptime as a non-negative number', async () => {
                const response = await server.inject({ method: 'GET', url: '/api/health' });
                const body = response.json();
                expect(typeof body.uptime).toBe('number');
                expect(body.uptime).toBeGreaterThanOrEqual(0);
            });

            it('includes an ISO timestamp', async () => {
                const response = await server.inject({ method: 'GET', url: '/api/health' });
                const body = response.json();
                expect(body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
            });
        });
    });

    describe('with static root (SPA fallback)', () => {
        let server: FastifyInstance;
        let staticRoot: string;

        beforeAll(async () => {
            staticRoot = mkdtempSync(join(tmpdir(), 'karyl-web-test-'));
            writeFileSync(join(staticRoot, 'index.html'), '<!doctype html><title>spa</title>');
            writeFileSync(join(staticRoot, 'real-asset.txt'), 'hello');
            server = await createWebServer({ staticRoot });
            await server.ready();
        });

        afterAll(async () => {
            await server.close();
            rmSync(staticRoot, { recursive: true, force: true });
        });

        it('serves existing static files directly', async () => {
            const response = await server.inject({ method: 'GET', url: '/real-asset.txt' });
            expect(response.statusCode).toBe(200);
            expect(response.body).toBe('hello');
        });

        it('falls back to index.html for unknown client-side routes', async () => {
            const response = await server.inject({ method: 'GET', url: '/some/client/route' });
            expect(response.statusCode).toBe(200);
            expect(response.body).toContain('<title>spa</title>');
        });

        it('falls back to index.html for /auth so the SPA can read query params', async () => {
            const response = await server.inject({ method: 'GET', url: '/auth?token=abc' });
            expect(response.statusCode).toBe(200);
            expect(response.body).toContain('<title>spa</title>');
        });

        it('returns 404 for unknown /api routes (no SPA fallback)', async () => {
            const response = await server.inject({ method: 'GET', url: '/api/does-not-exist' });
            expect(response.statusCode).toBe(404);
            expect(response.json().error).toBe('Not Found');
        });

        it('returns 404 for non-GET requests that fall through', async () => {
            const response = await server.inject({ method: 'POST', url: '/some/client/route' });
            expect(response.statusCode).toBe(404);
        });
    });

    describe('GET /api/bot/status', () => {
        it('is not registered when no bot is provided', async () => {
            const server = await createWebServer({ staticRoot: undefined });
            await server.ready();
            try {
                const response = await server.inject({ method: 'GET', url: '/api/bot/status' });
                expect(response.statusCode).toBe(404);
            } finally {
                await server.close();
            }
        });

        it('reports not-ready state when the bot is still connecting', async () => {
            const bot = makeFakeBot({ ready: false });
            const server = await createWebServer({ staticRoot: undefined, bot });
            await server.ready();
            try {
                const response = await server.inject({ method: 'GET', url: '/api/bot/status' });
                expect(response.statusCode).toBe(200);
                const body = response.json();
                expect(body.ready).toBe(false);
                expect(body.userTag).toBeNull();
                expect(body.userId).toBeNull();
            } finally {
                await server.close();
            }
        });

        it('reports ready state with user info and guild count', async () => {
            const bot = makeFakeBot({
                ready: true,
                userTag: 'karyl#0001',
                userId: '123',
                guildCount: 3,
                uptime: 5000
            });
            const server = await createWebServer({ staticRoot: undefined, bot });
            await server.ready();
            try {
                const response = await server.inject({ method: 'GET', url: '/api/bot/status' });
                expect(response.statusCode).toBe(200);
                const body = response.json();
                expect(body.ready).toBe(true);
                expect(body.userTag).toBe('karyl#0001');
                expect(body.userId).toBe('123');
                expect(body.guildCount).toBe(3);
                expect(body.uptimeMs).toBe(5000);
            } finally {
                await server.close();
            }
        });

        it('defaults uptimeMs to 0 when bot.uptime is null', async () => {
            const bot = makeFakeBot({ ready: true, uptime: null });
            const server = await createWebServer({ staticRoot: undefined, bot });
            await server.ready();
            try {
                const response = await server.inject({ method: 'GET', url: '/api/bot/status' });
                const body = response.json();
                expect(body.uptimeMs).toBe(0);
            } finally {
                await server.close();
            }
        });
    });

    describe('with BOT_OWNER_ID set (auth enabled)', () => {
        const OWNER_ID = '1234567890';
        let server: FastifyInstance;
        let store: AuthStore;

        beforeAll(async () => {
            process.env.BOT_OWNER_ID = OWNER_ID;
            store = new AuthStore();
            server = await createWebServer({ staticRoot: undefined, authStore: store });
            await server.ready();
        });

        afterAll(async () => {
            await server.close();
            store.stop();
            delete process.env.BOT_OWNER_ID;
        });

        it('rejects /api requests without an Authorization header', async () => {
            const response = await server.inject({ method: 'GET', url: '/api/health' });
            expect(response.statusCode).toBe(401);
        });

        it('rejects /api requests with an invalid bearer token', async () => {
            const response = await server.inject({
                method: 'GET',
                url: '/api/health',
                headers: { authorization: 'Bearer not-a-real-token' }
            });
            expect(response.statusCode).toBe(401);
        });

        it('accepts /api requests with a valid access token', async () => {
            const { accessToken } = await store.issueTokens(OWNER_ID);
            const response = await server.inject({
                method: 'GET',
                url: '/api/health',
                headers: { authorization: `Bearer ${accessToken}` }
            });
            expect(response.statusCode).toBe(200);
            expect(response.json().status).toBe('ok');
        });

        it('does not gate /api/auth/* (unauthenticated callers reach the handler)', async () => {
            const response = await server.inject({ method: 'POST', url: '/api/auth/exchange', payload: {} });
            expect(response.statusCode).toBe(400);
            expect(response.json().error).toBe('token required');
        });

        it('exchanges a valid one-time token for access + refresh tokens', async () => {
            const { token } = store.createOneTimeToken(OWNER_ID);
            const response = await server.inject({
                method: 'POST',
                url: '/api/auth/exchange',
                payload: { token }
            });
            expect(response.statusCode).toBe(200);
            const body = response.json();
            expect(typeof body.accessToken).toBe('string');
            expect(typeof body.refreshToken).toBe('string');
            expect(body.accessExpiresAt).toBeGreaterThan(Date.now());
            expect(body.refreshExpiresAt).toBeGreaterThan(body.accessExpiresAt);
        });

        it('rejects an already-consumed one-time token', async () => {
            const { token } = store.createOneTimeToken(OWNER_ID);
            const first = await server.inject({ method: 'POST', url: '/api/auth/exchange', payload: { token } });
            expect(first.statusCode).toBe(200);
            const second = await server.inject({ method: 'POST', url: '/api/auth/exchange', payload: { token } });
            expect(second.statusCode).toBe(401);
        });

        it('rotates the refresh token and revokes the old one', async () => {
            const initial = await store.issueTokens(OWNER_ID);
            const refreshed = await server.inject({
                method: 'POST',
                url: '/api/auth/refresh',
                payload: { refreshToken: initial.refreshToken }
            });
            expect(refreshed.statusCode).toBe(200);
            const next = refreshed.json();
            expect(next.refreshToken).not.toBe(initial.refreshToken);

            const reuse = await server.inject({
                method: 'POST',
                url: '/api/auth/refresh',
                payload: { refreshToken: initial.refreshToken }
            });
            expect(reuse.statusCode).toBe(401);
        });

        it('logout revokes the refresh token', async () => {
            const issued = await store.issueTokens(OWNER_ID);
            const logoutResp = await server.inject({
                method: 'POST',
                url: '/api/auth/logout',
                payload: { refreshToken: issued.refreshToken }
            });
            expect(logoutResp.statusCode).toBe(204);
            const reuse = await server.inject({
                method: 'POST',
                url: '/api/auth/refresh',
                payload: { refreshToken: issued.refreshToken }
            });
            expect(reuse.statusCode).toBe(401);
        });
    });
});
