/**
 * Unit tests for the per-plugin DM rate limit in
 * POST /api/plugin/messages.send_dm (issue 7.3).
 *
 * Strategy: inject a fake dmLimiter via PluginRpcOptions so the tests
 * control exactly when the limit triggers, without depending on real
 * time or the RateLimiter implementation internals.
 *
 * For the window-reset test we use a real RateLimiter with vi.useFakeTimers
 * to fast-forward time.
 *
 * Each test injects requests with a unique remoteAddress so the server's
 * global write-throttle (30 POSTs / 60 s per IP) does not bleed across
 * tests and produce false 429s from the wrong limiter.
 */

import { vi, describe, it, expect, afterEach } from "vitest";

vi.hoisted(() => {
  process.env.SQLITE_DB_PATH = ":memory:";
});

// ── module-level mocks ───────────────────────────────────────────────────────

vi.mock("../src/modules/plugin-system/models/plugin.model.js", () => ({
  findPluginById: vi.fn(),
}));

vi.mock(
  "../src/modules/feature-toggle/models/plugin-guild-feature.model.js",
  () => ({
    findEnabledFeaturesByPluginGuild: vi.fn(),
    findFeatureRow: vi.fn(),
    findFeatureRowsByGuild: vi.fn(),
    findFeatureRowsByPlugin: vi.fn(),
    upsertFeatureRow: vi.fn(),
    updateMetricsJson: vi.fn(),
    PluginGuildFeature: { destroy: vi.fn(), findAll: vi.fn() },
  }),
);

vi.mock("../src/modules/bot-events/bot-event-log.js", () => ({
  botEventLog: { record: vi.fn() },
  setBotEventLogMetric: vi.fn(),
}));

vi.mock("../src/modules/bot-events/bot-event-dedup.js", () => ({
  shouldRecord: vi.fn(() => true),
}));

// ── imports after mocks ──────────────────────────────────────────────────────

import type { FastifyInstance } from "fastify";
import { createWebServer } from "../src/modules/web-core/server.js";
import { pluginAuthStore } from "../src/modules/plugin-system/plugin-auth.service.js";
import { findPluginById } from "../src/modules/plugin-system/models/plugin.model.js";
import { botEventLog } from "../src/modules/bot-events/bot-event-log.js";
import { shouldRecord } from "../src/modules/bot-events/bot-event-dedup.js";
import { RateLimiter } from "../src/utils/rate-limiter.js";

// ── helpers ──────────────────────────────────────────────────────────────────

const PLUGIN_A_ID = 10;
const PLUGIN_A_KEY = "plugin-alpha";
const PLUGIN_B_ID = 20;
const PLUGIN_B_KEY = "plugin-beta";
const USER_ID = "user-123";

/** Each test uses a unique fake IP to avoid the server's global write-throttle
 *  (max 30 POSTs / 60 s per IP) interfering across tests. */
let ipCounter = 1;
function nextFakeIp(): string {
  return `10.0.${Math.floor(ipCounter / 256)}.${ipCounter++ % 256}`;
}

function stubPluginAuth(pluginId = PLUGIN_A_ID, pluginKey = PLUGIN_A_KEY) {
  vi.spyOn(pluginAuthStore, "verify").mockReturnValue({
    pluginId,
    pluginKey,
    scopes: new Set(["messages.send_dm"]),
    expiresAt: Date.now() + 60_000,
  });
}

function stubActivePlugin(pluginId = PLUGIN_A_ID, pluginKey = PLUGIN_A_KEY) {
  (findPluginById as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: pluginId,
    pluginKey,
    enabled: true,
    status: "active",
    manifestJson: "{}",
  });
}

/** Fake Discord user whose send() succeeds. */
function fakeUser(userId = USER_ID) {
  const send = vi
    .fn()
    .mockResolvedValue({ id: "dm-msg-1", channelId: `dm-${userId}` });
  return { id: userId, send, _send: send };
}

/** Fake bot that resolves the given user on users.fetch(). */
function fakeBot(user: ReturnType<typeof fakeUser>) {
  return {
    user: { id: "bot-1" },
    isReady: () => true,
    guilds: { cache: { size: 0 } },
    uptime: 0,
    users: {
      fetch: vi.fn().mockResolvedValue(user),
    },
  };
}

/**
 * A simple counting limiter: allows the first `allowCount` calls per key,
 * then blocks.  Each key has an independent counter so multi-plugin tests
 * work naturally.
 */
function makeCountingLimiter(allowCount: number) {
  const counts = new Map<string, number>();
  return {
    isRateLimited(key: string): boolean {
      const n = counts.get(key) ?? 0;
      if (n >= allowCount) return true;
      counts.set(key, n + 1);
      return false;
    },
  };
}

// ── tests ────────────────────────────────────────────────────────────────────

describe("messages.send_dm — per-plugin DM rate limit", () => {
  let server: FastifyInstance;

  afterEach(async () => {
    if (server) await server.close();
  });

  // ── 1. requests within the limit succeed ──────────────────────────────────

  it("allows the first 30 DMs (within limit)", async () => {
    vi.clearAllMocks();
    (shouldRecord as ReturnType<typeof vi.fn>).mockReturnValue(true);

    const ip = nextFakeIp();
    const user = fakeUser();
    server = await createWebServer({
      staticRoot: undefined,
      bot: fakeBot(user) as never,
      dmLimiter: makeCountingLimiter(30),
    });
    await server.ready();

    for (let i = 0; i < 30; i++) {
      stubPluginAuth();
      stubActivePlugin();
      const res = await server.inject({
        method: "POST",
        url: "/api/plugin/messages.send_dm",
        headers: { authorization: "Bearer fake-token" },
        remoteAddress: ip,
        payload: { user_id: USER_ID, content: "hello" },
      });
      expect(res.statusCode, `request ${i + 1} should be 200`).toBe(200);
      expect(res.json()).toMatchObject({ id: "dm-msg-1" });
    }

    expect(user._send).toHaveBeenCalledTimes(30);
  });

  // ── 2. the 31st request is blocked ───────────────────────────────────────

  it("returns 429 + Retry-After on the 31st DM", async () => {
    vi.clearAllMocks();
    (shouldRecord as ReturnType<typeof vi.fn>).mockReturnValue(true);

    const user = fakeUser();
    server = await createWebServer({
      staticRoot: undefined,
      bot: fakeBot(user) as never,
      dmLimiter: makeCountingLimiter(30),
    });
    await server.ready();

    // Burn 30 allowed dmLimiter slots.  Use a fresh IP per request so the
    // server-level write-throttle (max 30 POSTs / 60 s per IP) is never
    // triggered — each request comes from a brand-new IP with count=0.
    for (let i = 0; i < 30; i++) {
      stubPluginAuth();
      stubActivePlugin();
      await server.inject({
        method: "POST",
        url: "/api/plugin/messages.send_dm",
        headers: { authorization: "Bearer fake-token" },
        remoteAddress: nextFakeIp(),
        payload: { user_id: USER_ID, content: "hello" },
      });
    }

    // 31st uses yet another fresh IP so write-throttle still won't fire,
    // but the dmLimiter's counter (keyed by pluginId, not IP) is already
    // at 30 → should be blocked by our per-plugin limit.
    stubPluginAuth();
    stubActivePlugin();
    const res = await server.inject({
      method: "POST",
      url: "/api/plugin/messages.send_dm",
      headers: { authorization: "Bearer fake-token" },
      remoteAddress: nextFakeIp(),
      payload: { user_id: USER_ID, content: "hello" },
    });

    expect(res.statusCode).toBe(429);
    expect(res.headers["retry-after"]).toBe("1");
    expect(res.json()).toEqual({ error: "rate limited" });
    // user.send must NOT have been called on the blocked request
    expect(user._send).toHaveBeenCalledTimes(30);
  });

  // ── 3. different plugins have independent counters ────────────────────────

  it("tracks plugin A and plugin B independently", async () => {
    vi.clearAllMocks();
    (shouldRecord as ReturnType<typeof vi.fn>).mockReturnValue(true);

    const userA = fakeUser("user-a");
    const userB = fakeUser("user-b");
    // limit=1: each plugin gets exactly one allowed DM
    const limiter = makeCountingLimiter(1);
    const ip = nextFakeIp();

    server = await createWebServer({
      staticRoot: undefined,
      bot: {
        user: { id: "bot-1" },
        isReady: () => true,
        guilds: { cache: { size: 0 } },
        uptime: 0,
        users: {
          fetch: vi
            .fn()
            .mockImplementation((uid: string) =>
              uid === "user-a"
                ? Promise.resolve(userA)
                : Promise.resolve(userB),
            ),
        },
      } as never,
      dmLimiter: limiter,
    });
    await server.ready();

    // Plugin A: 1st request → allowed (key=plugin:10:send_dm, n=0)
    stubPluginAuth(PLUGIN_A_ID, PLUGIN_A_KEY);
    stubActivePlugin(PLUGIN_A_ID, PLUGIN_A_KEY);
    const resA1 = await server.inject({
      method: "POST",
      url: "/api/plugin/messages.send_dm",
      headers: { authorization: "Bearer fake-token" },
      remoteAddress: ip,
      payload: { user_id: "user-a", content: "hello from A" },
    });
    expect(resA1.statusCode).toBe(200);

    // Plugin B: 1st request → also allowed (key=plugin:20:send_dm, n=0 — independent)
    stubPluginAuth(PLUGIN_B_ID, PLUGIN_B_KEY);
    stubActivePlugin(PLUGIN_B_ID, PLUGIN_B_KEY);
    const resB1 = await server.inject({
      method: "POST",
      url: "/api/plugin/messages.send_dm",
      headers: { authorization: "Bearer fake-token" },
      remoteAddress: ip,
      payload: { user_id: "user-b", content: "hello from B" },
    });
    expect(resB1.statusCode).toBe(200);

    // Plugin A: 2nd request → blocked (n=1 >= allowCount=1)
    stubPluginAuth(PLUGIN_A_ID, PLUGIN_A_KEY);
    stubActivePlugin(PLUGIN_A_ID, PLUGIN_A_KEY);
    const resA2 = await server.inject({
      method: "POST",
      url: "/api/plugin/messages.send_dm",
      headers: { authorization: "Bearer fake-token" },
      remoteAddress: ip,
      payload: { user_id: "user-a", content: "hello from A again" },
    });
    expect(resA2.statusCode).toBe(429);

    // Plugin B: 2nd request → also blocked (its own independent counter)
    stubPluginAuth(PLUGIN_B_ID, PLUGIN_B_KEY);
    stubActivePlugin(PLUGIN_B_ID, PLUGIN_B_KEY);
    const resB2 = await server.inject({
      method: "POST",
      url: "/api/plugin/messages.send_dm",
      headers: { authorization: "Bearer fake-token" },
      remoteAddress: ip,
      payload: { user_id: "user-b", content: "hello from B again" },
    });
    expect(resB2.statusCode).toBe(429);
  });

  // ── 4. window expiry resets the bucket ───────────────────────────────────

  it("allows DMs again after the window expires (real RateLimiter + fake timers)", async () => {
    vi.clearAllMocks();
    (shouldRecord as ReturnType<typeof vi.fn>).mockReturnValue(true);

    const ip = nextFakeIp();
    const user = fakeUser();
    // limit=1 per 1000ms window via real RateLimiter
    const realLimiter = new RateLimiter({ max: 1, windowMs: 1_000 });

    // Build the server with real timers so Fastify's async setup completes.
    server = await createWebServer({
      staticRoot: undefined,
      bot: fakeBot(user) as never,
      dmLimiter: realLimiter,
    });
    await server.ready();

    // Switch to fake timers AFTER the server is ready so Fastify's own
    // internal timeouts (keep-alive, etc.) do not hang under fake time.
    vi.useFakeTimers({ toFake: ["Date"] });

    try {
      // First DM: allowed (n=0 < max=1)
      stubPluginAuth();
      stubActivePlugin();
      const res1 = await server.inject({
        method: "POST",
        url: "/api/plugin/messages.send_dm",
        headers: { authorization: "Bearer fake-token" },
        remoteAddress: ip,
        payload: { user_id: USER_ID, content: "first" },
      });
      expect(res1.statusCode).toBe(200);

      // Second DM: blocked (n=1 >= max=1, window not yet expired)
      stubPluginAuth();
      stubActivePlugin();
      const res2 = await server.inject({
        method: "POST",
        url: "/api/plugin/messages.send_dm",
        headers: { authorization: "Bearer fake-token" },
        remoteAddress: ip,
        payload: { user_id: USER_ID, content: "second" },
      });
      expect(res2.statusCode).toBe(429);

      // Fast-forward past the 1000ms window (only Date is faked, which
      // is all RateLimiter uses — it calls Date.now() internally).
      vi.advanceTimersByTime(1_001);

      // Third DM: allowed again (all timestamps in the window have expired)
      stubPluginAuth();
      stubActivePlugin();
      const res3 = await server.inject({
        method: "POST",
        url: "/api/plugin/messages.send_dm",
        headers: { authorization: "Bearer fake-token" },
        remoteAddress: ip,
        payload: { user_id: USER_ID, content: "third" },
      });
      expect(res3.statusCode).toBe(200);
    } finally {
      vi.useRealTimers();
    }
  });

  // ── 5. warn log is emitted on rate limit (with dedup) ────────────────────

  it("emits a warn log on rate limit, deduped by shouldRecord", async () => {
    vi.clearAllMocks();
    // Restore default implementation after clearAllMocks
    (shouldRecord as ReturnType<typeof vi.fn>).mockReturnValue(true);

    const ip = nextFakeIp();
    const user = fakeUser();
    server = await createWebServer({
      staticRoot: undefined,
      bot: fakeBot(user) as never,
      dmLimiter: makeCountingLimiter(0), // block immediately
    });
    await server.ready();

    const dedupKey = `plugin-rpc-dm-rate:${PLUGIN_A_ID}`;

    // First blocked call: shouldRecord → true → log written
    (shouldRecord as ReturnType<typeof vi.fn>).mockReturnValueOnce(true);
    stubPluginAuth();
    stubActivePlugin();
    const res1 = await server.inject({
      method: "POST",
      url: "/api/plugin/messages.send_dm",
      headers: { authorization: "Bearer fake-token" },
      remoteAddress: ip,
      payload: { user_id: USER_ID, content: "spam" },
    });
    expect(res1.statusCode).toBe(429);
    expect(shouldRecord).toHaveBeenCalledWith(dedupKey);
    expect(botEventLog.record).toHaveBeenCalledWith(
      "warn",
      "bot",
      expect.stringContaining(PLUGIN_A_KEY),
      expect.objectContaining({ pluginId: PLUGIN_A_ID }),
    );

    vi.clearAllMocks();
    // Restore shouldRecord default after clear
    (shouldRecord as ReturnType<typeof vi.fn>).mockReturnValue(false);

    // Second blocked call: shouldRecord → false → log NOT written
    stubPluginAuth();
    stubActivePlugin();
    const res2 = await server.inject({
      method: "POST",
      url: "/api/plugin/messages.send_dm",
      headers: { authorization: "Bearer fake-token" },
      remoteAddress: ip,
      payload: { user_id: USER_ID, content: "spam2" },
    });
    expect(res2.statusCode).toBe(429);
    expect(shouldRecord).toHaveBeenCalledWith(dedupKey);
    expect(botEventLog.record).not.toHaveBeenCalled();
  });
});
