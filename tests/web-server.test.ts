import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Client } from 'discordx';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createWebServer } from '../src/web/server.js';

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

        it('returns 404 for unknown /api routes (no SPA fallback)', async () => {
            const response = await server.inject({ method: 'GET', url: '/api/does-not-exist' });
            expect(response.statusCode).toBe(404);
            expect(response.json().error).toBe('Not Found');
        });

        it('returns 404 for unknown /auth routes (no SPA fallback)', async () => {
            const response = await server.inject({ method: 'GET', url: '/auth/does-not-exist' });
            expect(response.statusCode).toBe(404);
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
});
