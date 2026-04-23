import Fastify, { FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { Client } from 'discordx';
import { existsSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { AuthStore, authStore as defaultAuthStore } from './auth-store.service.js';
import fastifyMultipart from '@fastify/multipart';
import { registerDmRoutes } from './dm-routes.js';
import { registerDiscordRoutes } from './discord-routes.js';
import { registerGuildsRoutes } from './guilds-routes.js';
import { registerGuildChannelRoutes } from './guild-channel-routes.js';
import type { DmInboxStore } from './dm-inbox.service.js';

export interface WebServerOptions {
    port: number;
    host?: string;
    bot?: Client;
}

export interface CreateWebServerOptions {
    staticRoot?: string;
    bot?: Client;
    authStore?: AuthStore;
    dmInbox?: DmInboxStore;
}

const __dirname = dirname(fileURLToPath(import.meta.url));

function defaultStaticRoot(): string | null {
    const candidates = [
        resolve(__dirname, '../public'),
        resolve(__dirname, '../../public')
    ];
    return candidates.find(p => existsSync(p)) ?? null;
}

export async function createWebServer(options: CreateWebServerOptions = {}): Promise<FastifyInstance> {
    const server = Fastify({
        logger: {
            level: process.env.NODE_ENV === 'production' ? 'info' : 'debug'
        }
    });

    const ownerId = process.env.BOT_OWNER_ID?.trim();
    const auth = options.authStore ?? defaultAuthStore;
    const authEnabled = !!ownerId;

    if (!authEnabled) {
        server.log.warn('BOT_OWNER_ID is not set — /api endpoints are UNAUTHENTICATED');
    }

    server.addHook('onRequest', async (request, reply) => {
        if (!request.url.startsWith('/api')) return;
        if (request.url.startsWith('/api/auth/')) return;
        if (!authEnabled) return;
        const header = request.headers.authorization;
        let presented: string | null = header?.startsWith('Bearer ') ? header.slice(7) : null;
        if (!presented) {
            // EventSource can't set Authorization headers, so /api/dm/events
            // accepts the access token as a query string fallback.
            const query = request.query as { access_token?: string } | undefined;
            if (typeof query?.access_token === 'string' && query.access_token.length > 0) {
                presented = query.access_token;
            }
        }
        if (!presented || !auth.verifyAccessToken(presented)) {
            reply.code(401).send({ error: 'Unauthorized' });
        }
    });

    await server.register(fastifyMultipart, {
        limits: { fileSize: 25 * 1024 * 1024, files: 10 }
    });

    server.post<{ Body: { token?: unknown } }>('/api/auth/exchange', async (request, reply) => {
        if (!authEnabled) {
            reply.code(503).send({ error: 'Auth not configured' });
            return;
        }
        const oneTimeToken = typeof request.body?.token === 'string' ? request.body.token : null;
        if (!oneTimeToken) {
            reply.code(400).send({ error: 'token required' });
            return;
        }
        const ownerForToken = auth.consumeOneTimeToken(oneTimeToken);
        if (!ownerForToken) {
            reply.code(401).send({ error: 'Invalid or expired token' });
            return;
        }
        const issued = await auth.issueTokens(ownerForToken);
        return issued;
    });

    server.post<{ Body: { refreshToken?: unknown } }>('/api/auth/refresh', async (request, reply) => {
        if (!authEnabled) {
            reply.code(503).send({ error: 'Auth not configured' });
            return;
        }
        const refreshToken = typeof request.body?.refreshToken === 'string' ? request.body.refreshToken : null;
        if (!refreshToken) {
            reply.code(400).send({ error: 'refreshToken required' });
            return;
        }
        const issued = await auth.rotateRefresh(refreshToken);
        if (!issued) {
            reply.code(401).send({ error: 'Invalid or expired refresh token' });
            return;
        }
        return issued;
    });

    server.post<{ Body: { refreshToken?: unknown } }>('/api/auth/logout', async (request, reply) => {
        if (!authEnabled) {
            reply.code(204).send();
            return;
        }
        const refreshToken = typeof request.body?.refreshToken === 'string' ? request.body.refreshToken : null;
        if (refreshToken) await auth.revokeRefresh(refreshToken);
        reply.code(204).send();
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
        await registerDmRoutes(server, { bot, inbox: options.dmInbox });
        await registerDiscordRoutes(server, { bot });
        await registerGuildsRoutes(server, { bot });
        await registerGuildChannelRoutes(server, { bot });
    }

    const staticRoot = options.staticRoot ?? defaultStaticRoot();
    if (staticRoot) {
        await server.register(fastifyStatic, {
            root: staticRoot,
            prefix: '/',
            wildcard: false
        });

        server.setNotFoundHandler((request, reply) => {
            if (request.method !== 'GET') {
                reply.code(404).send({ error: 'Not Found' });
                return;
            }
            if (request.url.startsWith('/api')) {
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
