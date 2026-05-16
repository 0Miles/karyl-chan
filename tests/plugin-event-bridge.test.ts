import { vi, describe, it, expect, beforeAll, beforeEach } from "vitest";

vi.hoisted(() => {
  process.env.SQLITE_DB_PATH = ":memory:";
});

import { sequelize } from "../src/db.js";
import { Plugin } from "../src/modules/plugin-system/models/plugin.model.js";
import {
  rebuildEventIndex,
  getEventIndexSize,
  dispatchEventToPlugins,
} from "../src/modules/plugin-system/plugin-event-bridge.service.js";
import type { PluginManifest } from "../src/modules/plugin-system/plugin-sdk-types.js";

beforeAll(async () => {
  await sequelize.sync({ force: true });
});

beforeEach(async () => {
  await Plugin.destroy({ where: {}, truncate: true });
  // Force the in-memory index back to empty so each test seeds fresh.
  await rebuildEventIndex();
});

async function seedPlugin(opts: {
  id: number;
  key: string;
  enabled: boolean;
  status: "active" | "inactive";
  manifest: Partial<PluginManifest>;
  url?: string;
}): Promise<void> {
  const fullManifest: PluginManifest = {
    schema_version: "2",
    plugin: {
      id: opts.key,
      name: opts.key,
      version: "1.0.0",
      url: opts.url ?? "http://plugin.invalid",
    },
    ...opts.manifest,
  };
  await Plugin.create({
    id: opts.id,
    pluginKey: opts.key,
    name: opts.key,
    version: "1.0.0",
    url: opts.url ?? "http://plugin.invalid",
    enabled: opts.enabled,
    status: opts.status,
    manifestJson: JSON.stringify(fullManifest),
    setupSecretHash: "abc",
    tokenHash: null,
    dispatchHmacKey: "k",
    lastHeartbeatAt: null,
  } as Record<string, unknown>);
}

describe("rebuildEventIndex", () => {
  it("starts empty when no plugins are registered", async () => {
    await rebuildEventIndex();
    expect(getEventIndexSize()).toBe(0);
  });

  it("indexes events_subscribed_global from every active+enabled plugin", async () => {
    await seedPlugin({
      id: 1,
      key: "alpha",
      enabled: true,
      status: "active",
      manifest: { events_subscribed_global: ["messageCreate", "guildJoin"] },
    });
    await rebuildEventIndex();
    expect(getEventIndexSize()).toBe(2);
  });

  it("indexes per-feature events_subscribed in addition to global", async () => {
    await seedPlugin({
      id: 1,
      key: "alpha",
      enabled: true,
      status: "active",
      manifest: {
        events_subscribed_global: ["messageCreate"],
        guild_features: [
          {
            key: "feat1",
            name: "Feature 1",
            events_subscribed: ["voiceJoin", "messageCreate"],
          },
        ],
      },
    });
    await rebuildEventIndex();
    // messageCreate + voiceJoin (messageCreate dedup'd across global +
    // feature)
    expect(getEventIndexSize()).toBe(2);
  });

  it("skips disabled plugins", async () => {
    await seedPlugin({
      id: 1,
      key: "alpha",
      enabled: false,
      status: "active",
      manifest: { events_subscribed_global: ["messageCreate"] },
    });
    await rebuildEventIndex();
    expect(getEventIndexSize()).toBe(0);
  });

  it("skips plugins with non-active status", async () => {
    await seedPlugin({
      id: 1,
      key: "alpha",
      enabled: true,
      status: "inactive",
      manifest: { events_subscribed_global: ["messageCreate"] },
    });
    await rebuildEventIndex();
    expect(getEventIndexSize()).toBe(0);
  });

  it("ignores plugins whose manifestJson fails to parse", async () => {
    await Plugin.create({
      id: 99,
      pluginKey: "broken",
      name: "broken",
      version: "1.0.0",
      url: "http://plugin.invalid",
      enabled: true,
      status: "active",
      manifestJson: "{not valid json",
      setupSecretHash: "h",
      tokenHash: null,
      dispatchHmacKey: "k",
      lastHeartbeatAt: null,
    } as Record<string, unknown>);
    await rebuildEventIndex();
    expect(getEventIndexSize()).toBe(0);
  });

  it("rebuilds idempotently — repeated calls converge on the same index", async () => {
    await seedPlugin({
      id: 1,
      key: "alpha",
      enabled: true,
      status: "active",
      manifest: { events_subscribed_global: ["a", "b", "c"] },
    });
    await rebuildEventIndex();
    expect(getEventIndexSize()).toBe(3);
    await rebuildEventIndex();
    expect(getEventIndexSize()).toBe(3);
  });
});

describe("dispatchEventToPlugins", () => {
  it("is a synchronous no-op when no plugin subscribes to the event type", async () => {
    // No subscribers — the function returns immediately without
    // touching the network. We verify by stubbing fetch and asserting
    // it isn't called.
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 204 }));
    try {
      dispatchEventToPlugins("nobodyListens", { x: 1 });
      // Give the (would-be) async body a tick to schedule.
      await new Promise((r) => setImmediate(r));
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
