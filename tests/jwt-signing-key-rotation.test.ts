import { vi, describe, it, expect, beforeAll, beforeEach } from "vitest";

vi.hoisted(() => {
  process.env.SQLITE_DB_PATH = ":memory:";
  process.env.NODE_ENV = "test";
  // Needed so encryptSecret/decryptSecret work — the key store encrypts
  // the private key at rest.
  process.env.ENCRYPTION_KEY = "a".repeat(64);
});

import { sequelize } from "../src/db.js";
import {
  jwtService,
  initJwtSigningAuthority,
  rotateJwtSigningKey,
  getJwtPublicKeyInfo,
  type JwtClaims,
} from "../src/modules/web-core/jwt.service.js";
import {
  getActiveJwtSigningKey,
  JwtSigningKey,
} from "../src/modules/web-core/models/jwt-signing-key.model.js";

const claims: JwtClaims = {
  purpose: "login",
  userId: "user-1",
  guildId: null,
  channelId: "c",
  messageId: "m",
};

beforeAll(async () => {
  await sequelize.sync({ force: true });
  // sequelize.sync() creates the table from the model but not the
  // partial unique index (that lives only in the migration) — recreate
  // it here so the "exactly one active row" DB constraint is exercised.
  await sequelize.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS jwt_signing_keys_one_active
       ON jwt_signing_keys (active) WHERE active = 1;`,
  );
});

beforeEach(async () => {
  await JwtSigningKey.destroy({ where: {} });
});

describe("JWT signing key — DB-backed lifecycle", () => {
  it("generates + persists a key on a fresh DB", async () => {
    expect(await getActiveJwtSigningKey()).toBeNull();
    await initJwtSigningAuthority();
    const row = await getActiveJwtSigningKey();
    expect(row).not.toBeNull();
    expect(row!.algorithm).toBe("ed25519");
    expect(row!.active).toBe(true);
    expect(row!.publicKeyPem).toMatch(/^-----BEGIN PUBLIC KEY-----/);
    // The encrypted private key is not the cleartext PEM.
    expect(row!.privateKeyEnc).not.toContain("PRIVATE KEY");
    // jwtService now signs verifiable tokens.
    const { token } = jwtService.sign(claims);
    expect(jwtService.verify(token)).toEqual(claims);
  });

  it("reuses the persisted key across init() calls (simulated restart)", async () => {
    await initJwtSigningAuthority();
    const pem1 = jwtService.publicKeyPem();
    const { token } = jwtService.sign(claims);
    // A second init() (e.g. a process restart) loads the same row.
    await initJwtSigningAuthority();
    expect(jwtService.publicKeyPem()).toBe(pem1);
    // Token issued before the "restart" still verifies.
    expect(jwtService.verify(token)).toEqual(claims);
  });

  it("rotate() swaps in a fresh key and invalidates old tokens", async () => {
    await initJwtSigningAuthority();
    const oldPem = jwtService.publicKeyPem();
    const { token: oldToken } = jwtService.sign(claims);
    expect(jwtService.verify(oldToken)).toEqual(claims);

    const { publicKeyPem: newPem } = await rotateJwtSigningKey();
    expect(newPem).not.toBe(oldPem);
    expect(jwtService.publicKeyPem()).toBe(newPem);
    // Old token no longer verifies under the new key.
    expect(jwtService.verify(oldToken)).toBeNull();
    // A fresh token does.
    const { token: newToken } = jwtService.sign(claims);
    expect(jwtService.verify(newToken)).toEqual(claims);

    // Exactly one active row, and it's the new one.
    const active = await JwtSigningKey.findAll({ where: { active: true } });
    expect(active).toHaveLength(1);
    expect((await getActiveJwtSigningKey())!.publicKeyPem).toBe(newPem);
    // The old row is retained but inactive.
    expect(await JwtSigningKey.count()).toBe(2);
  });

  it("getJwtPublicKeyInfo() reflects the active key", async () => {
    await initJwtSigningAuthority();
    const info = await getJwtPublicKeyInfo();
    expect(info.algorithm).toBe("ed25519");
    expect(info.persisted).toBe(true);
    expect(info.publicKeyPem).toBe(jwtService.publicKeyPem());
    expect(info.createdAt).toBeInstanceOf(Date);
  });

  it("the DB rejects a second active row (partial unique index)", async () => {
    await initJwtSigningAuthority(); // inserts one active row
    await expect(
      JwtSigningKey.create({
        algorithm: "ed25519",
        privateKeyEnc: "x",
        publicKeyPem: "y",
        active: true,
      }),
    ).rejects.toThrow();
    // Still exactly one active row.
    expect(await JwtSigningKey.count({ where: { active: true } })).toBe(1);
  });
});
