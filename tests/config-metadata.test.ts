import { describe, it, expect } from "vitest";
import type { AppConfig } from "../src/config.js";
import {
  CONFIG_METADATA,
  validateMetadataCoverage,
} from "../src/config-metadata.js";

// ---------------------------------------------------------------------------
// Minimal stub that mirrors the *shape* of AppConfig without requiring real
// env vars.  Must stay in sync with AppConfig whenever new fields are added
// (the validateMetadataCoverage test below will catch drift automatically).
// ---------------------------------------------------------------------------
const stubConfig: AppConfig = {
  env: "test",
  bot: { token: "tok", ownerId: null },
  web: {
    port: 3000,
    host: "0.0.0.0",
    baseUrl: null,
    sslCertPath: null,
    sslKeyPath: null,
    sslCaPath: null,
    trustedProxy: false,
    trustedProxyCidrs: [],
    trustCloudflare: false,
    deprecateGlobalPluginSecret: false,
  },
  db: { sqlitePath: null },
  crypto: { encryptionKey: null },
  jwt: {
    secret: null,
    loginLinkTtlMs: 300_000,
    accessTtlMs: 900_000,
    refreshTtlMs: 604_800_000,
    sseTicketTtlMs: 60_000,
    cleanupIntervalMs: 60_000,
  },
  plugin: {
    sharedSecret: null,
    tokenTtlMs: 3_600_000,
    heartbeatTimeoutMs: 75_000,
    reaperIntervalMs: 30_000,
    dispatchTimeoutMs: 5_000,
    commandDispatchTimeoutMs: 5_000,
    autocompleteTimeoutMs: 1_500,
    kvValueMaxBytes: 65_536,
    dmRatePerSec: 30,
    dmWindowMs: 1_000,
    autoApproveScopes: true,
  },
  behavior: { profileCacheTtlMs: 300_000 },
  admin: { profileCacheTtlMs: 300_000, sessionCacheTtlMs: 30_000 },
  rcon: {
    maxRetryAttempts: 3,
    maxQueueSize: 100,
    connectionTimeoutMs: 1_800_000,
    cleanupIntervalMs: 300_000,
  },
  botEvents: { dedupWindowMs: 60_000, dedupMaxKeys: 1_000 },
  dm: { maxFetchCount: 500, maxAttachmentBytes: 1_000_000 },
};

// ---------------------------------------------------------------------------

describe("validateMetadataCoverage", () => {
  it("passes with the complete stub config", () => {
    expect(() => validateMetadataCoverage(stubConfig)).not.toThrow();
  });

  it("throws when a leaf key is missing from CONFIG_METADATA", () => {
    // Temporarily remove one entry to simulate a developer adding a new
    // config field without updating metadata.
    const saved = CONFIG_METADATA["dm.maxFetchCount"];
    try {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete (CONFIG_METADATA as Record<string, unknown>)["dm.maxFetchCount"];
      expect(() => validateMetadataCoverage(stubConfig)).toThrow(
        'config metadata missing for "dm.maxFetchCount"',
      );
    } finally {
      // Restore so other tests in the suite are not affected.
      CONFIG_METADATA["dm.maxFetchCount"] = saved;
    }
  });

  it("throw message contains the missing path", () => {
    const saved = CONFIG_METADATA["rcon.maxQueueSize"];
    try {
      delete (CONFIG_METADATA as Record<string, unknown>)["rcon.maxQueueSize"];
      let thrown: Error | null = null;
      try {
        validateMetadataCoverage(stubConfig);
      } catch (e) {
        thrown = e as Error;
      }
      expect(thrown).not.toBeNull();
      expect(thrown?.message).toContain("rcon.maxQueueSize");
    } finally {
      CONFIG_METADATA["rcon.maxQueueSize"] = saved;
    }
  });
});

// ---------------------------------------------------------------------------

describe("sensitive field set", () => {
  it("sensitive fields are exactly the expected four keys", () => {
    const actualSensitive = new Set(
      Object.entries(CONFIG_METADATA)
        .filter(([, meta]) => meta.sensitivity === "sensitive")
        .map(([key]) => key),
    );
    const expected = new Set([
      "bot.token",
      "crypto.encryptionKey",
      "jwt.secret",
      "plugin.sharedSecret",
    ]);
    expect(actualSensitive).toEqual(expected);
  });
});
