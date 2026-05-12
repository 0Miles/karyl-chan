/**
 * Tests for Change A (plugin proxy routes) and Change B (publicBaseUrl in
 * register + heartbeat responses).
 *
 * Coverage:
 *   A-1. GET /plugin/:pluginKey (no trailing slash) → 301 redirect to /plugin/:key/
 *   A-2. GET /plugin/does-not-exist/ → 404 { error: "unknown plugin" }
 *   A-3. GET /plugin/:key/ for an inactive plugin → 404 { error: "unknown plugin" }
 *   A-4. proxy route exists in the server (smoke: 502 from upstream error,
 *        NOT a Fastify "route not registered" 404)
 *        — NOTE: actual proxying to a live upstream is out of scope here; that
 *        is covered by the integration test against a running radio plugin.
 *   A-5. Invalid pluginKey format → 404 on redirect route
 *   A-6. Invalid pluginKey format → 404 on proxy route
 *   B-1. register response includes publicBaseUrl when WEB_BASE_URL is set
 *   B-2. register response omits publicBaseUrl when WEB_BASE_URL is null
 *   B-3. trailing slash in WEB_BASE_URL → single slash in result
 *   B-4. heartbeat response includes publicBaseUrl when WEB_BASE_URL is set
 *   B-5. heartbeat response omits publicBaseUrl when WEB_BASE_URL is null
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
import { sequelize } from "../src/db.js";
import { config } from "../src/config.js";
import {
  Plugin,
  upsertPluginRegistration,
  findPluginByKey,
} from "../src/modules/plugin-system/models/plugin.model.js";

function makeManifest(pluginKey = "test-plugin") {
  return {
    schema_version: "2",
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

// ── Server setup ─────────────────────────────────────────────────────────────

let server: import("fastify").FastifyInstance;

async function buildServer() {
  const fastify = (await import("fastify")).default;
  const { registerPluginRoutes } = await import(
    "../src/modules/plugin-system/plugin-routes.js"
  );
  const { registerPluginProxy } = await import(
    "../src/modules/plugin-system/plugin-proxy.js"
  );

  const s = fastify({ logger: false });

  // Register proxy BEFORE any helmet (mirrors server.ts order).
  await registerPluginProxy(s);

  // Inject synthetic admin auth on every request (mirrors tests in
  // plugin-per-plugin-secret.test.ts).
  s.addHook("onRequest", (req, _reply, done) => {
    (req as unknown as { authUserId: string }).authUserId = "admin-user";
    (req as unknown as { authCapabilities: Set<string> }).authCapabilities =
      new Set(["admin"]);
    done();
  });

  await registerPluginRoutes(s);
  await s.ready();
  return s;
}

beforeAll(async () => {
  await sequelize.sync({ force: true });
  server = await buildServer();
});

beforeEach(async () => {
  await Plugin.destroy({ where: {} });
});

afterEach(async () => {
  await Plugin.destroy({ where: {} });
  vi.restoreAllMocks();
});

afterAll(async () => {
  await server.close();
  await sequelize.close();
});

// ── Change A: proxy routes ────────────────────────────────────────────────────

describe("Change A: plugin proxy routes", () => {
  describe("A-1: redirect /plugin/:key (no trailing slash) → 301", () => {
    it("redirects to /plugin/:key/ with 301", async () => {
      const res = await server.inject({
        method: "GET",
        url: "/plugin/some-key",
      });
      expect(res.statusCode).toBe(301);
      expect(res.headers.location).toBe("/plugin/some-key/");
    });

    it("preserves query string on redirect", async () => {
      const res = await server.inject({
        method: "GET",
        url: "/plugin/some-key?tab=queue",
      });
      expect(res.statusCode).toBe(301);
      expect(res.headers.location).toBe("/plugin/some-key/?tab=queue");
    });
  });

  describe("A-2: 404 for unknown plugin key", () => {
    it("returns 404 with { error: 'unknown plugin' } when key not in DB", async () => {
      const res = await server.inject({
        method: "GET",
        url: "/plugin/does-not-exist/",
      });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: "unknown plugin" });
    });
  });

  describe("A-3: 404 for inactive plugin", () => {
    it("returns 404 for an existing but inactive plugin", async () => {
      // Upsert creates a row with status='active', so manually set inactive.
      await Plugin.create({
        pluginKey: "inactive-plugin",
        name: "Inactive",
        version: "1.0.0",
        url: "http://localhost:9998",
        manifestJson: "{}",
        tokenHash: "abc",
        status: "inactive",
        enabled: true,
        approvedScopesJson: "[]",
      });
      const res = await server.inject({
        method: "GET",
        url: "/plugin/inactive-plugin/",
      });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: "unknown plugin" });
    });

    it("proxies when the plugin is active even if enabled=false", async () => {
      // enabled=false must NOT block proxy access (enabled only gates
      // Discord command/event dispatch, not the plugin's HTTP surface).
      // When active, the proxy will attempt to connect to the upstream
      // and get ECONNREFUSED (no real server here) — that surfaces as a
      // 502 from @fastify/reply-from's onError handler, NOT a 404 from
      // the bot.
      await Plugin.create({
        pluginKey: "disabled-active-plugin",
        name: "Disabled but Active",
        version: "1.0.0",
        url: "http://localhost:19999",
        manifestJson: "{}",
        tokenHash: "def",
        status: "active",
        enabled: false,
        approvedScopesJson: "[]",
      });
      const res = await server.inject({
        method: "GET",
        url: "/plugin/disabled-active-plugin/",
      });
      // 404 would mean the bot didn't proxy. Any non-404 means the proxy
      // was attempted (upstream may be unreachable → 502 from onError).
      expect(res.statusCode).not.toBe(404);
    });
  });

  describe("A-5: invalid pluginKey format → 404 on redirect route", () => {
    it("returns 404 for a key with uppercase letters", async () => {
      const res = await server.inject({
        method: "GET",
        url: "/plugin/Bad_Key",
      });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: "unknown plugin" });
    });
  });

  describe("A-6: invalid pluginKey format → 404 on proxy route", () => {
    it("returns 404 for a key with uppercase letters on proxy route", async () => {
      const res = await server.inject({
        method: "GET",
        url: "/plugin/Bad_Key/foo",
      });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: "unknown plugin" });
    });
  });
});

// ── Change B: publicBaseUrl in register / heartbeat ──────────────────────────

describe("Change B: publicBaseUrl in register + heartbeat responses", () => {
  const SETUP_SECRET = "test-setup-secret-1234";

  async function provisionPlugin(pluginKey: string) {
    // Auto-create placeholder via admin endpoint (matches real flow).
    const setupRes = await server.inject({
      method: "POST",
      url: "/api/plugins/setup-secret",
      payload: { pluginKey, secret: SETUP_SECRET },
    });
    expect(setupRes.statusCode).toBe(200);
  }

  async function registerPlugin(pluginKey: string) {
    const res = await server.inject({
      method: "POST",
      url: "/api/plugins/register",
      headers: { "x-plugin-setup-secret": SETUP_SECRET },
      payload: { manifest: makeManifest(pluginKey) },
    });
    return res;
  }

  async function heartbeat(token: string) {
    return server.inject({
      method: "POST",
      url: "/api/plugins/heartbeat",
      headers: { authorization: `Bearer ${token}` },
    });
  }

  // Helper: temporarily set config.web.baseUrl for the duration of a callback.
  // config.web is not frozen (only the top-level config is), so mutation is safe.
  async function withBaseUrl<T>(
    baseUrl: string | null,
    fn: () => Promise<T>,
  ): Promise<T> {
    const original = config.web.baseUrl;
    (config.web as { baseUrl: string | null }).baseUrl = baseUrl;
    try {
      return await fn();
    } finally {
      (config.web as { baseUrl: string | null }).baseUrl = original;
    }
  }

  describe("B-1: publicBaseUrl present when WEB_BASE_URL is set", () => {
    it("register response includes publicBaseUrl", async () => {
      await provisionPlugin("test-pub-url");
      const res = await withBaseUrl("http://localhost:902", async () =>
        registerPlugin("test-pub-url"),
      );
      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        publicBaseUrl?: string;
        sessionVerifyPublicKey: string;
      };
      expect(typeof body.sessionVerifyPublicKey).toBe("string");
      expect(body.publicBaseUrl).toBe(
        "http://localhost:902/plugin/test-pub-url",
      );
    });
  });

  describe("B-2: publicBaseUrl absent when WEB_BASE_URL is null (default in test)", () => {
    it("register response does not include publicBaseUrl when baseUrl is null", async () => {
      await provisionPlugin("test-no-url");
      const res = await withBaseUrl(null, () => registerPlugin("test-no-url"));
      expect(res.statusCode).toBe(200);
      const body = res.json() as Record<string, unknown>;
      expect(body.publicBaseUrl).toBeUndefined();
    });

    it("heartbeat response does not include publicBaseUrl when baseUrl is null", async () => {
      await provisionPlugin("test-hb-no-url");
      const regRes = await withBaseUrl("http://localhost:902", () =>
        registerPlugin("test-hb-no-url"),
      );
      expect(regRes.statusCode).toBe(200);
      const { token } = regRes.json() as { token: string };

      const hbRes = await withBaseUrl(null, () => heartbeat(token));
      expect(hbRes.statusCode).toBe(200);
      const body = hbRes.json() as Record<string, unknown>;
      expect(body.publicBaseUrl).toBeUndefined();
    });
  });

  describe("B-3: trailing slash in WEB_BASE_URL → single slash in result", () => {
    it("strips trailing slash from WEB_BASE_URL before constructing publicBaseUrl", async () => {
      await provisionPlugin("trail-slash-plugin");
      const res = await withBaseUrl("http://localhost:902/", () =>
        registerPlugin("trail-slash-plugin"),
      );
      expect(res.statusCode).toBe(200);
      const body = res.json() as { publicBaseUrl?: string };
      expect(body.publicBaseUrl).toBe(
        "http://localhost:902/plugin/trail-slash-plugin",
      );
      expect(body.publicBaseUrl).not.toContain("//plugin/");
    });
  });

  describe("B-4: heartbeat response includes publicBaseUrl when WEB_BASE_URL is set", () => {
    it("heartbeat echoes publicBaseUrl", async () => {
      await provisionPlugin("test-hb-url");
      const regRes = await withBaseUrl("http://localhost:902", () =>
        registerPlugin("test-hb-url"),
      );
      expect(regRes.statusCode).toBe(200);
      const { token } = regRes.json() as { token: string };

      const hbRes = await withBaseUrl("http://localhost:902", () =>
        heartbeat(token),
      );
      expect(hbRes.statusCode).toBe(200);
      const body = hbRes.json() as {
        ok: boolean;
        publicBaseUrl?: string;
        sessionVerifyPublicKey: string;
      };
      expect(hbBody(body).ok).toBe(true);
      expect(typeof body.sessionVerifyPublicKey).toBe("string");
      expect(body.publicBaseUrl).toBe(
        "http://localhost:902/plugin/test-hb-url",
      );
    });

    function hbBody(b: {
      ok: boolean;
      publicBaseUrl?: string;
      sessionVerifyPublicKey: string;
    }) {
      return b;
    }
  });
});
