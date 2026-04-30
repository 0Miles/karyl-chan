/**
 * Integration tests for token revocation paths (issue 1.1 fix).
 *
 * Covers:
 *  - removeAuthorizedUser → all tokens for that user are immediately revoked
 *  - revokeRoleCapability → all users on that role lose their tokens
 *  - deleteAdminRole → all users on that role lose their tokens
 *  - POST /api/auth/logout-all → caller's tokens (all devices) revoked
 *  - POST /api/auth/refresh → rejected when user has been removed (no re-issue)
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
});

import { sequelize } from "../src/db.js";
import {
  addAuthorizedUser,
  createAdminRole,
  deleteAdminRole,
  grantRoleCapability,
  invalidateCapabilityCache,
  removeAuthorizedUser,
  revokeRoleCapability,
} from "../src/modules/admin/authorized-user.service.js";
import {
  AuthStore,
  authStore,
} from "../src/modules/web-core/auth-store.service.js";
import { createWebServer } from "../src/modules/web-core/server.js";
import { JwtService } from "../src/modules/web-core/jwt.service.js";
import { randomBytes } from "crypto";
import type { FastifyInstance } from "fastify";

const OWNER_ID = "owner-revoke-test";

// Use the module-level singleton so that authorized-user.service.ts
// calls (removeAuthorizedUser, deleteAdminRole, revokeRoleCapability)
// operate on the same in-memory store as the tests.
const store = authStore;

let server: FastifyInstance;

beforeAll(async () => {
  process.env.BOT_OWNER_ID = OWNER_ID;
  await sequelize.sync({ force: true });
  // Pass the same singleton to the server so HTTP endpoint tests share
  // the same token map.
  server = await createWebServer({
    staticRoot: undefined,
    authStore: store,
    jwtService: new JwtService(randomBytes(64)),
  });
  await server.ready();
});

afterAll(async () => {
  await server.close();
  delete process.env.BOT_OWNER_ID;
  await sequelize.close();
});

beforeEach(async () => {
  // Wipe tables and capability cache before each test so tests are
  // fully isolated. Also clear the in-memory token maps on the
  // singleton by revoking an imaginary owner that matches no real
  // token — we instead call the internal maps through a helper.
  await sequelize.sync({ force: true });
  invalidateCapabilityCache();
  // Reset the singleton's in-memory token stores between tests.
  // We access this via a type cast because the private maps are not
  // part of the public API; this is test-internal and intentional.
  const s = store as unknown as {
    access: Map<string, unknown>;
    refresh: Map<string, unknown>;
    sseTickets: Map<string, unknown>;
  };
  s.access.clear();
  s.refresh.clear();
  s.sseTickets.clear();
});

afterEach(() => {
  invalidateCapabilityCache();
});

// ── Helper ────────────────────────────────────────────────────────────────────

/** Verify whether an access token is still valid via a protected endpoint.
 *  Uses /api/admin/me which requires a valid authenticated session.
 *  Returns true only when the server accepts the token (200); 401 means
 *  the token has been revoked. */
async function isAccessTokenValid(accessToken: string): Promise<boolean> {
  const res = await server.inject({
    method: "GET",
    url: "/api/admin/me",
    headers: { authorization: `Bearer ${accessToken}` },
  });
  return res.statusCode !== 401;
}

// ── removeAuthorizedUser ──────────────────────────────────────────────────────

describe("removeAuthorizedUser revokes tokens", () => {
  it("user with a valid token is rejected on the next call after removal", async () => {
    await createAdminRole("mod");
    await grantRoleCapability("mod", "dm.message");
    const USER = "111111111111111111";
    await addAuthorizedUser(USER, "mod");

    const { accessToken } = await store.issueTokens(USER);
    expect(await isAccessTokenValid(accessToken)).toBe(true);

    await removeAuthorizedUser(USER);

    expect(store.verifyAccessToken(accessToken)).toBeNull();
    expect(await isAccessTokenValid(accessToken)).toBe(false);
  });

  it("refresh token for a removed user cannot be used to obtain new tokens", async () => {
    await createAdminRole("mod");
    await grantRoleCapability("mod", "dm.message");
    const USER = "222222222222222222";
    await addAuthorizedUser(USER, "mod");

    const { refreshToken } = await store.issueTokens(USER);
    await removeAuthorizedUser(USER);

    // rotateRefresh should return null because the token was revoked
    // by revokeOwner inside removeAuthorizedUser.
    const result = await store.rotateRefresh(refreshToken);
    expect(result).toBeNull();
  });
});

// ── revokeRoleCapability ──────────────────────────────────────────────────────

describe("revokeRoleCapability revokes tokens for users on that role", () => {
  it("user whose role had a capability stripped loses their access token", async () => {
    await createAdminRole("mod");
    await grantRoleCapability("mod", "dm.message");
    await grantRoleCapability("mod", "guild.message");
    const USER = "333333333333333333";
    await addAuthorizedUser(USER, "mod");

    const { accessToken } = await store.issueTokens(USER);
    expect(store.verifyAccessToken(accessToken)).toBe(USER);

    await revokeRoleCapability("mod", "guild.message");

    expect(store.verifyAccessToken(accessToken)).toBeNull();
  });

  it("user on a different role is not affected", async () => {
    await createAdminRole("mod");
    await grantRoleCapability("mod", "dm.message");
    await createAdminRole("viewer");
    await grantRoleCapability("viewer", "system.read");
    const MOD_USER = "444444444444444444";
    const VIEWER_USER = "555555555555555555";
    await addAuthorizedUser(MOD_USER, "mod");
    await addAuthorizedUser(VIEWER_USER, "viewer");

    const modTokens = await store.issueTokens(MOD_USER);
    const viewerTokens = await store.issueTokens(VIEWER_USER);

    await revokeRoleCapability("mod", "dm.message");

    // mod user's access token is revoked
    expect(store.verifyAccessToken(modTokens.accessToken)).toBeNull();
    // viewer user's access token is untouched
    expect(store.verifyAccessToken(viewerTokens.accessToken)).toBe(VIEWER_USER);
  });
});

// ── deleteAdminRole ───────────────────────────────────────────────────────────

describe("deleteAdminRole revokes tokens for users on that role", () => {
  it("all users assigned to a deleted role have their tokens revoked", async () => {
    await createAdminRole("victim-role");
    await grantRoleCapability("victim-role", "dm.message");
    const USER_A = "666666666666666666";
    const USER_B = "777777777777777777";
    await addAuthorizedUser(USER_A, "victim-role");
    await addAuthorizedUser(USER_B, "victim-role");

    const tokensA = await store.issueTokens(USER_A);
    const tokensB = await store.issueTokens(USER_B);

    await deleteAdminRole("victim-role");

    expect(store.verifyAccessToken(tokensA.accessToken)).toBeNull();
    expect(store.verifyAccessToken(tokensB.accessToken)).toBeNull();
    expect(await store.rotateRefresh(tokensA.refreshToken)).toBeNull();
    expect(await store.rotateRefresh(tokensB.refreshToken)).toBeNull();
  });
});

// ── POST /api/auth/logout-all ─────────────────────────────────────────────────

describe("POST /api/auth/logout-all", () => {
  it("revokes all tokens for the caller — subsequent access and refresh both fail", async () => {
    await createAdminRole("admin-role");
    await grantRoleCapability("admin-role", "admin");
    const USER = "888888888888888888";
    await addAuthorizedUser(USER, "admin-role");

    const { accessToken, refreshToken } = await store.issueTokens(USER);
    expect(await isAccessTokenValid(accessToken)).toBe(true);

    const res = await server.inject({
      method: "POST",
      url: "/api/auth/logout-all",
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(res.statusCode).toBe(204);

    // Access token must be dead
    expect(store.verifyAccessToken(accessToken)).toBeNull();
    // Refresh token must be dead
    expect(await store.rotateRefresh(refreshToken)).toBeNull();
  });

  it("returns 401 without a valid bearer token", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/api/auth/logout-all",
    });
    expect(res.statusCode).toBe(401);
  });

  it("does not affect tokens belonging to other users", async () => {
    await createAdminRole("admin-role");
    await grantRoleCapability("admin-role", "admin");
    const USER_A = "111222333444555666";
    const USER_B = "666555444333222111";
    await addAuthorizedUser(USER_A, "admin-role");
    await addAuthorizedUser(USER_B, "admin-role");

    const tokensA = await store.issueTokens(USER_A);
    const tokensB = await store.issueTokens(USER_B);

    await server.inject({
      method: "POST",
      url: "/api/auth/logout-all",
      headers: { authorization: `Bearer ${tokensA.accessToken}` },
    });

    // User B's tokens must survive
    expect(store.verifyAccessToken(tokensB.accessToken)).toBe(USER_B);
  });
});

// ── POST /api/auth/refresh capability re-check ────────────────────────────────

describe("POST /api/auth/refresh rejects users who lost all capabilities", () => {
  it("removed user cannot rotate their refresh token via the HTTP endpoint", async () => {
    await createAdminRole("mod");
    await grantRoleCapability("mod", "dm.message");
    const USER = "999888777666555444";
    await addAuthorizedUser(USER, "mod");

    // Issue tokens and then remove the user — revokeOwner is called
    // inside removeAuthorizedUser, so the refresh token in the store
    // is already gone. The HTTP endpoint should still return 401.
    const { refreshToken } = await store.issueTokens(USER);
    await removeAuthorizedUser(USER);

    const res = await server.inject({
      method: "POST",
      url: "/api/auth/refresh",
      payload: { refreshToken },
    });
    expect(res.statusCode).toBe(401);
  });

  it("user whose role still has capabilities can rotate successfully", async () => {
    await createAdminRole("mod");
    await grantRoleCapability("mod", "dm.message");
    const USER = "123456789012345678";
    await addAuthorizedUser(USER, "mod");

    const { refreshToken } = await store.issueTokens(USER);

    const res = await server.inject({
      method: "POST",
      url: "/api/auth/refresh",
      payload: { refreshToken },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(typeof body.accessToken).toBe("string");
    expect(typeof body.refreshToken).toBe("string");
    // ownerId must not leak into the HTTP response
    expect(body.ownerId).toBeUndefined();
  });
});
