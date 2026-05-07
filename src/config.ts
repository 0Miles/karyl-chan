/**
 * 集中式環境變數讀取與 validation。
 *
 * 所有 env 在此處讀取一次，型別安全地暴露為凍結物件。
 * 其他模組透過 `import { config } from "../config.js"` 取用，
 * 不再直接讀 process.env。
 */

export interface AppConfig {
  env: "production" | "development" | "test";
  bot: {
    token: string;
    /** Primary owner id for backward compatibility (ownerIds[0] ?? null). */
    ownerId: string | null;
    /** All owner-equivalent user ids. Sourced from BOT_OWNER_IDS (comma-separated),
     * or falls back to BOT_OWNER_ID (single). Empty array means no owner configured. */
    ownerIds: string[];
    /** When true, GuildMessageTyping and DirectMessageTyping intents are registered. */
    enableTyping: boolean;
  };
  web: {
    port: number;
    host: string;
    baseUrl: string | null;
    sslCertPath: string | null;
    sslKeyPath: string | null;
    sslCaPath: string | null;
    trustedProxy: boolean;
    trustedProxyCidrs: string[];
    trustCloudflare: boolean;
    /** Global Fastify bodyLimit (bytes). Applies to all non-multipart routes. */
    bodyLimitBytes: number;
    /** Per-field size cap for multipart uploads (bytes). */
    multipartFieldSizeBytes: number;
    /** Maximum number of non-file fields allowed in a multipart request. */
    multipartFieldsLimit: number;
  };
  db: {
    sqlitePath: string | null;
  };
  crypto: {
    encryptionKey: string | null;
  };
  jwt: {
    secret: string | null;
    loginLinkTtlMs: number;
    accessTtlMs: number;
    refreshTtlMs: number;
    sseTicketTtlMs: number;
    cleanupIntervalMs: number;
  };
  plugin: {
    tokenTtlMs: number;
    heartbeatTimeoutMs: number;
    reaperIntervalMs: number;
    dispatchTimeoutMs: number;
    commandDispatchTimeoutMs: number;
    autocompleteTimeoutMs: number;
    kvValueMaxBytes: number;
    dmRatePerSec: number;
    dmWindowMs: number;
    autoApproveScopes: boolean;
  };
  behavior: {
    profileCacheTtlMs: number;
    /** Continuous session expiry in hours. Sessions older than this are treated
     *  as if they don't exist. Default: 24. */
    sessionExpireHours: number;
  };
  admin: {
    profileCacheTtlMs: number;
    sessionCacheTtlMs: number;
  };
  rcon: {
    maxRetryAttempts: number;
    maxQueueSize: number;
    connectionTimeoutMs: number;
    cleanupIntervalMs: number;
    maxConnections: number;
  };
  botEvents: {
    dedupWindowMs: number;
    dedupMaxKeys: number;
  };
  dm: {
    maxFetchCount: number;
    maxAttachmentBytes: number;
    sseMaxListeners: number;
  };
}

function parseIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = parseInt(raw.trim(), 10);
  if (isNaN(parsed)) {
    throw new Error(`Config error: ${name} must be an integer (got "${raw}")`);
  }
  return parsed;
}

function strEnv(name: string): string | null {
  const v = process.env[name]?.trim();
  return v && v.length > 0 ? v : null;
}

function parseBoolEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  return raw.trim() === "true";
}

function parseCidrListEnv(name: string): string[] {
  const raw = process.env[name];
  if (!raw || raw.trim() === "") return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// Rough structural check: "host/prefixlen". Full IP validity is left
// to proxy-addr at runtime; this catches obvious typos at boot time.
// Exported so tests can assert the boot-time fail-fast contract without
// needing to re-import the whole config module.
export function isValidCidrSyntax(cidr: string): boolean {
  const slash = cidr.lastIndexOf("/");
  if (slash === -1) return false;
  const prefix = parseInt(cidr.slice(slash + 1), 10);
  return !isNaN(prefix) && prefix >= 0 && prefix <= 128;
}

function loadConfig(): AppConfig {
  const rawEnv = (process.env.NODE_ENV ?? "development").trim();
  const env =
    rawEnv === "production"
      ? "production"
      : rawEnv === "test"
        ? "test"
        : "development";

  const botToken = strEnv("BOT_TOKEN");
  // In test environments BOT_TOKEN is intentionally not set (tests mock
  // the bot client or only test HTTP / DB layers). Only enforce in
  // non-test environments so the config module can be imported by tests.
  if (!botToken && env !== "test") {
    throw new Error("Config error: BOT_TOKEN is required");
  }

  // BOT_OWNER_IDS takes precedence over BOT_OWNER_ID when both are set.
  const ownerIdsRaw = strEnv("BOT_OWNER_IDS");
  const ownerIds: string[] = ownerIdsRaw
    ? ownerIdsRaw
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
    : strEnv("BOT_OWNER_ID")
      ? [strEnv("BOT_OWNER_ID") as string]
      : [];

  const cfg: AppConfig = {
    env,
    bot: {
      token: botToken ?? "",
      ownerIds,
      ownerId: ownerIds[0] ?? null,
      enableTyping: parseBoolEnv("BOT_ENABLE_TYPING", false),
    },
    web: {
      port: parseIntEnv("WEB_PORT", 3000),
      host: strEnv("WEB_HOST") ?? "0.0.0.0",
      baseUrl: strEnv("WEB_BASE_URL"),
      sslCertPath: strEnv("SSL_CERT_PATH"),
      sslKeyPath: strEnv("SSL_KEY_PATH"),
      sslCaPath: strEnv("SSL_CA_PATH"),
      trustedProxy: parseBoolEnv("TRUSTED_PROXY", false),
      trustedProxyCidrs: parseCidrListEnv("TRUSTED_PROXY_CIDRS"),
      trustCloudflare: parseBoolEnv("TRUST_CLOUDFLARE", false),
      bodyLimitBytes: parseIntEnv("WEB_BODY_LIMIT_BYTES", 30 * 1024 * 1024),
      multipartFieldSizeBytes: parseIntEnv(
        "WEB_MULTIPART_FIELD_SIZE_BYTES",
        1 * 1024 * 1024,
      ),
      multipartFieldsLimit: parseIntEnv("WEB_MULTIPART_FIELDS_LIMIT", 50),
    },
    db: {
      sqlitePath: strEnv("SQLITE_DB_PATH"),
    },
    crypto: {
      encryptionKey: strEnv("ENCRYPTION_KEY"),
    },
    jwt: {
      secret: strEnv("JWT_SECRET"),
      loginLinkTtlMs: parseIntEnv("JWT_LOGIN_LINK_TTL_MS", 5 * 60 * 1000),
      accessTtlMs: parseIntEnv("JWT_ACCESS_TTL_MS", 15 * 60 * 1000),
      refreshTtlMs: parseIntEnv("JWT_REFRESH_TTL_MS", 7 * 24 * 60 * 60 * 1000),
      sseTicketTtlMs: parseIntEnv("JWT_SSE_TICKET_TTL_MS", 60 * 1000),
      cleanupIntervalMs: parseIntEnv("JWT_CLEANUP_INTERVAL_MS", 60 * 1000),
    },
    plugin: {
      tokenTtlMs: parseIntEnv("PLUGIN_TOKEN_TTL_MS", 60 * 60 * 1000),
      heartbeatTimeoutMs: parseIntEnv("PLUGIN_HEARTBEAT_TIMEOUT_MS", 75_000),
      reaperIntervalMs: parseIntEnv("PLUGIN_REAPER_INTERVAL_MS", 30_000),
      dispatchTimeoutMs: parseIntEnv("PLUGIN_DISPATCH_TIMEOUT_MS", 5_000),
      commandDispatchTimeoutMs: parseIntEnv(
        "PLUGIN_COMMAND_DISPATCH_TIMEOUT_MS",
        5_000,
      ),
      autocompleteTimeoutMs: parseIntEnv(
        "PLUGIN_AUTOCOMPLETE_TIMEOUT_MS",
        1_500,
      ),
      kvValueMaxBytes: parseIntEnv("PLUGIN_KV_VALUE_MAX_BYTES", 64 * 1024),
      dmRatePerSec: parseIntEnv("PLUGIN_DM_PER_SEC", 30),
      dmWindowMs: parseIntEnv("PLUGIN_DM_WINDOW_MS", 1000),
      autoApproveScopes: parseBoolEnv("PLUGIN_AUTO_APPROVE_SCOPES", true),
    },
    behavior: {
      profileCacheTtlMs: parseIntEnv(
        "BEHAVIOR_PROFILE_CACHE_TTL_MS",
        5 * 60 * 1000,
      ),
      sessionExpireHours: parseIntEnv("BEHAVIOR_SESSION_EXPIRE_HOURS", 24),
    },
    admin: {
      profileCacheTtlMs: parseIntEnv(
        "ADMIN_PROFILE_CACHE_TTL_MS",
        5 * 60 * 1000,
      ),
      sessionCacheTtlMs: parseIntEnv("ADMIN_SESSION_CACHE_TTL_MS", 30_000),
    },
    rcon: {
      maxRetryAttempts: parseIntEnv("RCON_MAX_RETRY_ATTEMPTS", 3),
      maxQueueSize: parseIntEnv("RCON_MAX_QUEUE_SIZE", 100),
      connectionTimeoutMs: parseIntEnv(
        "RCON_CONNECTION_TIMEOUT_MS",
        30 * 60 * 1000,
      ),
      cleanupIntervalMs: parseIntEnv("RCON_CLEANUP_INTERVAL_MS", 5 * 60 * 1000),
      maxConnections: parseIntEnv("RCON_MAX_CONNECTIONS", 50),
    },
    botEvents: {
      dedupWindowMs: parseIntEnv("BOT_EVENTS_DEDUP_WINDOW_MS", 60_000),
      dedupMaxKeys: parseIntEnv("BOT_EVENTS_DEDUP_MAX_KEYS", 1_000),
    },
    dm: {
      maxFetchCount: parseIntEnv("DM_MAX_FETCH_COUNT", 500),
      maxAttachmentBytes: parseIntEnv("DM_MAX_ATTACHMENT_BYTES", 1_000_000),
      sseMaxListeners: parseIntEnv("SSE_MAX_LISTENERS", 200),
    },
  };

  // Fail-fast: PLUGIN_DM_PER_SEC=0 makes every request 429; PLUGIN_DM_WINDOW_MS=0
  // makes the bucket always-empty and silently disables the limiter. Reject both
  // at boot so a misconfigured deployment can't quietly lose the SSRF / DM-spam
  // protection.
  if (cfg.plugin.dmRatePerSec < 1) {
    throw new Error(
      `Config error: PLUGIN_DM_PER_SEC must be >= 1 (got ${cfg.plugin.dmRatePerSec})`,
    );
  }
  if (cfg.plugin.dmWindowMs < 1) {
    throw new Error(
      `Config error: PLUGIN_DM_WINDOW_MS must be >= 1 (got ${cfg.plugin.dmWindowMs})`,
    );
  }

  // Fail-fast: validate CIDR syntax when TRUSTED_PROXY is enabled.
  if (cfg.web.trustedProxy) {
    for (const cidr of cfg.web.trustedProxyCidrs) {
      if (!isValidCidrSyntax(cidr)) {
        throw new Error(
          `Config error: TRUSTED_PROXY_CIDRS contains invalid CIDR "${cidr}"`,
        );
      }
    }
  }

  // production 額外強制檢查（對齊既有 main.ts / server.ts 的安全要求）
  if (env === "production") {
    if (cfg.bot.ownerIds.length === 0) {
      throw new Error(
        "Config error: BOT_OWNER_IDS (or BOT_OWNER_ID) must be set in production — refusing to start an unauthenticated admin API",
      );
    }
    if (!cfg.crypto.encryptionKey) {
      throw new Error("Config error: ENCRYPTION_KEY must be set in production");
    }
  }

  return Object.freeze(cfg) as AppConfig;
}

export const config: AppConfig = loadConfig();

/**
 * Compute the Fastify trustProxy value from the web config section and the
 * provided Cloudflare CIDR lists.
 *
 * Exported as a pure function so it can be unit-tested independently of
 * the config singleton and the Fastify server.
 *
 * Returns:
 *   false         — when trustedProxy is disabled (default)
 *   string[]      — the combined CIDR list when trustedProxy is enabled
 *
 * Throws if trustedProxy=true but the resulting CIDR list is empty.
 */
export function resolveTrustProxy(
  webCfg: AppConfig["web"],
  cloudflareCidrsV4: string[],
  cloudflareCidrsV6: string[],
): false | string[] {
  if (!webCfg.trustedProxy) return false;
  const cidrs = [
    ...webCfg.trustedProxyCidrs,
    ...(webCfg.trustCloudflare
      ? [...cloudflareCidrsV4, ...cloudflareCidrsV6]
      : []),
  ];
  if (cidrs.length === 0) {
    throw new Error(
      "Config error: TRUSTED_PROXY=true but TRUSTED_PROXY_CIDRS and TRUST_CLOUDFLARE are both empty — no trusted proxy defined",
    );
  }
  return cidrs;
}
