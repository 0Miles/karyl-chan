import Fastify, { FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { Client } from 'discordx';
import { existsSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

export interface WebServerOptions {
    port: number;
    host?: string;
    bot?: Client;
}

export interface CreateWebServerOptions {
    staticRoot?: string;
    bot?: Client;
}

const __dirname = dirname(fileURLToPath(import.meta.url));

function defaultStaticRoot(): string | null {
    // In production build output lives at build/web/server.js; the frontend
    // dist is copied in next to it as build/public. In dev (ts-node) it is
    // at src/web/server.ts; no static serving expected there.
    const candidates = [
        resolve(__dirname, '../public'),        // build/public relative to build/web
        resolve(__dirname, '../../public')      // build stage's public/ from repo root
    ];
    return candidates.find(p => existsSync(p)) ?? null;
}

export async function createWebServer(options: CreateWebServerOptions = {}): Promise<FastifyInstance> {
    const server = Fastify({
        logger: {
            level: process.env.NODE_ENV === 'production' ? 'info' : 'debug'
        }
    });

    server.get('/api/health', async () => {
        return {
            status: 'ok',
            uptime: process.uptime(),
            timestamp: new Date().toISOString()
        };
    });

    const bot = options.bot;
    if (bot) {
        server.get('/api/bot/status', async () => {
            const ready = bot.isReady();
            return {
                ready,
                userTag: ready ? bot.user?.tag ?? null : null,
                userId: ready ? bot.user?.id ?? null : null,
                guildCount: bot.guilds.cache.size,
                uptimeMs: bot.uptime ?? 0
            };
        });
    }

    const staticRoot = options.staticRoot ?? defaultStaticRoot();
    if (staticRoot) {
        await server.register(fastifyStatic, {
            root: staticRoot,
            prefix: '/',
            wildcard: false
        });

        // SPA fallback: non-/api, non-/auth GETs that did not match a file
        // should return index.html so Vue Router can handle the URL.
        server.setNotFoundHandler((request, reply) => {
            if (request.method !== 'GET') {
                reply.code(404).send({ error: 'Not Found' });
                return;
            }
            if (request.url.startsWith('/api') || request.url.startsWith('/auth')) {
                reply.code(404).send({ error: 'Not Found' });
                return;
            }
            reply.sendFile('index.html');
        });
    }

    return server;
}

export async function startWebServer(options: WebServerOptions): Promise<FastifyInstance> {
    const server = await createWebServer({ bot: options.bot });
    await server.listen({
        port: options.port,
        host: options.host ?? '0.0.0.0'
    });
    return server;
}
