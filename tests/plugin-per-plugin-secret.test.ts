/**
 * Tests for per-plugin secret registration (A-3: global fallback removed).
 *
 * Coverage:
 *   1. register without per-plugin secret (no row/no hash) → 401
 *   2. register with plugin that has setup_secret_hash + correct cleartext → 200
 *   3. register with plugin that has setup_secret_hash + wrong secret → 401
 *   4. dispatch: plugin with dispatch_hmac_key → DB row has the key after registration
 *   5. plugin row without dispatch_hmac_key returns null
 *   6. admin POST /api/plugins/setup-secret → writes hash, returns cleartext
 *   7. admin POST /api/plugins/setup-secret → auto-creates placeholder row when key unknown
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

// ── 1. register without per-plugin secret (no row / no hash) → 401 ──────────

describe("1. register without pre-provisioned setup secret", () => {
  it("returns 401 with descriptive error when plugin has no row", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/api/plugins/register",
      headers: { "x-plugin-setup-secret": "any-secret" },
      payload: { manifest: makeManifest() },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toContain("no setup secret");
  });

  it("returns 401 when plugin row exists but setupSecretHash is null", async () => {
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
    // Row has no setupSecretHash — should be rejected.
    const res = await server.inject({
      method: "POST",
      url: "/api/plugins/register",
      headers: { "x-plugin-setup-secret": "any-secret" },
      payload: { manifest: makeManifest() },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toContain("no setup secret");
  });

  it("returns 401 when manifest plugin id is missing", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/api/plugins/register",
      headers: { "x-plugin-setup-secret": "any-secret" },
      payload: { manifest: { schema_version: "1" } },
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


// ── 4. Dispatch key selection ─────────────────────────────────────────────────

describe("4. dispatch_hmac_key selection", () => {
  it("plugin with dispatch_hmac_key: row has the key after registration", async () => {
    // Pre-provision the setup secret so registration succeeds.
    const pluginSecret = "dispatch-key-test-secret";
    await upsertPluginRegistration({
      pluginKey: "test-plugin",
      name: "Test Plugin",
      version: "1.0.0",
      url: "http://localhost:9999",
      manifestJson: JSON.stringify(makeManifest()),
      tokenHash: "init",
      approvedScopesJson: "[]",
      pendingScopesJson: null,
    });
    await server.inject({
      method: "POST",
      url: "/api/plugins/setup-secret",
      payload: { pluginKey: "test-plugin", secret: pluginSecret },
    });

    const res = await server.inject({
      method: "POST",
      url: "/api/plugins/register",
      headers: { "x-plugin-setup-secret": pluginSecret },
      payload: { manifest: makeManifest() },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { dispatchHmacKey: string };

    const row = await findPluginByKey("test-plugin");
    expect(row!.dispatchHmacKey).toBe(body.dispatchHmacKey);
  });

  it("placeholder row (no register) has null dispatch_hmac_key", async () => {
    // Insert a row manually without calling register() — simulates a
    // pre-provisioned-but-not-yet-registered plugin.
    const row = await upsertPluginRegistration({
      pluginKey: "placeholder-plugin",
      name: "Placeholder",
      version: "1.0.0",
      url: "http://localhost:9999",
      manifestJson: JSON.stringify(makeManifest("placeholder-plugin")),
      tokenHash: "placeholder-hash",
      approvedScopesJson: "[]",
      pendingScopesJson: null,
    });
    expect(row.dispatchHmacKey).toBeNull();
  });
});

// ── 5. Admin POST /api/plugins/setup-secret ──────────────────────────────────

describe("5. POST /api/plugins/setup-secret", () => {
  it("writes hash and returns cleartext for existing plugin row", async () => {
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
      created: boolean;
    };
    expect(body.pluginKey).toBe("secret-test-plugin");
    expect(body.setupSecret).toBe("my-custom-secret");
    expect(body.created).toBe(false);

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

  it("auto-creates placeholder row when pluginKey is unknown", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/api/plugins/setup-secret",
      payload: { pluginKey: "brand-new-plugin", secret: "new-plugin-secret" },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      pluginKey: string;
      setupSecret: string;
      created: boolean;
    };
    expect(body.created).toBe(true);
    expect(body.setupSecret).toBe("new-plugin-secret");

    const row = await findPluginByKey("brand-new-plugin");
    expect(row).not.toBeNull();
    expect(row!.setupSecretHash).toBe(hashSecret("new-plugin-secret"));
    expect(row!.enabled).toBe(false);
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

// ── 6. Re-register preserves dispatch_hmac_key ───────────────────────────────

describe("6. re-registration preserves dispatch_hmac_key", () => {
  it("same dispatch_hmac_key returned on re-register", async () => {
    const pluginSecret = "re-register-test-secret";

    // Pre-provision the setup secret via the endpoint (which also creates the row).
    await server.inject({
      method: "POST",
      url: "/api/plugins/setup-secret",
      payload: { pluginKey: "test-plugin", secret: pluginSecret },
    });

    const firstRes = await server.inject({
      method: "POST",
      url: "/api/plugins/register",
      headers: { "x-plugin-setup-secret": pluginSecret },
      payload: { manifest: makeManifest() },
    });
    expect(firstRes.statusCode).toBe(200);
    const firstBody = JSON.parse(firstRes.body) as { dispatchHmacKey: string };

    const secondRes = await server.inject({
      method: "POST",
      url: "/api/plugins/register",
      headers: { "x-plugin-setup-secret": pluginSecret },
      payload: { manifest: makeManifest() },
    });
    expect(secondRes.statusCode).toBe(200);
    const secondBody = JSON.parse(secondRes.body) as {
      dispatchHmacKey: string;
    };

    expect(secondBody.dispatchHmacKey).toBe(firstBody.dispatchHmacKey);
  });
});
