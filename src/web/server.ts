import Fastify, { FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyHelmet from '@fastify/helmet';
import { Client } from 'discordx';
import { existsSync, readFileSync } from 'fs';
import type { ServerOptions as HttpsServerOptions } from 'https';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { AuthStore, authStore as defaultAuthStore } from './auth-store.service.js';
import { resolveUserCapabilities, type AdminCapability } from './authorized-user.service.js';
import { RateLimiter } from '../utils/rate-limiter.js';
import fastifyMultipart from '@fastify/multipart';

// Per-IP throttles for the unauthenticated auth endpoints. One-time
// tokens are 256-bit so brute force is infeasible, but the limiter
// protects against a misbehaving client saturating sequelize or a
// targeted flood. Windows are intentionally wider than a single
// legitimate login attempt ever needs.
const loginRateLimiter = new RateLimiter({ windowMs: 60_000, max: 10 });
const refreshRateLimiter = new RateLimiter({ windowMs: 60_000, max: 60 });

function clientKey(request: import('fastify').FastifyRequest): string {
    // x-forwarded-for is only honored in trust-proxy'd deployments; raw
    // socket address is the baseline. We don't configure trust-proxy
    // today so request.ip is the immediate peer.
    return request.ip || 'unknown';
}

/**
 * Paths that accept access_token via query string. Restricting the
 * fallback keeps the token out of access logs for non-SSE traffic.
 */
const SSE_PATHS = new Set<string>([
    '/api/dm/events',
    '/api/guilds/events'
]);

function isEventStreamPath(url: string): boolean {
    // Strip query before matching so "/api/dm/events?access_token=…" hits.
    const path = url.split('?', 1)[0];
    return SSE_PATHS.has(path);
}
import { registerDmRoutes } from './dm-routes.js';
import { registerDiscordRoutes } from './discord-routes.js';
import { avatarUrlFor } from './message-mapper.js';
import { registerGuildsRoutes } from './guilds-routes.js';
import { registerGuildChannelRoutes } from './guild-channel-routes.js';
import type { DmInboxStore } from './dm-inbox.service.js';
import { registerSystemRoutes } from './system-routes.js';
import { registerAdminManagementRoutes } from './admin-management-routes.js';

declare module 'fastify' {
    interface FastifyRequest {
        authUserId?: string;
        authCapabilities?: Set<AdminCapability>;
    }
}

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

function resolveHttpsOptions(): HttpsServerOptions | null {
    const certPath = process.env.SSL_CERT_PATH?.trim();
    const keyPath = process.env.SSL_KEY_PATH?.trim();
    if (!certPath || !keyPath) return null;
    // Fail loud if only one is set or files are missing — partial config
    // silently falling back to HTTP would be a nasty production footgun.
    if (!existsSync(certPath)) throw new Error(`SSL_CERT_PATH does not exist: ${certPath}`);
    if (!existsSync(keyPath)) throw new Error(`SSL_KEY_PATH does not exist: ${keyPath}`);
    const caPath = process.env.SSL_CA_PATH?.trim();
    return {
        cert: readFileSync(certPath),
        key: readFileSync(keyPath),
        ...(caPath ? { ca: readFileSync(caPath) } : {})
    };
}

export async function createWebServer(options: CreateWebServerOptions = {}): Promise<FastifyInstance> {
    const https = resolveHttpsOptions();
    const server = Fastify({
        logger: {
            level: process.env.NODE_ENV === 'production' ? 'info' : 'debug'
        },
        ...(https ? { https } : {})
    });

    const ownerId = process.env.BOT_OWNER_ID?.trim();
    const auth = options.authStore ?? defaultAuthStore;
    const authEnabled = !!ownerId;

    if (!authEnabled) {
        // Refuse to boot in production rather than silently serve admin APIs
        // to anyone. Dev and tests still get the permissive path with a
        // prominent warning so local work isn't blocked.
        if (process.env.NODE_ENV === 'production') {
            throw new Error('BOT_OWNER_ID must be set in production — refusing to start an unauthenticated admin API');
        }
        server.log.warn('BOT_OWNER_ID is not set — /api endpoints are UNAUTHENTICATED (dev only)');
    }

    server.addHook('onRequest', async (request, reply) => {
        if (!request.url.startsWith('/api')) return;
        if (request.url.startsWith('/api/auth/')) return;
        if (!authEnabled) return;
        const header = request.headers.authorization;
        let presented: string | null = header?.startsWith('Bearer ') ? header.slice(7) : null;
        if (!presented && isEventStreamPath(request.url)) {
            // EventSource can't set Authorization headers, so SSE endpoints
            // alone get to fall back to a query string. Scoping by path
            // keeps the token out of access logs for every other route.
            const query = request.query as { access_token?: string } | undefined;
            if (typeof query?.access_token === 'string' && query.access_token.length > 0) {
                presented = query.access_token;
            }
        }
        const userId = presented ? auth.verifyAccessToken(presented) : null;
        if (!userId) {
            reply.code(401).send({ error: 'Unauthorized' });
            return;
        }
        // Capability resolution runs per-request so de-authorizing a user (or
        // stripping capabilities from their role) takes effect on their next
        // call — even if they still hold an un-expired access token. Owner
        // always resolves to every capability; other users resolve via the
        // authorized_users → admin_role_capabilities join.
        const capabilities = await resolveUserCapabilities(userId, ownerId);
        if (capabilities.size === 0) {
            reply.code(403).send({ error: 'Forbidden' });
            return;
        }
        request.authUserId = userId;
        request.authCapabilities = capabilities;
    });

    // Security headers. CSP allows same-origin scripts plus 'unsafe-eval'
    // (required by lottie-web) and 'unsafe-inline' for Vue's scoped styles.
    // Discord CDN hosts every avatar + custom emoji + sticker we render, so
    // it's whitelisted under img-src / media-src. connect-src stays 'self'
    // — admin API + SSE are same-origin.
    await server.register(fastifyHelmet, {
        contentSecurityPolicy: {
            directives: {
                'default-src': ["'self'"],
                'base-uri': ["'self'"],
                'img-src': [
                    "'self'",
                    'data:',
                    'https://cdn.discordapp.com',
                    'https://media.discordapp.net'
                ],
                'media-src': [
                    "'self'",
                    'https://cdn.discordapp.com',
                    'https://media.discordapp.net'
                ],
                'font-src': ["'self'", 'data:'],
                'style-src': ["'self'", "'unsafe-inline'"],
                'script-src': ["'self'", "'unsafe-eval'"],
                'script-src-attr': ["'none'"],
                'connect-src': ["'self'"],
                'form-action': ["'self'"],
                'frame-ancestors': ["'none'"],
                'object-src': ["'none'"]
            }
        },
        crossOriginEmbedderPolicy: false,
        crossOriginResourcePolicy: { policy: 'same-origin' }
    });

    await server.register(fastifyMultipart, {
        limits: { fileSize: 25 * 1024 * 1024, files: 10 }
    });

    server.post<{ Body: { token?: unknown } }>('/api/auth/exchange', async (request, reply) => {
        if (!authEnabled) {
            reply.code(503).send({ error: 'Auth not configured' });
            return;
        }
        if (loginRateLimiter.isRateLimited(clientKey(request))) {
            reply.code(429).send({ error: 'Too many attempts, slow down' });
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
        if (refreshRateLimiter.isRateLimited(clientKey(request))) {
            reply.code(429).send({ error: 'Too many refresh attempts, slow down' });
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
        // Revoke the presented access token too. Access tokens live in
        // memory (not JWTs), so we can actually invalidate them rather
        // than waiting for TTL. The Authorization header arrives even
        // though /api/auth/* is excluded from the hook.
        const header = request.headers.authorization;
        if (header?.startsWith('Bearer ')) auth.revokeAccess(header.slice(7));
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
    await registerAdminManagementRoutes(server, { bot });

    if (bot) {
        server.get('/api/bot/status', async () => {
            const ready = bot.isReady();
            const user = ready ? bot.user : null;
            return {
                ready,
                userTag: user?.tag ?? null,
                userId: user?.id ?? null,
                username: user?.username ?? null,
                globalName: user?.globalName ?? null,
                avatarUrl: user ? avatarUrlFor(user.id, user.avatar) : null,
                guildCount: bot.guilds.cache.size,
                uptimeMs: bot.uptime ?? 0
            };
        });
        await registerDmRoutes(server, { bot, inbox: options.dmInbox });
        await registerDiscordRoutes(server, { bot });
        await registerGuildsRoutes(server, { bot });
        await registerGuildChannelRoutes(server, { bot });
        await registerSystemRoutes(server, { bot, dmInbox: options.dmInbox });
    } else {
        await registerSystemRoutes(server, { dmInbox: options.dmInbox });
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
