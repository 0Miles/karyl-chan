import Fastify, { FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyHelmet from "@fastify/helmet";
import { Client } from "discordx";
import { existsSync, readFileSync } from "fs";
import type { ServerOptions as HttpsServerOptions } from "https";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import {
  AuthStore,
  authStore as defaultAuthStore,
} from "./auth-store.service.js";
import { JwtService, jwtService as defaultJwtService } from "./jwt.service.js";
import {
  resolveLoginRole,
  resolveUserCapabilities,
  type AdminCapability,
} from "./authorized-user.service.js";
import { RateLimiter } from "../utils/rate-limiter.js";
import fastifyMultipart from "@fastify/multipart";

// Per-IP throttles for the unauthenticated auth endpoints. One-time
// tokens are 256-bit so brute force is infeasible, but the limiter
// protects against a misbehaving client saturating sequelize or a
// targeted flood. Windows are intentionally wider than a single
// legitimate login attempt ever needs.
const loginRateLimiter = new RateLimiter({ windowMs: 60_000, max: 10 });
const refreshRateLimiter = new RateLimiter({ windowMs: 60_000, max: 60 });
// Catch-all throttle for authenticated mutations. The /api/auth/* paths
// have their own (tighter) limiters; this one shields every other write
// route from a buggy client or a compromised admin token. 30/min/user
// is well above legitimate UI usage and well below what would saturate
// Discord's REST queue or the SQLite writer.
const writeRateLimiter = new RateLimiter({ windowMs: 60_000, max: 30 });
const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function clientKey(request: import("fastify").FastifyRequest): string {
  // x-forwarded-for is only honored in trust-proxy'd deployments; raw
  // socket address is the baseline. We don't configure trust-proxy
  // today so request.ip is the immediate peer.
  return request.ip || "unknown";
}

/**
 * Paths that accept a single-use ticket via the `?ticket=` query
 * parameter (issued by POST /api/auth/sse-ticket). The whitelist keeps
 * any future non-SSE route from accidentally honoring URL-borne auth.
 */
const SSE_PATHS = new Set<string>(["/api/dm/events", "/api/guilds/events"]);

/**
 * Strip any query string from a request URL. fastify's `request.url`
 * is the raw URL including `?…` — every path matcher in the auth hook
 * must compare against this stripped form, otherwise a query string
 * would slip past `===` checks (e.g. `/api/health?cb=1` would be
 * treated as a different path than `/api/health`).
 */
function pathOnly(url: string): string {
  return url.split("?", 1)[0];
}

function isEventStreamPath(url: string): boolean {
  return SSE_PATHS.has(pathOnly(url));
}
import { registerDmRoutes } from "./dm-routes.js";
import { registerDiscordRoutes } from "./discord-routes.js";
import { avatarUrlFor } from "./message-mapper.js";
import { registerGuildsRoutes } from "./guilds-routes.js";
import { registerGuildChannelRoutes } from "./guild-channel-routes.js";
import { registerGuildManagementRoutes } from "./guild-management-routes.js";
import type { DmInboxStore } from "./dm-inbox.service.js";
import { registerSystemRoutes } from "./system-routes.js";
import { registerAdminManagementRoutes } from "./admin-management-routes.js";
import { registerAdminLoginStatusRoutes } from "./admin-login-status-routes.js";
import { registerBotEventRoutes } from "./bot-event-routes.js";
import { registerBehaviorRoutes } from "./behavior-routes.js";
import { registerPluginRoutes } from "./plugin-routes.js";
import { requireAnyCapability } from "./route-guards.js";
import { botEventLog } from "./bot-event-log.js";
import { shouldRecord } from "./bot-event-dedup.js";

declare module "fastify" {
  interface FastifyRequest {
    authUserId?: string;
    authCapabilities?: Set<AdminCapability>;
  }
}

export interface WebServerOptions {
  port: number;
  host?: string;
  bot?: Client;
  dmInbox?: DmInboxStore;
}

export interface CreateWebServerOptions {
  staticRoot?: string;
  bot?: Client;
  authStore?: AuthStore;
  /** Override JWT issuer/verifier for tests; defaults to the singleton. */
  jwtService?: JwtService;
  dmInbox?: DmInboxStore;
}

const __dirname = dirname(fileURLToPath(import.meta.url));

function defaultStaticRoot(): string | null {
  const candidates = [
    resolve(__dirname, "../public"),
    resolve(__dirname, "../../public"),
  ];
  return candidates.find((p) => existsSync(p)) ?? null;
}

function resolveHttpsOptions(): HttpsServerOptions | null {
  const certPath = process.env.SSL_CERT_PATH?.trim();
  const keyPath = process.env.SSL_KEY_PATH?.trim();
  if (!certPath || !keyPath) return null;
  // Fail loud if only one is set or files are missing — partial config
  // silently falling back to HTTP would be a nasty production footgun.
  if (!existsSync(certPath))
    throw new Error(`SSL_CERT_PATH does not exist: ${certPath}`);
  if (!existsSync(keyPath))
    throw new Error(`SSL_KEY_PATH does not exist: ${keyPath}`);
  const caPath = process.env.SSL_CA_PATH?.trim();
  return {
    cert: readFileSync(certPath),
    key: readFileSync(keyPath),
    ...(caPath ? { ca: readFileSync(caPath) } : {}),
  };
}

export async function createWebServer(
  options: CreateWebServerOptions = {},
): Promise<FastifyInstance> {
  const https = resolveHttpsOptions();
  const server = Fastify({
    logger: {
      level: process.env.NODE_ENV === "production" ? "info" : "debug",
    },
    ...(https ? { https } : {}),
  });

  const ownerId = process.env.BOT_OWNER_ID?.trim();
  const auth = options.authStore ?? defaultAuthStore;
  const jwt = options.jwtService ?? defaultJwtService;
  const authEnabled = !!ownerId;

  if (!authEnabled) {
    // Refuse to boot in production rather than silently serve admin APIs
    // to anyone. Dev and tests still get the permissive path with a
    // prominent warning so local work isn't blocked.
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "BOT_OWNER_ID must be set in production — refusing to start an unauthenticated admin API",
      );
    }
    server.log.warn(
      "BOT_OWNER_ID is not set — /api endpoints are UNAUTHENTICATED (dev only)",
    );
  }

  server.addHook("onRequest", async (request, reply) => {
    if (!request.url.startsWith("/api")) return;
    if (request.url.startsWith("/api/auth/")) return;
    if (pathOnly(request.url) === "/api/health") return;
    // Plugin-facing endpoints have their own auth model (setup secret
    // for register, plugin bearer token for heartbeat / RPC). Admin
    // endpoints under /api/plugins still go through this hook below.
    {
      const path = pathOnly(request.url);
      if (path === "/api/plugins/register") return;
      if (path === "/api/plugins/heartbeat") return;
    }
    if (!authEnabled) {
      // Dev-only branch (production fails to boot without
      // BOT_OWNER_ID; see the guard above). Hand requests a
      // synthetic admin context so per-route capability checks
      // resolve cleanly — without this, every guarded route would
      // 403 in tests / `npm run dev` since the hook has no user
      // to attach.
      request.authUserId = "dev";
      request.authCapabilities = new Set(["admin"]);
      return;
    }
    const header = request.headers.authorization;
    const presentedAccess: string | null = header?.startsWith("Bearer ")
      ? header.slice(7)
      : null;
    let userId: string | null = presentedAccess
      ? auth.verifyAccessToken(presentedAccess)
      : null;
    if (!userId && isEventStreamPath(request.url)) {
      // EventSource can't set Authorization headers, so SSE endpoints
      // accept a single-use ticket from POST /api/auth/sse-ticket
      // instead. The ticket is consumed on first verification — even
      // if it leaks via access logs / browser history, it's already
      // dead by the time anyone reads it.
      const query = request.query as { ticket?: string } | undefined;
      const ticket =
        typeof query?.ticket === "string" && query.ticket.length > 0
          ? query.ticket
          : null;
      if (ticket) userId = auth.consumeSseTicket(ticket);
    }
    if (!userId) {
      reply.code(401).send({ error: "Unauthorized" });
      return;
    }
    // Capability resolution runs per-request so de-authorizing a user (or
    // stripping capabilities from their role) takes effect on their next
    // call — even if they still hold an un-expired access token. Owner
    // always resolves to every capability; other users resolve via the
    // authorized_users → admin_role_capabilities join.
    const capabilities = await resolveUserCapabilities(userId, ownerId);
    if (capabilities.size === 0) {
      botEventLog.record(
        "warn",
        "auth",
        `Authenticated user lacks all capabilities: ${userId}`,
        { userId, path: request.url },
      );
      reply.code(403).send({ error: "Forbidden" });
      return;
    }
    request.authUserId = userId;
    request.authCapabilities = capabilities;
  });

  // Universal write throttle, runs AFTER the auth hook so we can key
  // off the authenticated user when available (per-IP would let a
  // shared NAT poison everyone behind it). Skips read methods entirely
  // and skips /api/auth/* since those have their own dedicated limits.
  server.addHook("onRequest", async (request, reply) => {
    if (!request.url.startsWith("/api")) return;
    if (request.url.startsWith("/api/auth/")) return;
    if (!WRITE_METHODS.has(request.method)) return;
    const key = request.authUserId ?? clientKey(request);
    if (writeRateLimiter.isRateLimited(`write:${key}`)) {
      reply.code(429).send({ error: "Too many write requests, slow down" });
    }
  });

  // Security headers. 'unsafe-inline' on style-src is required for
  // Vue's scoped styles. script-src is now strict-self only — lottie
  // stickers use the `_light` build (see MessageSticker.vue) which
  // doesn't need `new Function`, so we can drop `unsafe-eval`.
  // Discord CDN hosts every avatar + custom emoji + sticker we render,
  // so it's whitelisted under img-src / media-src. connect-src adds
  // the Iconify API hosts since @iconify/vue fetches icon SVGs at
  // runtime.
  await server.register(fastifyHelmet, {
    contentSecurityPolicy: {
      directives: {
        "default-src": ["'self'"],
        "base-uri": ["'self'"],
        "img-src": [
          "'self'",
          "data:",
          "https://cdn.discordapp.com",
          "https://media.discordapp.net",
          // @twemoji/parser produces
          // https://cdn.jsdelivr.net/gh/jdecked/twemoji@latest/...
          // for every unicode emoji we render in messages and
          // reactions. Without this entry the <img> loads are
          // CSP-blocked and iOS Safari shows the broken-image
          // frame with the alt char crammed into the corner.
          "https://cdn.jsdelivr.net",
        ],
        "media-src": [
          "'self'",
          "https://cdn.discordapp.com",
          "https://media.discordapp.net",
        ],
        "font-src": ["'self'", "data:"],
        "style-src": ["'self'", "'unsafe-inline'"],
        "script-src": ["'self'"],
        "script-src-attr": ["'none'"],
        "connect-src": [
          "'self'",
          "https://api.iconify.design",
          "https://api.simplesvg.com",
          "https://api.unisvg.com",
        ],
        "form-action": ["'self'"],
        "frame-ancestors": ["'none'"],
        "object-src": ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "same-origin" },
  });

  await server.register(fastifyMultipart, {
    limits: { fileSize: 25 * 1024 * 1024, files: 10 },
  });

  server.post<{ Body: { token?: unknown } }>(
    "/api/auth/exchange",
    async (request, reply) => {
      if (!authEnabled) {
        reply.code(503).send({ error: "Auth not configured" });
        return;
      }
      if (loginRateLimiter.isRateLimited(clientKey(request))) {
        const ip = clientKey(request);
        if (shouldRecord(`rateLimit:${ip}:/api/auth/exchange`)) {
          botEventLog.record(
            "warn",
            "auth",
            "Auth rate-limit hit: /api/auth/exchange",
            { endpoint: "/api/auth/exchange", ip },
          );
        }
        reply.code(429).send({ error: "Too many attempts, slow down" });
        return;
      }
      const loginToken =
        typeof request.body?.token === "string" ? request.body.token : null;
      if (!loginToken) {
        reply.code(400).send({ error: "token required" });
        return;
      }
      // Stage 1 — JWT must be intact, unexpired, and minted for the
      // login flow. `purpose: 'login'` blocks tokens issued for some
      // other future flow (e.g., account-link DMs) from being walked
      // up to a full session here. Tampered / stale / wrong-purpose
      // all collapse into a generic 401 so we don't hand probers a
      // useful distinction.
      const claims = jwt.verify(loginToken, { purpose: "login" });
      if (!claims) {
        const ip = clientKey(request);
        if (shouldRecord(`jwtReject:${ip}`)) {
          botEventLog.record(
            "warn",
            "auth",
            "Login token rejected (invalid/expired)",
            { ip },
          );
        }
        reply.code(401).send({ error: "Invalid or expired token" });
        return;
      }
      // Stage 2 — JWT info (the user) must still be permitted to log
      // in. Authorization can change between issuance and exchange
      // (role demotion, account removal); resolveLoginRole reflects
      // the current state.
      const role = await resolveLoginRole(claims.userId);
      if (!role) {
        request.log.warn(
          {
            userId: claims.userId,
            guildId: claims.guildId,
            channelId: claims.channelId,
            messageId: claims.messageId,
          },
          "auth.exchange: token user no longer authorized",
        );
        botEventLog.record(
          "warn",
          "auth",
          `Login attempt by deauthorized user: ${claims.userId}`,
          {
            userId: claims.userId,
            guildId: claims.guildId,
            channelId: claims.channelId,
            messageId: claims.messageId,
          },
        );
        reply.code(401).send({ error: "User no longer authorized" });
        return;
      }
      try {
        const tokens = await auth.issueTokens(claims.userId);
        botEventLog.record(
          "info",
          "auth",
          `Admin login: ${claims.userId} role=${role}`,
          {
            userId: claims.userId,
            role,
            guildId: claims.guildId,
            channelId: claims.channelId,
          },
        );
        return tokens;
      } catch (err) {
        // Most plausible cause is the SQLite refresh-token persistence
        // throwing. The full error (which can include SQL error text,
        // file paths, or stack traces) is logged server-side; the
        // client gets a generic message so we don't hand probers free
        // intel on internal state.
        const detail = err instanceof Error ? err.message : String(err);
        request.log.error({ err }, "auth.exchange: issueTokens failed");
        botEventLog.record(
          "error",
          "auth",
          `Token issuance failed: ${detail}`,
          { userId: claims.userId },
        );
        reply.code(500).send({ error: "Token issuance failed" });
      }
    },
  );

  server.post<{ Body: { refreshToken?: unknown } }>(
    "/api/auth/refresh",
    async (request, reply) => {
      if (!authEnabled) {
        reply.code(503).send({ error: "Auth not configured" });
        return;
      }
      if (refreshRateLimiter.isRateLimited(clientKey(request))) {
        const ip = clientKey(request);
        if (shouldRecord(`rateLimit:${ip}:/api/auth/refresh`)) {
          botEventLog.record(
            "warn",
            "auth",
            "Auth rate-limit hit: /api/auth/refresh",
            { endpoint: "/api/auth/refresh", ip },
          );
        }
        reply.code(429).send({ error: "Too many refresh attempts, slow down" });
        return;
      }
      const refreshToken =
        typeof request.body?.refreshToken === "string"
          ? request.body.refreshToken
          : null;
      if (!refreshToken) {
        reply.code(400).send({ error: "refreshToken required" });
        return;
      }
      const issued = await auth.rotateRefresh(refreshToken);
      if (!issued) {
        reply.code(401).send({ error: "Invalid or expired refresh token" });
        return;
      }
      return issued;
    },
  );

  server.post("/api/auth/sse-ticket", async (request, reply) => {
    // /api/auth/* is exempt from the global onRequest hook so the
    // ticket endpoint authenticates inline with the same Bearer-token
    // contract every other admin route uses. We deliberately skip the
    // capability join here — the SSE endpoints themselves still go
    // through the hook (with the ticket) and re-resolve capabilities
    // at that point, so capability changes still take effect.
    if (!authEnabled) {
      reply.code(503).send({ error: "Auth not configured" });
      return;
    }
    const header = request.headers.authorization;
    const presented = header?.startsWith("Bearer ") ? header.slice(7) : null;
    const userId = presented ? auth.verifyAccessToken(presented) : null;
    if (!userId) {
      reply.code(401).send({ error: "Unauthorized" });
      return;
    }
    return auth.issueSseTicket(userId);
  });

  server.post<{ Body: { refreshToken?: unknown } }>(
    "/api/auth/logout",
    async (request, reply) => {
      if (!authEnabled) {
        reply.code(204).send();
        return;
      }
      const refreshToken =
        typeof request.body?.refreshToken === "string"
          ? request.body.refreshToken
          : null;
      const refreshRevoked = !!refreshToken;
      if (refreshToken) await auth.revokeRefresh(refreshToken);
      // Revoke the presented access token too. Access tokens live in
      // memory (not JWTs), so we can actually invalidate them rather
      // than waiting for TTL. The Authorization header arrives even
      // though /api/auth/* is excluded from the hook.
      const header = request.headers.authorization;
      const accessToken = header?.startsWith("Bearer ")
        ? header.slice(7)
        : null;
      const userId = accessToken ? auth.verifyAccessToken(accessToken) : null;
      if (accessToken) auth.revokeAccess(accessToken);
      if (userId) {
        botEventLog.record("info", "auth", `Admin logout: ${userId}`, {
          userId,
          refreshRevoked,
        });
      }
      reply.code(204).send();
    },
  );

  server.get("/api/health", async () => {
    return {
      status: "ok",
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    };
  });

  const bot = options.bot;
  await registerAdminManagementRoutes(server, { bot });
  await registerAdminLoginStatusRoutes(server);
  await registerBotEventRoutes(server);
  await registerBehaviorRoutes(server, { bot });
  await registerPluginRoutes(server);

  if (bot) {
    server.get("/api/bot/status", async (request, reply) => {
      // Bot identity feeds the chat composer ("is this me?") and the
      // dashboard at the same time, so any of the read capabilities
      // is enough.
      if (
        !requireAnyCapability(request, reply, [
          "dm.message",
          "guild.message",
          "guild.manage",
          "system.read",
        ])
      )
        return;
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
        uptimeMs: bot.uptime ?? 0,
      };
    });
    await registerDmRoutes(server, { bot, inbox: options.dmInbox });
    await registerDiscordRoutes(server, { bot });
    await registerGuildsRoutes(server, { bot });
    await registerGuildChannelRoutes(server, { bot });
    await registerGuildManagementRoutes(server, { bot });
    await registerSystemRoutes(server, { bot, dmInbox: options.dmInbox });
  } else {
    await registerSystemRoutes(server, { dmInbox: options.dmInbox });
  }

  const staticRoot = options.staticRoot ?? defaultStaticRoot();
  if (staticRoot) {
    await server.register(fastifyStatic, {
      root: staticRoot,
      prefix: "/",
      wildcard: false,
    });

    server.setNotFoundHandler((request, reply) => {
      if (request.method !== "GET") {
        reply.code(404).send({ error: "Not Found" });
        return;
      }
      if (request.url.startsWith("/api")) {
        reply.code(404).send({ error: "Not Found" });
        return;
      }
      reply.sendFile("index.html");
    });
  }

  return server;
}

export async function startWebServer(
  options: WebServerOptions,
): Promise<FastifyInstance> {
  const server = await createWebServer({
    bot: options.bot,
    dmInbox: options.dmInbox,
  });
  await server.listen({
    port: options.port,
    host: options.host ?? "0.0.0.0",
  });
  return server;
}
