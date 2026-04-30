/**
 * Explicit classification metadata for every leaf key in AppConfig.
 *
 * Purpose: the admin system-settings page reads this table to decide
 * whether to redact a value, and boot-time validation (`validateMetadataCoverage`)
 * ensures that any new env added to config.ts must also get an entry
 * here before the process starts (fail-closed).
 *
 * Rules:
 *   sensitivity  — how the value may be surfaced in the UI
 *   editability  — whether the value can be changed without a restart
 *   productionRequired — whether the process refuses to start in production
 *                        without this value being set
 */

import type { AppConfig } from "./config.js";

export type ConfigGroup =
  | "bot"
  | "web"
  | "db"
  | "crypto"
  | "jwt"
  | "plugin"
  | "behavior"
  | "admin"
  | "rcon"
  | "botEvents"
  | "dm";

export type Sensitivity = "sensitive" | "semi-sensitive" | "public";
export type Editability = "env-only" | "runtime-capable" | "runtime-editable";

export interface ConfigFieldMeta {
  group: ConfigGroup;
  envVar: string;
  sensitivity: Sensitivity;
  editability: Editability;
  productionRequired: boolean;
  /** i18n key used by the frontend to look up a human-readable description. */
  descriptionKey: string;
}

export const CONFIG_METADATA: Record<string, ConfigFieldMeta> = {
  env: {
    group: "bot",
    envVar: "NODE_ENV",
    sensitivity: "public",
    editability: "env-only",
    productionRequired: false,
    descriptionKey: "config.bot.env",
  },

  // ── bot ──────────────────────────────────────────────────────────────────
  "bot.token": {
    group: "bot",
    envVar: "BOT_TOKEN",
    sensitivity: "sensitive",
    editability: "env-only",
    productionRequired: true,
    descriptionKey: "config.bot.token",
  },
  "bot.ownerId": {
    group: "bot",
    envVar: "BOT_OWNER_ID",
    sensitivity: "semi-sensitive",
    editability: "env-only",
    productionRequired: true,
    descriptionKey: "config.bot.ownerId",
  },

  // ── web ──────────────────────────────────────────────────────────────────
  "web.port": {
    group: "web",
    envVar: "WEB_PORT",
    sensitivity: "public",
    editability: "env-only",
    productionRequired: false,
    descriptionKey: "config.web.port",
  },
  "web.host": {
    group: "web",
    envVar: "WEB_HOST",
    sensitivity: "public",
    editability: "env-only",
    productionRequired: false,
    descriptionKey: "config.web.host",
  },
  "web.baseUrl": {
    group: "web",
    envVar: "WEB_BASE_URL",
    sensitivity: "public",
    editability: "env-only",
    productionRequired: false,
    descriptionKey: "config.web.baseUrl",
  },
  "web.sslCertPath": {
    group: "web",
    envVar: "SSL_CERT_PATH",
    sensitivity: "public",
    editability: "env-only",
    productionRequired: false,
    descriptionKey: "config.web.sslCertPath",
  },
  "web.sslKeyPath": {
    group: "web",
    envVar: "SSL_KEY_PATH",
    sensitivity: "public",
    editability: "env-only",
    productionRequired: false,
    descriptionKey: "config.web.sslKeyPath",
  },
  "web.sslCaPath": {
    group: "web",
    envVar: "SSL_CA_PATH",
    sensitivity: "public",
    editability: "env-only",
    productionRequired: false,
    descriptionKey: "config.web.sslCaPath",
  },
  "web.trustedProxy": {
    group: "web",
    envVar: "TRUSTED_PROXY",
    sensitivity: "public",
    editability: "env-only",
    productionRequired: false,
    descriptionKey: "config.web.trustedProxy",
  },
  "web.trustedProxyCidrs": {
    group: "web",
    envVar: "TRUSTED_PROXY_CIDRS",
    sensitivity: "public",
    editability: "env-only",
    productionRequired: false,
    descriptionKey: "config.web.trustedProxyCidrs",
  },
  "web.trustCloudflare": {
    group: "web",
    envVar: "TRUST_CLOUDFLARE",
    sensitivity: "public",
    editability: "env-only",
    productionRequired: false,
    descriptionKey: "config.web.trustCloudflare",
  },

  // ── db ───────────────────────────────────────────────────────────────────
  "db.sqlitePath": {
    group: "db",
    envVar: "SQLITE_DB_PATH",
    sensitivity: "public",
    editability: "env-only",
    productionRequired: false,
    descriptionKey: "config.db.sqlitePath",
  },

  // ── crypto ───────────────────────────────────────────────────────────────
  "crypto.encryptionKey": {
    group: "crypto",
    envVar: "ENCRYPTION_KEY",
    sensitivity: "sensitive",
    editability: "env-only",
    productionRequired: true,
    descriptionKey: "config.crypto.encryptionKey",
  },

  // ── jwt ──────────────────────────────────────────────────────────────────
  // SEC report 5.1: jwt.secret should be productionRequired=true but
  // Tier 0 production guard is not yet implemented for this field.
  // TODO (issue 5.1): flip productionRequired to true once the guard is added.
  "jwt.secret": {
    group: "jwt",
    envVar: "JWT_SECRET",
    sensitivity: "sensitive",
    editability: "env-only",
    productionRequired: false,
    descriptionKey: "config.jwt.secret",
  },
  "jwt.loginLinkTtlMs": {
    group: "jwt",
    envVar: "JWT_LOGIN_LINK_TTL_MS",
    sensitivity: "public",
    editability: "runtime-capable",
    productionRequired: false,
    descriptionKey: "config.jwt.loginLinkTtlMs",
  },
  "jwt.accessTtlMs": {
    group: "jwt",
    envVar: "JWT_ACCESS_TTL_MS",
    sensitivity: "public",
    editability: "runtime-capable",
    productionRequired: false,
    descriptionKey: "config.jwt.accessTtlMs",
  },
  "jwt.refreshTtlMs": {
    group: "jwt",
    envVar: "JWT_REFRESH_TTL_MS",
    sensitivity: "public",
    editability: "runtime-capable",
    productionRequired: false,
    descriptionKey: "config.jwt.refreshTtlMs",
  },
  "jwt.sseTicketTtlMs": {
    group: "jwt",
    envVar: "JWT_SSE_TICKET_TTL_MS",
    sensitivity: "public",
    editability: "runtime-capable",
    productionRequired: false,
    descriptionKey: "config.jwt.sseTicketTtlMs",
  },
  "jwt.cleanupIntervalMs": {
    group: "jwt",
    envVar: "JWT_CLEANUP_INTERVAL_MS",
    sensitivity: "public",
    editability: "runtime-capable",
    productionRequired: false,
    descriptionKey: "config.jwt.cleanupIntervalMs",
  },

  // ── plugin ───────────────────────────────────────────────────────────────
  "plugin.sharedSecret": {
    group: "plugin",
    envVar: "KARYL_PLUGIN_SECRET",
    sensitivity: "sensitive",
    editability: "env-only",
    productionRequired: true,
    descriptionKey: "config.plugin.sharedSecret",
  },
  "plugin.tokenTtlMs": {
    group: "plugin",
    envVar: "PLUGIN_TOKEN_TTL_MS",
    sensitivity: "public",
    editability: "runtime-capable",
    productionRequired: false,
    descriptionKey: "config.plugin.tokenTtlMs",
  },
  "plugin.heartbeatTimeoutMs": {
    group: "plugin",
    envVar: "PLUGIN_HEARTBEAT_TIMEOUT_MS",
    sensitivity: "public",
    editability: "runtime-capable",
    productionRequired: false,
    descriptionKey: "config.plugin.heartbeatTimeoutMs",
  },
  "plugin.reaperIntervalMs": {
    group: "plugin",
    envVar: "PLUGIN_REAPER_INTERVAL_MS",
    sensitivity: "public",
    editability: "runtime-capable",
    productionRequired: false,
    descriptionKey: "config.plugin.reaperIntervalMs",
  },
  "plugin.dispatchTimeoutMs": {
    group: "plugin",
    envVar: "PLUGIN_DISPATCH_TIMEOUT_MS",
    sensitivity: "public",
    editability: "runtime-capable",
    productionRequired: false,
    descriptionKey: "config.plugin.dispatchTimeoutMs",
  },
  "plugin.commandDispatchTimeoutMs": {
    group: "plugin",
    envVar: "PLUGIN_COMMAND_DISPATCH_TIMEOUT_MS",
    sensitivity: "public",
    editability: "runtime-capable",
    productionRequired: false,
    descriptionKey: "config.plugin.commandDispatchTimeoutMs",
  },
  "plugin.autocompleteTimeoutMs": {
    group: "plugin",
    envVar: "PLUGIN_AUTOCOMPLETE_TIMEOUT_MS",
    sensitivity: "public",
    editability: "runtime-capable",
    productionRequired: false,
    descriptionKey: "config.plugin.autocompleteTimeoutMs",
  },
  "plugin.kvValueMaxBytes": {
    group: "plugin",
    envVar: "PLUGIN_KV_VALUE_MAX_BYTES",
    sensitivity: "public",
    editability: "runtime-capable",
    productionRequired: false,
    descriptionKey: "config.plugin.kvValueMaxBytes",
  },
  "plugin.dmRatePerSec": {
    group: "plugin",
    envVar: "PLUGIN_DM_PER_SEC",
    sensitivity: "public",
    editability: "env-only",
    productionRequired: false,
    descriptionKey: "config.plugin.dmRatePerSec",
  },
  "plugin.dmWindowMs": {
    group: "plugin",
    envVar: "PLUGIN_DM_WINDOW_MS",
    sensitivity: "public",
    editability: "env-only",
    productionRequired: false,
    descriptionKey: "config.plugin.dmWindowMs",
  },
  "plugin.autoApproveScopes": {
    group: "plugin",
    envVar: "PLUGIN_AUTO_APPROVE_SCOPES",
    sensitivity: "public",
    editability: "env-only",
    productionRequired: false,
    descriptionKey: "config.plugin.autoApproveScopes",
  },

  // ── behavior ─────────────────────────────────────────────────────────────
  "behavior.profileCacheTtlMs": {
    group: "behavior",
    envVar: "BEHAVIOR_PROFILE_CACHE_TTL_MS",
    sensitivity: "public",
    editability: "runtime-capable",
    productionRequired: false,
    descriptionKey: "config.behavior.profileCacheTtlMs",
  },

  // ── admin ─────────────────────────────────────────────────────────────────
  "admin.profileCacheTtlMs": {
    group: "admin",
    envVar: "ADMIN_PROFILE_CACHE_TTL_MS",
    sensitivity: "public",
    editability: "runtime-capable",
    productionRequired: false,
    descriptionKey: "config.admin.profileCacheTtlMs",
  },
  "admin.sessionCacheTtlMs": {
    group: "admin",
    envVar: "ADMIN_SESSION_CACHE_TTL_MS",
    sensitivity: "public",
    editability: "runtime-capable",
    productionRequired: false,
    descriptionKey: "config.admin.sessionCacheTtlMs",
  },

  // ── rcon ─────────────────────────────────────────────────────────────────
  "rcon.maxRetryAttempts": {
    group: "rcon",
    envVar: "RCON_MAX_RETRY_ATTEMPTS",
    sensitivity: "public",
    editability: "runtime-capable",
    productionRequired: false,
    descriptionKey: "config.rcon.maxRetryAttempts",
  },
  "rcon.maxQueueSize": {
    group: "rcon",
    envVar: "RCON_MAX_QUEUE_SIZE",
    sensitivity: "public",
    editability: "runtime-capable",
    productionRequired: false,
    descriptionKey: "config.rcon.maxQueueSize",
  },
  "rcon.connectionTimeoutMs": {
    group: "rcon",
    envVar: "RCON_CONNECTION_TIMEOUT_MS",
    sensitivity: "public",
    editability: "runtime-capable",
    productionRequired: false,
    descriptionKey: "config.rcon.connectionTimeoutMs",
  },
  "rcon.cleanupIntervalMs": {
    group: "rcon",
    envVar: "RCON_CLEANUP_INTERVAL_MS",
    sensitivity: "public",
    editability: "runtime-capable",
    productionRequired: false,
    descriptionKey: "config.rcon.cleanupIntervalMs",
  },

  // ── botEvents ─────────────────────────────────────────────────────────────
  "botEvents.dedupWindowMs": {
    group: "botEvents",
    envVar: "BOT_EVENTS_DEDUP_WINDOW_MS",
    sensitivity: "public",
    editability: "runtime-capable",
    productionRequired: false,
    descriptionKey: "config.botEvents.dedupWindowMs",
  },
  "botEvents.dedupMaxKeys": {
    group: "botEvents",
    envVar: "BOT_EVENTS_DEDUP_MAX_KEYS",
    sensitivity: "public",
    editability: "runtime-capable",
    productionRequired: false,
    descriptionKey: "config.botEvents.dedupMaxKeys",
  },

  // ── dm ────────────────────────────────────────────────────────────────────
  "dm.maxFetchCount": {
    group: "dm",
    envVar: "DM_MAX_FETCH_COUNT",
    sensitivity: "public",
    editability: "runtime-capable",
    productionRequired: false,
    descriptionKey: "config.dm.maxFetchCount",
  },
  "dm.maxAttachmentBytes": {
    group: "dm",
    envVar: "DM_MAX_ATTACHMENT_BYTES",
    sensitivity: "public",
    editability: "runtime-capable",
    productionRequired: false,
    descriptionKey: "config.dm.maxAttachmentBytes",
  },
};

// ── helpers ──────────────────────────────────────────────────────────────────

/**
 * Recursively walk an object and collect all dot-notation leaf paths.
 * Arrays are treated as leaf values (not recursed into).
 *
 * Example: { a: { b: 1 }, c: 2 } → ["a.b", "c"]
 */
function collectLeafPaths(obj: Record<string, unknown>, prefix = ""): string[] {
  const paths: string[] = [];
  for (const key of Object.keys(obj)) {
    const full = prefix ? `${prefix}.${key}` : key;
    const value = obj[key];
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      paths.push(...collectLeafPaths(value as Record<string, unknown>, full));
    } else {
      paths.push(full);
    }
  }
  return paths;
}

/**
 * Boot-time assertion: every leaf key in the live config object must
 * have an explicit entry in CONFIG_METADATA.
 *
 * Call this once at startup (before the process begins serving traffic)
 * so a missing classification causes a hard failure rather than a
 * silent data-exposure at runtime.
 */
export function validateMetadataCoverage(config: AppConfig): void {
  const expected = collectLeafPaths(
    config as unknown as Record<string, unknown>,
  );
  for (const path of expected) {
    if (!(path in CONFIG_METADATA)) {
      throw new Error(
        `config metadata missing for "${path}" — every config leaf must be classified`,
      );
    }
  }
}
