/**
 * Unit tests for the guild-feature gate in POST /api/plugin/messages.send.
 *
 * Strategy: mock the Sequelize-backed functions (findPluginById,
 * findEnabledFeaturesByPluginGuild) and the side-effect helpers
 * (botEventLog.record, shouldRecord) so the tests run without a real
 * DB or Discord bot client.  Auth is bypassed by stubbing
 * pluginAuthStore.verify to return a fake PluginAuthRecord.
 */
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

vi.hoisted(() => {
  process.env.SQLITE_DB_PATH = ":memory:";
});

// ── module-level mocks ──────────────────────────────────────────────────────

vi.mock("../src/modules/plugin-system/models/plugin.model.js", () => ({
  findPluginById: vi.fn(),
}));

vi.mock(
  "../src/modules/feature-toggle/models/plugin-guild-feature.model.js",
  () => ({
    findEnabledFeaturesByPluginGuild: vi.fn(),
    // The other exports are not used by plugin-rpc-routes; stubs prevent
    // import errors if the module is transitively imported.
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

// ── imports after mocks ─────────────────────────────────────────────────────

import type { FastifyInstance } from "fastify";
import { createWebServer } from "../src/modules/web-core/server.js";
import { pluginAuthStore } from "../src/modules/plugin-system/plugin-auth.service.js";
import { findPluginById } from "../src/modules/plugin-system/models/plugin.model.js";
import { findEnabledFeaturesByPluginGuild } from "../src/modules/feature-toggle/models/plugin-guild-feature.model.js";
import { botEventLog } from "../src/modules/bot-events/bot-event-log.js";
import { shouldRecord } from "../src/modules/bot-events/bot-event-dedup.js";
import type { PluginGuildFeatureRow } from "../src/modules/feature-toggle/models/plugin-guild-feature.model.js";

// ── helpers ─────────────────────────────────────────────────────────────────

const PLUGIN_ID = 42;
const PLUGIN_KEY = "test-plugin";
const GUILD_ID = "guild-123";
const CHANNEL_ID = "chan-456";
const DM_CHANNEL_ID = "dm-789";

/** Stubs pluginAuthStore.verify so the onRequest hook accepts our token. */
function stubPluginAuth() {
  vi.spyOn(pluginAuthStore, "verify").mockReturnValue({
    pluginId: PLUGIN_ID,
    pluginKey: PLUGIN_KEY,
    scopes: new Set(["messages.send"]),
    expiresAt: Date.now() + 60_000,
  });
}

/** Stubs findPluginById to return an active, enabled plugin row. */
function stubActivePlugin() {
  (findPluginById as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: PLUGIN_ID,
    pluginKey: PLUGIN_KEY,
    enabled: true,
    status: "active",
    manifestJson: "{}",
  });
}

/** Returns a fake guild text channel. */
function fakeGuildChannel(guildId = GUILD_ID) {
  const send = vi
    .fn()
    .mockResolvedValue({ id: "msg-1", channelId: CHANNEL_ID });
  return {
    id: CHANNEL_ID,
    guildId,
    isTextBased: () => true,
    isDMBased: () => false,
    send,
    _send: send,
  };
}

/** Returns a fake DM channel (no guildId). */
function fakeDmChannel() {
  const send = vi
    .fn()
    .mockResolvedValue({ id: "dm-msg-1", channelId: DM_CHANNEL_ID });
  return {
    id: DM_CHANNEL_ID,
    guildId: null,
    isTextBased: () => true,
    isDMBased: () => true,
    send,
    _send: send,
  };
}

/** Builds a fake bot client that returns the given channel for fetch. */
function fakeBot(channel: unknown) {
  return {
    user: { id: "bot-1" },
    isReady: () => true,
    guilds: { cache: { size: 0 } },
    uptime: 0,
    channels: {
      fetch: vi.fn().mockResolvedValue(channel),
    },
  };
}

function fakeFeatureRow(
  overrides: Partial<PluginGuildFeatureRow> = {},
): PluginGuildFeatureRow {
  return {
    id: 1,
    pluginId: PLUGIN_ID,
    guildId: GUILD_ID,
    featureKey: "my-feature",
    enabled: true,
    configJson: "{}",
    metricsJson: "{}",
    updatedAt: new Date(),
    ...overrides,
  };
}

// ── tests ────────────────────────────────────────────────────────────────────

describe("messages.send — guild feature gate", () => {
  let server: FastifyInstance;

  beforeEach(() => {
    vi.clearAllMocks();
    stubPluginAuth();
    stubActivePlugin();
  });

  afterEach(async () => {
    if (server) await server.close();
  });

  it("allows send when plugin has an enabled feature in the target guild", async () => {
    const channel = fakeGuildChannel();
    server = await createWebServer({
      staticRoot: undefined,
      bot: fakeBot(channel) as never,
    });
    await server.ready();

    (
      findEnabledFeaturesByPluginGuild as ReturnType<typeof vi.fn>
    ).mockResolvedValue([fakeFeatureRow()]);

    const res = await server.inject({
      method: "POST",
      url: "/api/plugin/messages.send",
      headers: { authorization: "Bearer fake-token" },
      payload: { channel_id: CHANNEL_ID, content: "hello" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: "msg-1", channel_id: CHANNEL_ID });
    expect(channel._send).toHaveBeenCalledOnce();
    expect(findEnabledFeaturesByPluginGuild).toHaveBeenCalledWith(
      PLUGIN_ID,
      GUILD_ID,
    );
  });

  it("returns 403 when plugin has no enabled feature in the target guild", async () => {
    const channel = fakeGuildChannel();
    server = await createWebServer({
      staticRoot: undefined,
      bot: fakeBot(channel) as never,
    });
    await server.ready();

    (
      findEnabledFeaturesByPluginGuild as ReturnType<typeof vi.fn>
    ).mockResolvedValue([]);

    const res = await server.inject({
      method: "POST",
      url: "/api/plugin/messages.send",
      headers: { authorization: "Bearer fake-token" },
      payload: { channel_id: CHANNEL_ID, content: "hello" },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: "plugin not enabled in this guild" });
    expect(channel._send).not.toHaveBeenCalled();
  });

  it("does NOT check features for DM channels — send succeeds", async () => {
    const channel = fakeDmChannel();
    server = await createWebServer({
      staticRoot: undefined,
      bot: fakeBot(channel) as never,
    });
    await server.ready();

    // findEnabledFeaturesByPluginGuild should never be called for DM channels
    (
      findEnabledFeaturesByPluginGuild as ReturnType<typeof vi.fn>
    ).mockResolvedValue([]);

    const res = await server.inject({
      method: "POST",
      url: "/api/plugin/messages.send",
      headers: { authorization: "Bearer fake-token" },
      payload: { channel_id: DM_CHANNEL_ID, content: "hello" },
    });

    expect(res.statusCode).toBe(200);
    expect(channel._send).toHaveBeenCalledOnce();
    expect(findEnabledFeaturesByPluginGuild).not.toHaveBeenCalled();
  });

  it("writes a warn log on first blocked attempt but deduplicates on subsequent ones", async () => {
    const channel = fakeGuildChannel();
    server = await createWebServer({
      staticRoot: undefined,
      bot: fakeBot(channel) as never,
    });
    await server.ready();

    (
      findEnabledFeaturesByPluginGuild as ReturnType<typeof vi.fn>
    ).mockResolvedValue([]);

    const dedupKey = `plugin-rpc-feature-block:${PLUGIN_ID}:${GUILD_ID}`;

    // First call: shouldRecord returns true → log is written
    (shouldRecord as ReturnType<typeof vi.fn>).mockReturnValueOnce(true);
    const res1 = await server.inject({
      method: "POST",
      url: "/api/plugin/messages.send",
      headers: { authorization: "Bearer fake-token" },
      payload: { channel_id: CHANNEL_ID, content: "hello" },
    });
    expect(res1.statusCode).toBe(403);
    expect(shouldRecord).toHaveBeenCalledWith(dedupKey);
    expect(botEventLog.record).toHaveBeenCalledWith(
      "warn",
      "feature",
      expect.stringContaining(PLUGIN_KEY),
      expect.objectContaining({ pluginId: PLUGIN_ID, guildId: GUILD_ID }),
    );

    vi.clearAllMocks();
    stubPluginAuth();
    stubActivePlugin();
    (
      findEnabledFeaturesByPluginGuild as ReturnType<typeof vi.fn>
    ).mockResolvedValue([]);

    // Second call: shouldRecord returns false → log is NOT written
    (shouldRecord as ReturnType<typeof vi.fn>).mockReturnValueOnce(false);
    const res2 = await server.inject({
      method: "POST",
      url: "/api/plugin/messages.send",
      headers: { authorization: "Bearer fake-token" },
      payload: { channel_id: CHANNEL_ID, content: "hello" },
    });
    expect(res2.statusCode).toBe(403);
    expect(shouldRecord).toHaveBeenCalledWith(dedupKey);
    expect(botEventLog.record).not.toHaveBeenCalled();
  });
});
