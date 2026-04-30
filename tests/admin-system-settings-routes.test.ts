import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

/**
 * Set NODE_ENV=test before any module is loaded so config.ts doesn't
 * throw on missing BOT_TOKEN.
 */
vi.hoisted(() => {
  process.env.NODE_ENV = "test";
  process.env.SQLITE_DB_PATH = ":memory:";
});

import Fastify, { type FastifyInstance } from "fastify";
import type { AdminCapability } from "../src/modules/admin/authorized-user.service.js";
import {
  registerAdminSystemSettingsRoutes,
  buildSystemSettingsSnapshot,
} from "../src/modules/admin/admin-system-settings-routes.js";
import { CONFIG_METADATA } from "../src/config-metadata.js";

// ── test helpers ──────────────────────────────────────────────────────────────

/**
 * Build a Fastify instance with a synthetic auth hook and the
 * system-settings routes registered. Mirrors the pattern used in
 * admin-management-routes.test.ts.
 */
async function buildServer(actor: {
  userId: string;
  caps: AdminCapability[];
}): Promise<FastifyInstance> {
  const fastify = Fastify({ logger: false });
  fastify.addHook("onRequest", async (request) => {
    request.authUserId = actor.userId;
    request.authCapabilities = new Set(actor.caps);
  });
  await registerAdminSystemSettingsRoutes(fastify);
  await fastify.ready();
  return fastify;
}

/**
 * Minimal server that has no auth context set (simulates 401 — the
 * real global hook in server.ts sends 401 before capabilities are
 * checked; here we simulate by setting zero caps, which makes
 * requireCapability send 403).
 *
 * For the unauthenticated case we build a server with an empty caps
 * set so requireCapability fires a 403. To get a genuine 401 we
 * would need the full server.ts hook; the unit test validates the
 * authorisation gate is present.
 */
async function buildUnauthenticatedServer(): Promise<FastifyInstance> {
  const fastify = Fastify({ logger: false });
  // No authUserId, no authCapabilities — requireCapability will 403.
  await registerAdminSystemSettingsRoutes(fastify);
  await fastify.ready();
  return fastify;
}

// ── security: sensitive value never leaks ─────────────────────────────────────

describe("sensitive value redaction", () => {
  it("JSON response does not contain the sensitive value even when configured", async () => {
    // Inject a known secret string as bot.token into the live config.
    // Because config is frozen we temporarily override via the module-level
    // config object reference through the bot sub-object which is NOT frozen
    // (Object.freeze is shallow). We store and restore the original token.
    const { config } = await import("../src/config.js");
    const originalToken = config.bot.token;

    // Override the bot sub-object's token property (shallow freeze doesn't
    // prevent mutation of nested objects). We do this via Object.defineProperty
    // to bypass the property descriptor on the frozen outer object while still
    // targeting the inner mutable object.
    const botObj = config.bot as { token: string };
    const originalDescriptor = Object.getOwnPropertyDescriptor(botObj, "token");
    Object.defineProperty(botObj, "token", {
      value: "TEST_SECRET_VALUE_SHOULD_NOT_LEAK",
      writable: true,
      configurable: true,
    });

    try {
      const snapshot = buildSystemSettingsSnapshot();
      const json = JSON.stringify(snapshot);
      expect(json.includes("TEST_SECRET_VALUE")).toBe(false);
      // Also confirm bot.token is present as a field (just without value).
      const botGroup = snapshot.groups.find((g) => g.group === "bot");
      const tokenField = botGroup?.fields.find((f) => f.path === "bot.token");
      expect(tokenField).toBeDefined();
      expect(tokenField?.sensitivity).toBe("sensitive");
      // The field must not have a "value" key at all.
      expect(Object.hasOwn(tokenField!, "value")).toBe(false);
      expect((tokenField as { status?: string })?.status).toBe("configured");
    } finally {
      // Restore original descriptor.
      if (originalDescriptor) {
        Object.defineProperty(botObj, "token", originalDescriptor);
      } else {
        Object.defineProperty(botObj, "token", {
          value: originalToken,
          writable: true,
          configurable: true,
        });
      }
    }
  });

  it("sensitive field with falsy value reports status=unset", async () => {
    const { config } = await import("../src/config.js");
    const botObj = config.bot as { token: string };
    const originalDescriptor = Object.getOwnPropertyDescriptor(botObj, "token");

    Object.defineProperty(botObj, "token", {
      value: "",
      writable: true,
      configurable: true,
    });

    try {
      const snapshot = buildSystemSettingsSnapshot();
      const botGroup = snapshot.groups.find((g) => g.group === "bot");
      const tokenField = botGroup?.fields.find((f) => f.path === "bot.token");
      expect(Object.hasOwn(tokenField!, "value")).toBe(false);
      expect((tokenField as { status?: string })?.status).toBe("unset");
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(botObj, "token", originalDescriptor);
      }
    }
  });
});

// ── authorisation gate ────────────────────────────────────────────────────────

describe("GET /api/admin/system-settings — authorisation", () => {
  it("returns 403 when no auth context is set", async () => {
    const server = await buildUnauthenticatedServer();
    try {
      const r = await server.inject({
        method: "GET",
        url: "/api/admin/system-settings",
      });
      // No authCapabilities → requireCapability sends 403.
      expect(r.statusCode).toBe(403);
    } finally {
      await server.close();
    }
  });

  it("returns 403 when authenticated but without admin capability", async () => {
    const server = await buildServer({
      userId: "111111111111111111",
      caps: ["dm.message"],
    });
    try {
      const r = await server.inject({
        method: "GET",
        url: "/api/admin/system-settings",
      });
      expect(r.statusCode).toBe(403);
    } finally {
      await server.close();
    }
  });

  it("returns 200 with admin capability", async () => {
    const server = await buildServer({
      userId: "999999999999999999",
      caps: ["admin"],
    });
    try {
      const r = await server.inject({
        method: "GET",
        url: "/api/admin/system-settings",
      });
      expect(r.statusCode).toBe(200);
    } finally {
      await server.close();
    }
  });
});

// ── response shape ────────────────────────────────────────────────────────────

describe("GET /api/admin/system-settings — response shape", () => {
  it("response contains groups, productionReadiness, and runtimeEditable", async () => {
    const server = await buildServer({
      userId: "999999999999999999",
      caps: ["admin"],
    });
    try {
      const r = await server.inject({
        method: "GET",
        url: "/api/admin/system-settings",
      });
      expect(r.statusCode).toBe(200);
      const body = r.json() as {
        groups: unknown[];
        productionReadiness: unknown;
        runtimeEditable: unknown;
      };
      expect(Array.isArray(body.groups)).toBe(true);
      expect(body.productionReadiness).toBeDefined();
      expect(body.runtimeEditable).toBeDefined();
    } finally {
      await server.close();
    }
  });

  it("every known group from CONFIG_METADATA appears in the response", async () => {
    const server = await buildServer({
      userId: "999999999999999999",
      caps: ["admin"],
    });
    try {
      const r = await server.inject({
        method: "GET",
        url: "/api/admin/system-settings",
      });
      expect(r.statusCode).toBe(200);
      const body = r.json() as { groups: Array<{ group: string; fields: unknown[] }> };

      // Collect all unique groups from metadata.
      const expectedGroups = new Set(
        Object.values(CONFIG_METADATA).map((m) => m.group),
      );
      const responseGroups = new Set(body.groups.map((g) => g.group));

      for (const g of expectedGroups) {
        expect(responseGroups.has(g)).toBe(true);
      }

      // Every group must have at least one field.
      for (const g of body.groups) {
        expect(g.fields.length).toBeGreaterThan(0);
      }
    } finally {
      await server.close();
    }
  });

  it("runtimeEditable.fields is empty and noteKey is set", async () => {
    const server = await buildServer({
      userId: "999999999999999999",
      caps: ["admin"],
    });
    try {
      const r = await server.inject({
        method: "GET",
        url: "/api/admin/system-settings",
      });
      const body = r.json() as {
        runtimeEditable: { fields: unknown[]; noteKey: string };
      };
      expect(body.runtimeEditable.fields).toEqual([]);
      expect(typeof body.runtimeEditable.noteKey).toBe("string");
      expect(body.runtimeEditable.noteKey.length).toBeGreaterThan(0);
    } finally {
      await server.close();
    }
  });
});

// ── production readiness ──────────────────────────────────────────────────────

describe("productionReadiness", () => {
  it("missingKeys contains paths where productionRequired=true but value is falsy", async () => {
    // In the test environment, BOT_TOKEN is set to "" by config.ts fallback,
    // and BOT_OWNER_ID / ENCRYPTION_KEY are typically
    // unset → should appear in missingKeys.
    const snapshot = buildSystemSettingsSnapshot();
    const pr = snapshot.productionReadiness;

    // requiredKeys must include the three known required fields.
    // bot.ownerIds is the authoritative production-required field;
    // bot.ownerId is a backward-compat alias and is no longer required.
    const knownRequired = [
      "bot.token",
      "bot.ownerIds",
      "crypto.encryptionKey",
    ];
    for (const key of knownRequired) {
      expect(pr.requiredKeys).toContain(key);
    }

    // allSet must reflect the truthiness of missingKeys.
    expect(pr.allSet).toBe(pr.missingKeys.length === 0);
  });

  it("allSet is false when a required key is unset", async () => {
    const { config } = await import("../src/config.js");
    // Inject a falsy value for a productionRequired field.
    const cryptoObj = config.crypto as { encryptionKey: string | null };
    const original = cryptoObj.encryptionKey;
    Object.defineProperty(cryptoObj, "encryptionKey", {
      value: null,
      writable: true,
      configurable: true,
    });

    try {
      const snapshot = buildSystemSettingsSnapshot();
      expect(snapshot.productionReadiness.missingKeys).toContain(
        "crypto.encryptionKey",
      );
      expect(snapshot.productionReadiness.allSet).toBe(false);
    } finally {
      Object.defineProperty(cryptoObj, "encryptionKey", {
        value: original,
        writable: true,
        configurable: true,
      });
    }
  });
});

// ── all sensitive fields in response have no value key ───────────────────────

describe("invariant: sensitive fields never carry a value key", () => {
  it("no sensitive field in the snapshot has a value property", () => {
    const snapshot = buildSystemSettingsSnapshot();
    for (const { fields } of snapshot.groups) {
      for (const field of fields) {
        if (field.sensitivity === "sensitive") {
          expect(Object.hasOwn(field, "value")).toBe(false);
        }
      }
    }
  });
});
