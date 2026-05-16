import {
  vi,
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
} from "vitest";

vi.hoisted(() => {
  process.env.SQLITE_DB_PATH = ":memory:";
});

import Fastify, { type FastifyInstance } from "fastify";
import { sequelize } from "../src/db.js";
import { Behavior } from "../src/modules/behavior/models/behavior.model.js";
import { registerBehaviorRoutes } from "../src/modules/behavior/behavior-routes.js";

async function buildServer(): Promise<FastifyInstance> {
  const fastify = Fastify({ logger: false });
  // Stub the global auth hook with an in-memory admin so the routes
  // see `behavior.manage` and proceed.
  fastify.addHook("onRequest", async (request) => {
    request.authUserId = "test";
    request.authCapabilities = new Set(["admin"]);
  });
  await registerBehaviorRoutes(fastify, {
    reconciler: {
      reconcileAll: async () => undefined,
      reconcileForGuild: async () => undefined,
    } as never,
  });
  await fastify.ready();
  return fastify;
}

interface BehaviorSeed {
  id: number;
  title: string;
  sortOrder: number;
}

async function seedCustomBehaviors(rows: BehaviorSeed[]): Promise<void> {
  for (const r of rows) {
    await Behavior.create({
      id: r.id,
      title: r.title,
      enabled: true,
      sortOrder: r.sortOrder,
      source: "custom",
      triggerType: "message_pattern",
      messagePatternKind: "startswith",
      messagePatternValue: "!",
      scope: "global",
      integrationTypes: "guild_install",
      contexts: "Guild",
      audienceKind: "all",
      webhookUrl: "http://example.invalid/hook",
      scopeTabId: 1,
    } as Record<string, unknown>);
  }
}

beforeAll(async () => {
  await sequelize.sync({ force: true });
});

beforeEach(async () => {
  await Behavior.destroy({ where: {} });
});

describe("PATCH /api/behaviors/reorder", () => {
  it("applies the requested sort order atomically", async () => {
    await seedCustomBehaviors([
      { id: 1, title: "first", sortOrder: 0 },
      { id: 2, title: "second", sortOrder: 1 },
      { id: 3, title: "third", sortOrder: 2 },
    ]);
    const server = await buildServer();
    const r = await server.inject({
      method: "PATCH",
      url: "/api/behaviors/reorder",
      payload: { orderedIds: [3, 1, 2] },
    });
    expect(r.statusCode).toBe(200);
    const rows = await Behavior.findAll({ order: [["id", "ASC"]] });
    const map = new Map(
      rows.map((b) => [
        b.getDataValue("id") as number,
        b.getDataValue("sortOrder") as number,
      ]),
    );
    expect(map.get(3)).toBe(0);
    expect(map.get(1)).toBe(1);
    expect(map.get(2)).toBe(2);
    await server.close();
  });

  it("rejects orderedIds when it isn't an array", async () => {
    const server = await buildServer();
    const r = await server.inject({
      method: "PATCH",
      url: "/api/behaviors/reorder",
      payload: { orderedIds: "not an array" },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toMatch(/orderedIds/);
    await server.close();
  });

  it("rejects an oversize batch (> 500 ids) so a typo can't pin the write lock", async () => {
    const server = await buildServer();
    const big = Array.from({ length: 501 }, (_, i) => i + 1);
    const r = await server.inject({
      method: "PATCH",
      url: "/api/behaviors/reorder",
      payload: { orderedIds: big },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toMatch(/orderedIds/);
    await server.close();
  });

  it("does not touch source='system' rows even if their id appears in orderedIds", async () => {
    await seedCustomBehaviors([{ id: 10, title: "cust", sortOrder: 0 }]);
    await Behavior.create({
      id: 11,
      title: "system-row",
      enabled: true,
      sortOrder: 5,
      source: "system",
      triggerType: "message_pattern",
      messagePatternKind: "startswith",
      messagePatternValue: "!",
      scope: "global",
      integrationTypes: "guild_install",
      contexts: "Guild",
      audienceKind: "all",
      systemKey: "manual",
      scopeTabId: 1,
    } as Record<string, unknown>);
    const server = await buildServer();
    // Try to reorder the system row alongside the custom — the route
    // filters by `source: 'custom'` per row so the system row's
    // sortOrder must remain untouched (5).
    const r = await server.inject({
      method: "PATCH",
      url: "/api/behaviors/reorder",
      payload: { orderedIds: [11, 10] },
    });
    expect(r.statusCode).toBe(200);
    const system = await Behavior.findByPk(11);
    expect(system?.getDataValue("sortOrder")).toBe(5);
    const custom = await Behavior.findByPk(10);
    // The custom row IS reordered (it ends up at index 1 because
    // index 0 silently no-ops against the system row).
    expect(custom?.getDataValue("sortOrder")).toBe(1);
    await server.close();
  });
});
