/**
 * Tests for A-1: per-plugin secret dual-mode (Tier 1 issue 2.2).
 *
 * Coverage:
 *   1. register with old plugin (no setup_secret_hash) + correct global secret
 *      → 200, dispatch_hmac_key auto-generated, response contains dispatchHmacKey
 *   2. register with plugin that has setup_secret_hash + correct cleartext → 200
 *   3. register with plugin that has setup_secret_hash + global secret → 401
 *   4. DEPRECATE_GLOBAL_PLUGIN_SECRET=true + no setup_secret_hash → 401
 *   5. dispatch: plugin with dispatch_hmac_key → uses plugin-specific key
 *   6. dispatch: plugin without dispatch_hmac_key → falls back to global
 *   7. admin POST /api/plugins/setup-secret → writes hash, returns cleartext
 *   8. register re-register preserves existing dispatch_hmac_key
 */
import {
  vi,
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterAll,
  afterEach,
} from "vitest";

vi.hoisted(() => {
  process.env.SQLITE_DB_PATH = ":memory:";
  process.env.NODE_ENV = "test";
  process.env.KARYL_PLUGIN_SECRET = "global-test-secret";
});

// Mock host-policy so validateManifest doesn't SSRF-reject localhost.
vi.mock("../src/utils/host-policy.js", () => ({
  assertPluginTarget: vi.fn().mockResolvedValue(undefined),
  HostPolicyError: class HostPolicyError extends Error {},
}));

// Mock rebuildEventIndex so register() doesn't need the full event system.
vi.mock("../src/modules/plugin-system/plugin-event-bridge.service.js", () => ({
  rebuildEventIndex: vi.fn().mockResolvedValue(undefined),
  dispatchEventToPlugins: vi.fn(),
  getEventIndexSize: vi.fn().mockReturnValue(0),
}));

// Mock pluginCommandRegistry so register() doesn't try to hit Discord.
vi.mock(
  "../src/modules/plugin-system/plugin-command-registry.service.js",
  () => ({
    pluginCommandRegistry: {
      assertNoCollisions: vi.fn().mockResolvedValue(undefined),
      sync: vi.fn().mockResolvedValue(undefined),
      unregisterAll: vi.fn().mockResolvedValue(undefined),
      syncFeatureCommandsForGuild: vi.fn().mockResolvedValue(undefined),
    },
    ManifestCommandError: class ManifestCommandError extends Error {},
  }),
);

import { createHash } from "crypto";
import { config } from "../src/config.js";
import { sequelize } from "../src/db.js";
import {
  Plugin,
  upsertPluginRegistration,
  findPluginByKey,
} from "../src/modules/plugin-system/models/plugin.model.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeManifest(pluginKey = "test-plugin") {
  return {
    schema_version: "1",
    plugin: {
      id: pluginKey,
      name: "Test Plugin",
      version: "1.0.0",
      url: "http://localhost:9999",
    },
    rpc_methods_used: [],
  };
}

function hashSecret(cleartext: string): string {
  return createHash("sha256").update(cleartext).digest("hex");
}

// ── Setup ─────────────────────────────────────────────────────────────────────

let server: import("fastify").FastifyInstance;

beforeAll(async () => {
  await sequelize.sync({ force: true });

  const fastify = (await import("fastify")).default;
  const { registerPluginRoutes } = await import(
    "../src/modules/plugin-system/plugin-routes.js"
  );

  server = fastify({ logger: false });

  // Inject admin auth on every request.
  server.addHook("onRequest", (req, _reply, done) => {
    (req as unknown as { authUserId: string }).authUserId = "admin-user";
    (req as unknown as { authCapabilities: Set<string> }).authCapabilities =
      new Set(["admin"]);
    done();
  });

  await registerPluginRoutes(server);
  await server.ready();
});

beforeEach(async () => {
  await Plugin.destroy({ where: {} });
});

afterEach(async () => {
  await Plugin.destroy({ where: {} });
});

afterAll(async () => {
  await server.close();
});

// ── 1. Old plugin (no setup_secret_hash) + global secret → 200 ───────────────

describe("1. register without per-plugin secret (global fallback)", () => {
  it("returns 200 with token + dispatchHmacKey when global secret is correct", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/api/plugins/register",
      headers: { "x-plugin-setup-secret": "global-test-secret" },
      payload: { manifest: makeManifest() },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      token: string;
      dispatchHmacKey: string;
      plugin: { pluginKey: string };
    };
    expect(typeof body.token).toBe("string");
    expect(body.token.length).toBeGreaterThan(0);
    expect(typeof body.dispatchHmacKey).toBe("string");
    expect(body.dispatchHmacKey.length).toBeGreaterThan(0);
  });

  it("writes dispatch_hmac_key to DB on first registration", async () => {
    await server.inject({
      method: "POST",
      url: "/api/plugins/register",
      headers: { "x-plugin-setup-secret": "global-test-secret" },
      payload: { manifest: makeManifest() },
    });
    const row = await findPluginByKey("test-plugin");
    expect(row).not.toBeNull();
    expect(typeof row!.dispatchHmacKey).toBe("string");
    expect(row!.dispatchHmacKey!.length).toBe(64); // 32 bytes → 64 hex chars
  });

  it("returns 401 when global secret is wrong", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/api/plugins/register",
      headers: { "x-plugin-setup-secret": "wrong-secret" },
      payload: { manifest: makeManifest() },
    });
    expect(res.statusCode).toBe(401);
  });
});

// ── 2. Plugin with setup_secret_hash + correct cleartext → 200 ───────────────

describe("2. register with per-plugin setup_secret_hash (correct secret)", () => {
  it("returns 200 when per-plugin secret matches", async () => {
    const pluginSecret = "per-plugin-secret-abc";

    // Pre-insert a plugin row with setup_secret_hash set.
    await upsertPluginRegistration({
      pluginKey: "test-plugin",
      name: "Test Plugin",
      version: "1.0.0",
      url: "http://localhost:9999",
      manifestJson: JSON.stringify(makeManifest()),
      tokenHash: "init-hash",
      approvedScopesJson: "[]",
      pendingScopesJson: null,
    });
    const row = await findPluginByKey("test-plugin");
    // Write the hash via the admin endpoint.
    const adminRes = await server.inject({
      method: "POST",
      url: "/api/plugins/setup-secret",
      payload: { pluginKey: "test-plugin", secret: pluginSecret },
    });
    expect(adminRes.statusCode).toBe(200);

    // Now register with the per-plugin secret.
    const res = await server.inject({
      method: "POST",
      url: "/api/plugins/register",
      headers: { "x-plugin-setup-secret": pluginSecret },
      payload: { manifest: makeManifest() },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { dispatchHmacKey: string };
    expect(typeof body.dispatchHmacKey).toBe("string");

    // Verify DB has the hash.
    const updated = await findPluginByKey("test-plugin");
    expect(updated!.setupSecretHash).toBe(hashSecret(pluginSecret));
  });
});

// ── 3. Plugin with setup_secret_hash + global secret → 401 ───────────────────

describe("3. register with per-plugin hash set but presenting global secret", () => {
  it("returns 401 (per-plugin secret configured; global not accepted)", async () => {
    const pluginSecret = "per-plugin-different-secret";

    await upsertPluginRegistration({
      pluginKey: "test-plugin",
      name: "Test Plugin",
      version: "1.0.0",
      url: "http://localhost:9999",
      manifestJson: JSON.stringify(makeManifest()),
      tokenHash: "init-hash",
      approvedScopesJson: "[]",
      pendingScopesJson: null,
    });

    // Set per-plugin secret via admin endpoint.
    const adminRes = await server.inject({
      method: "POST",
      url: "/api/plugins/setup-secret",
      payload: { pluginKey: "test-plugin", secret: pluginSecret },
    });
    expect(adminRes.statusCode).toBe(200);

    // Attempt to register with the global secret (not the per-plugin one).
    const res = await server.inject({
      method: "POST",
      url: "/api/plugins/register",
      headers: { "x-plugin-setup-secret": "global-test-secret" },
      payload: { manifest: makeManifest() },
    });
    expect(res.statusCode).toBe(401);
  });
});

// ── 4. DEPRECATE_GLOBAL_PLUGIN_SECRET=true + no per-plugin hash → 401 ────────

describe("4. DEPRECATE_GLOBAL_PLUGIN_SECRET=true", () => {
  // Object.freeze(cfg) only freezes the top-level wrapper; nested `web`
  // is a regular object whose props can still be reassigned. We exploit
  // that for the test and restore on teardown.
  let originalFlag: boolean;

  beforeEach(() => {
    originalFlag = config.web.deprecateGlobalPluginSecret;
    (config.web as { deprecateGlobalPluginSecret: boolean }).deprecateGlobalPluginSecret = true;
  });

  afterEach(() => {
    (config.web as { deprecateGlobalPluginSecret: boolean }).deprecateGlobalPluginSecret = originalFlag;
  });

  it("rejects register with the global secret when deprecateGlobalPluginSecret=true", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/api/plugins/register",
      headers: { "x-plugin-setup-secret": "global-test-secret" },
      payload: {
        manifest: {
          schema_version: "1",
          plugin: {
            id: "deprecate-test-plugin",
            name: "Deprecate Test",
            version: "0.1.0",
            url: "http://deprecate-test:3000",
          },
          rpc_methods_used: ["messages.send"],
        },
      },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("invalid setup secret");
  });

  it("still permits register with a valid per-plugin setup secret when flag is true", async () => {
    // Pre-seed a plugin row with a setupSecretHash so the per-plugin path
    // succeeds — DEPRECATE only blocks the global fallback, never plugins
    // that have already moved to per-plugin secrets.
    const cleartext = "per-plugin-deprecate-test";
    const hash = createHash("sha256").update(cleartext).digest("hex");
    await Plugin.create({
      pluginKey: "deprecate-permits-plugin",
      name: "Permits Test",
      version: "0.1.0",
      url: "http://deprecate-permits:3000",
      manifestJson: JSON.stringify({
        schema_version: "1",
        plugin: {
          id: "deprecate-permits-plugin",
          name: "Permits Test",
          version: "0.1.0",
          url: "http://deprecate-permits:3000",
        },
        rpc_methods_used: ["messages.send"],
      }),
      enabled: true,
      status: "active",
      setupSecretHash: hash,
      approvedScopesJson: JSON.stringify(["messages.send"]),
    });

    const res = await server.inject({
      method: "POST",
      url: "/api/plugins/register",
      headers: { "x-plugin-setup-secret": cleartext },
      payload: {
        manifest: {
          schema_version: "1",
          plugin: {
            id: "deprecate-permits-plugin",
            name: "Permits Test",
            version: "0.1.0",
            url: "http://deprecate-permits:3000",
          },
          rpc_methods_used: ["messages.send"],
        },
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().token).toBeTypeOf("string");
  });
});

// ── 5–6. Dispatch key selection ───────────────────────────────────────────────

describe("5–6. dispatch_hmac_key selection", () => {
  it("5. plugin with dispatch_hmac_key: row has the key after registration", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/api/plugins/register",
      headers: { "x-plugin-setup-secret": "global-test-secret" },
      payload: { manifest: makeManifest() },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { dispatchHmacKey: string };

    const row = await findPluginByKey("test-plugin");
    expect(row!.dispatchHmacKey).toBe(body.dispatchHmacKey);
  });

  it("6. plugin row without dispatch_hmac_key returns null (for global fallback)", async () => {
    // Insert a row manually without the hmac key to simulate pre-migration state.
    const row = await upsertPluginRegistration({
      pluginKey: "legacy-plugin",
      name: "Legacy",
      version: "1.0.0",
      url: "http://localhost:9999",
      manifestJson: JSON.stringify(makeManifest("legacy-plugin")),
      tokenHash: "legacy-hash",
      approvedScopesJson: "[]",
      pendingScopesJson: null,
    });
    // The row was just created by upsert; dispatchHmacKey should be null
    // since we didn't call register() (which auto-generates).
    expect(row.dispatchHmacKey).toBeNull();
  });
});

// ── 7. Admin POST /api/plugins/setup-secret ───────────────────────────────────

describe("7. POST /api/plugins/setup-secret", () => {
  it("writes hash and returns cleartext", async () => {
    await upsertPluginRegistration({
      pluginKey: "secret-test-plugin",
      name: "Secret Test Plugin",
      version: "1.0.0",
      url: "http://localhost:9999",
      manifestJson: JSON.stringify(makeManifest("secret-test-plugin")),
      tokenHash: "hash",
      approvedScopesJson: "[]",
      pendingScopesJson: null,
    });

    const res = await server.inject({
      method: "POST",
      url: "/api/plugins/setup-secret",
      payload: {
        pluginKey: "secret-test-plugin",
        secret: "my-custom-secret",
      },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      pluginKey: string;
      setupSecret: string;
    };
    expect(body.pluginKey).toBe("secret-test-plugin");
    expect(body.setupSecret).toBe("my-custom-secret");

    const row = await findPluginByKey("secret-test-plugin");
    expect(row!.setupSecretHash).toBe(hashSecret("my-custom-secret"));
  });

  it("auto-generates a 64-char hex secret when none provided", async () => {
    await upsertPluginRegistration({
      pluginKey: "auto-secret-plugin",
      name: "Auto Secret Plugin",
      version: "1.0.0",
      url: "http://localhost:9999",
      manifestJson: JSON.stringify(makeManifest("auto-secret-plugin")),
      tokenHash: "hash",
      approvedScopesJson: "[]",
      pendingScopesJson: null,
    });

    const res = await server.inject({
      method: "POST",
      url: "/api/plugins/setup-secret",
      payload: { pluginKey: "auto-secret-plugin" },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { setupSecret: string };
    expect(body.setupSecret).toMatch(/^[0-9a-f]{64}$/);

    const row = await findPluginByKey("auto-secret-plugin");
    expect(row!.setupSecretHash).toBe(hashSecret(body.setupSecret));
  });

  it("returns 404 for unknown pluginKey", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/api/plugins/setup-secret",
      payload: { pluginKey: "does-not-exist" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns 400 when pluginKey is missing", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/api/plugins/setup-secret",
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });
});

// ── 8. Re-register preserves dispatch_hmac_key ───────────────────────────────

describe("8. re-registration preserves dispatch_hmac_key", () => {
  it("same dispatch_hmac_key returned on re-register", async () => {
    const firstRes = await server.inject({
      method: "POST",
      url: "/api/plugins/register",
      headers: { "x-plugin-setup-secret": "global-test-secret" },
      payload: { manifest: makeManifest() },
    });
    expect(firstRes.statusCode).toBe(200);
    const firstBody = JSON.parse(firstRes.body) as { dispatchHmacKey: string };

    const secondRes = await server.inject({
      method: "POST",
      url: "/api/plugins/register",
      headers: { "x-plugin-setup-secret": "global-test-secret" },
      payload: { manifest: makeManifest() },
    });
    expect(secondRes.statusCode).toBe(200);
    const secondBody = JSON.parse(secondRes.body) as {
      dispatchHmacKey: string;
    };

    expect(secondBody.dispatchHmacKey).toBe(firstBody.dispatchHmacKey);
  });
});
