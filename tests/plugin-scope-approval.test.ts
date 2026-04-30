/**
 * Tests for plugin scope-approval gate (Tier 1 issue 2.4).
 *
 * Coverage:
 *   1. computeScopeDiff — first-register equivalent (prevApproved=[]):
 *        approved = declared, pending = []
 *   2. computeScopeDiff — re-register add scope (autoApprove=false):
 *        pending has new scope, approved unchanged
 *   3. computeScopeDiff — re-register remove scope:
 *        scope auto-removed from approved, pending unaffected
 *   4. computeScopeDiff — autoApprove=true: new scope goes straight to approved
 *   5. approvePluginScopes model helper: approved ∪ pending, pending cleared
 *   6. upsertPluginRegistration stores scope columns correctly
 *   7. GET /api/plugins returns approvedScopes + pendingScopes fields
 *   8. POST /api/plugins/:id/approve-scopes endpoint (happy path + 404 + 400)
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

// Mock host-policy at module level so validateManifest doesn't SSRF-reject localhost.
vi.mock("../src/utils/host-policy.js", () => ({
  assertPluginTarget: vi.fn().mockResolvedValue(undefined),
  HostPolicyError: class HostPolicyError extends Error {},
}));

import { sequelize } from "../src/db.js";
import {
  Plugin,
  upsertPluginRegistration,
  approvePluginScopes,
  findPluginByKey,
} from "../src/modules/plugin-system/models/plugin.model.js";
import { computeScopeDiff } from "../src/modules/plugin-system/plugin-registry.service.js";

// ── Shared helpers ──────────────────────────────────────────────────────────

function makeManifestJson(scopes: string[]): string {
  return JSON.stringify({
    schema_version: "1",
    plugin: {
      id: "test-plugin",
      name: "Test Plugin",
      version: "1.0.0",
      url: "http://localhost:9999",
    },
    rpc_methods_used: scopes,
  });
}

function makeUpsertInput(
  scopes: string[],
  approvedScopes: string[],
  pendingScopes: string | null = null,
) {
  return {
    pluginKey: "test-plugin",
    name: "Test Plugin",
    version: "1.0.0",
    url: "http://localhost:9999",
    manifestJson: makeManifestJson(scopes),
    tokenHash: "testhash",
    approvedScopesJson: JSON.stringify(approvedScopes),
    pendingScopesJson: pendingScopes,
  };
}

// ── Setup ────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  await sequelize.sync({ force: true });
});

beforeEach(async () => {
  await Plugin.destroy({ where: {} });
});

// ── 1–4: computeScopeDiff pure function ─────────────────────────────────────

describe("computeScopeDiff", () => {
  it("1. prevApproved=[], autoApprove=false: all declared go to pending (re-register on brand-new row via computeScopeDiff)", () => {
    // Note: computeScopeDiff is used for re-registration only.
    // First-register uses a separate fast-path in register() that
    // approves all scopes directly without calling computeScopeDiff.
    // This test verifies the pure function's behaviour when prevApproved=[].
    const result = computeScopeDiff([], ["messages.read", "users.list"], false);
    expect(result.approved).toEqual([]);
    expect(result.pending.sort()).toEqual(
      ["messages.read", "users.list"].sort(),
    );
  });

  it("1b. prevApproved=[], autoApprove=true: all declared go to approved", () => {
    const result = computeScopeDiff([], ["messages.read", "users.list"], true);
    expect(result.approved.sort()).toEqual(
      ["messages.read", "users.list"].sort(),
    );
    expect(result.pending).toEqual([]);
  });

  it("2. re-register add scope (autoApprove=false): pending has new scope, approved unchanged", () => {
    const result = computeScopeDiff(
      ["messages.read"],
      ["messages.read", "messages.send_dm"],
      false,
    );
    expect(result.approved).toEqual(["messages.read"]);
    expect(result.pending).toEqual(["messages.send_dm"]);
  });

  it("3. re-register remove scope: scope auto-removed from approved", () => {
    const result = computeScopeDiff(
      ["messages.read", "users.list"],
      ["messages.read"],
      false,
    );
    expect(result.approved).toEqual(["messages.read"]);
    expect(result.approved).not.toContain("users.list");
    expect(result.pending).toEqual([]);
  });

  it("3b. remove scope does not add to pending", () => {
    const result = computeScopeDiff(
      ["messages.read", "users.list"],
      ["messages.read"],
      false,
    );
    expect(result.pending).not.toContain("users.list");
  });

  it("4. autoApprove=true: new scope goes straight to approved, pending=[]", () => {
    const result = computeScopeDiff(
      ["messages.read"],
      ["messages.read", "messages.send_dm"],
      true,
    );
    expect(result.approved.sort()).toEqual(
      ["messages.read", "messages.send_dm"].sort(),
    );
    expect(result.pending).toEqual([]);
  });

  it("autoApprove=true with removed scope: removed scope gone, added in approved", () => {
    const result = computeScopeDiff(
      ["messages.read", "users.list"],
      ["messages.read", "messages.send_dm"],
      true,
    );
    expect(result.approved.sort()).toEqual(
      ["messages.read", "messages.send_dm"].sort(),
    );
    expect(result.approved).not.toContain("users.list");
    expect(result.pending).toEqual([]);
  });

  it("no change: approved unchanged, pending=[]", () => {
    const result = computeScopeDiff(
      ["messages.read"],
      ["messages.read"],
      false,
    );
    expect(result.approved).toEqual(["messages.read"]);
    expect(result.pending).toEqual([]);
  });

  it("empty declared: all previous approved removed, pending=[]", () => {
    const result = computeScopeDiff(["messages.read", "users.list"], [], false);
    expect(result.approved).toEqual([]);
    expect(result.pending).toEqual([]);
  });
});

// ── 5–6: model layer ─────────────────────────────────────────────────────────

describe("upsertPluginRegistration — scope columns", () => {
  it("6a. stores approvedScopesJson and null pendingScopesJson on first insert", async () => {
    const row = await upsertPluginRegistration(
      makeUpsertInput(
        ["messages.read", "users.list"],
        ["messages.read", "users.list"],
      ),
    );
    expect(JSON.parse(row.approvedScopesJson).sort()).toEqual(
      ["messages.read", "users.list"].sort(),
    );
    expect(row.pendingScopesJson).toBeNull();
  });

  it("6b. stores non-null pendingScopesJson on re-register with pending scopes", async () => {
    await upsertPluginRegistration(
      makeUpsertInput(["messages.read"], ["messages.read"]),
    );
    const row = await upsertPluginRegistration(
      makeUpsertInput(
        ["messages.read", "messages.send_dm"],
        ["messages.read"],
        JSON.stringify(["messages.send_dm"]),
      ),
    );
    expect(JSON.parse(row.approvedScopesJson)).toEqual(["messages.read"]);
    expect(JSON.parse(row.pendingScopesJson!)).toEqual(["messages.send_dm"]);
  });

  it("6c. update clears pendingScopesJson when set to null", async () => {
    await upsertPluginRegistration(
      makeUpsertInput(
        ["messages.read"],
        ["messages.read"],
        JSON.stringify(["messages.send_dm"]),
      ),
    );
    const row = await upsertPluginRegistration(
      makeUpsertInput(
        ["messages.read", "messages.send_dm"],
        ["messages.read", "messages.send_dm"],
      ),
    );
    expect(row.pendingScopesJson).toBeNull();
  });
});

describe("5. approvePluginScopes", () => {
  it("merges pending into approved and clears pending", async () => {
    const inserted = await upsertPluginRegistration(
      makeUpsertInput(
        ["messages.read"],
        ["messages.read"],
        JSON.stringify(["messages.send_dm"]),
      ),
    );
    const updated = await approvePluginScopes(inserted.id);
    expect(updated).not.toBeNull();
    const approved = JSON.parse(updated!.approvedScopesJson) as string[];
    expect(approved.sort()).toEqual(
      ["messages.read", "messages.send_dm"].sort(),
    );
    expect(updated!.pendingScopesJson).toBeNull();
  });

  it("returns null for unknown id", async () => {
    const result = await approvePluginScopes(99999);
    expect(result).toBeNull();
  });

  it("is a no-op when pending is null", async () => {
    const inserted = await upsertPluginRegistration(
      makeUpsertInput(["messages.read"], ["messages.read"]),
    );
    const updated = await approvePluginScopes(inserted.id);
    expect(JSON.parse(updated!.approvedScopesJson)).toEqual(["messages.read"]);
    expect(updated!.pendingScopesJson).toBeNull();
  });

  it("deduplicates when pending overlaps with approved", async () => {
    const inserted = await upsertPluginRegistration(
      makeUpsertInput(
        ["messages.read"],
        ["messages.read"],
        JSON.stringify(["messages.read", "users.list"]),
      ),
    );
    const updated = await approvePluginScopes(inserted.id);
    const approved = JSON.parse(updated!.approvedScopesJson) as string[];
    expect(approved.sort()).toEqual(["messages.read", "users.list"].sort());
  });
});

// ── 7–8: HTTP endpoint tests ─────────────────────────────────────────────────

describe("7–8. POST /api/plugins/:id/approve-scopes + GET /api/plugins", () => {
  let server: import("fastify").FastifyInstance;

  beforeAll(async () => {
    // Sync models so plugins table exists in this test's in-memory DB.
    await sequelize.sync({ force: true });

    const fastify = (await import("fastify")).default;
    const { registerPluginRoutes } =
      await import("../src/modules/plugin-system/plugin-routes.js");

    server = fastify({ logger: false });

    // Inject a fake admin user on every request so requireCapability passes.
    // authCapabilities must be a Set<string> to match the route-guards check.
    server.addHook("onRequest", (req, _reply, done) => {
      (req as unknown as { authUserId: string }).authUserId = "admin-user";
      (req as unknown as { authCapabilities: Set<string> }).authCapabilities =
        new Set(["admin"]);
      done();
    });

    await registerPluginRoutes(server);
    await server.ready();
  });

  afterEach(async () => {
    await Plugin.destroy({ where: {} });
  });

  afterAll(async () => {
    await server.close();
  });

  it("7. GET /api/plugins returns approvedScopes and pendingScopes fields", async () => {
    await upsertPluginRegistration(
      makeUpsertInput(
        ["messages.read"],
        ["messages.read"],
        JSON.stringify(["messages.send_dm"]),
      ),
    );

    const res = await server.inject({
      method: "GET",
      url: "/api/plugins",
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      plugins: Array<{
        approvedScopes: string[];
        pendingScopes: string[];
      }>;
    };
    expect(body.plugins).toHaveLength(1);
    expect(body.plugins[0].approvedScopes).toEqual(["messages.read"]);
    expect(body.plugins[0].pendingScopes).toEqual(["messages.send_dm"]);
  });

  it("8a. POST /api/plugins/:id/approve-scopes merges pending into approved", async () => {
    const row = await upsertPluginRegistration(
      makeUpsertInput(
        ["messages.read"],
        ["messages.read"],
        JSON.stringify(["messages.send_dm"]),
      ),
    );

    const res = await server.inject({
      method: "POST",
      url: `/api/plugins/${row.id}/approve-scopes`,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      approved: string[];
      pending: string[];
    };
    expect(body.approved.sort()).toEqual(
      ["messages.read", "messages.send_dm"].sort(),
    );
    expect(body.pending).toEqual([]);

    // Verify DB state
    const saved = await findPluginByKey("test-plugin");
    const dbApproved = JSON.parse(saved!.approvedScopesJson) as string[];
    expect(dbApproved.sort()).toEqual(
      ["messages.read", "messages.send_dm"].sort(),
    );
    expect(saved!.pendingScopesJson).toBeNull();
  });

  it("8b. POST /api/plugins/:id/approve-scopes returns 404 for unknown plugin", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/api/plugins/99999/approve-scopes",
    });
    expect(res.statusCode).toBe(404);
  });

  it("8c. POST /api/plugins/:id/approve-scopes returns 400 for invalid id", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/api/plugins/notanumber/approve-scopes",
    });
    expect(res.statusCode).toBe(400);
  });
});
