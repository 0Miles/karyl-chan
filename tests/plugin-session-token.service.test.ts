import { describe, expect, it } from "vitest";
import {
  createHmac,
  createPublicKey,
  generateKeyPairSync,
  verify as cryptoVerify,
} from "crypto";
import {
  PluginSessionTokenService,
  type PluginSessionClaims,
} from "../src/modules/web-core/plugin-session-token.service.js";

function newKey() {
  return generateKeyPairSync("ed25519").privateKey;
}

function b64u(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf-8") : input;
  return buf
    .toString("base64")
    .replace(/=+$/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

const baseClaims: PluginSessionClaims = {
  userId: "user-1",
  guildId: "guild-1",
  capabilities: ["admin", "plugin:karyl-radio:webui.access"],
};

describe("PluginSessionTokenService", () => {
  it("round-trips claims via sign + verify", () => {
    const svc = new PluginSessionTokenService(newKey());
    const { token } = svc.sign(baseClaims, { ttlMs: 60_000 });
    expect(svc.verify(token)).toEqual(baseClaims);
  });

  it("preserves a null guildId (manage token)", () => {
    const svc = new PluginSessionTokenService(newKey());
    const { token } = svc.sign(
      { ...baseClaims, guildId: null },
      { ttlMs: 60_000 },
    );
    expect(svc.verify(token)).toEqual({ ...baseClaims, guildId: null });
  });

  it("honors the caller-supplied TTL", () => {
    const svc = new PluginSessionTokenService(newKey());
    const now = Date.now();
    const { expiresAt } = svc.sign(baseClaims, { ttlMs: 60_000, now });
    expect(expiresAt).toBe(now + 60_000);
  });

  it("rejects an expired token", () => {
    const svc = new PluginSessionTokenService(newKey());
    const now = Date.now();
    const { token } = svc.sign(baseClaims, { ttlMs: 1_000, now });
    expect(svc.verify(token, { now: now + 2_000 })).toBeNull();
  });

  it("rejects a token signed by a different key", () => {
    const issuer = new PluginSessionTokenService(newKey());
    const other = new PluginSessionTokenService(newKey());
    const { token } = issuer.sign(baseClaims, { ttlMs: 60_000 });
    expect(other.verify(token)).toBeNull();
  });

  it("rejects a tampered payload", () => {
    const svc = new PluginSessionTokenService(newKey());
    const { token } = svc.sign(baseClaims, { ttlMs: 60_000 });
    const [h, , s] = token.split(".");
    const forged = b64u(
      JSON.stringify({
        purpose: "plugin-session",
        userId: "user-1",
        guildId: "guild-1",
        capabilities: ["admin"],
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 60,
      }),
    );
    expect(svc.verify(`${h}.${forged}.${s}`)).toBeNull();
  });

  it("rejects an alg:none token", () => {
    const svc = new PluginSessionTokenService(newKey());
    const header = b64u(JSON.stringify({ alg: "none", typ: "JWT" }));
    const body = b64u(
      JSON.stringify({
        purpose: "plugin-session",
        userId: "attacker",
        guildId: null,
        capabilities: ["admin"],
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 60,
      }),
    );
    expect(svc.verify(`${header}.${body}.`)).toBeNull();
  });

  it("rejects an HS256 token forged with the public key as the secret (alg-confusion)", () => {
    const svc = new PluginSessionTokenService(newKey());
    const pubPem = svc.publicKeyPem();
    const header = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" }));
    const body = b64u(
      JSON.stringify({
        purpose: "plugin-session",
        userId: "attacker",
        guildId: null,
        capabilities: ["admin"],
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 60,
      }),
    );
    const sig = b64u(
      createHmac("sha256", pubPem).update(`${header}.${body}`).digest(),
    );
    expect(svc.verify(`${header}.${body}.${sig}`)).toBeNull();
  });

  it("rejects a non-Ed25519 signing key", () => {
    const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
    expect(() => new PluginSessionTokenService(rsa)).toThrow(/Ed25519/i);
  });

  it("emits tokens the matching public key verifies (the plugin-side path)", () => {
    const svc = new PluginSessionTokenService(newKey());
    const { token } = svc.sign(baseClaims, { ttlMs: 60_000 });
    const [h, b, s] = token.split(".");
    const pub = createPublicKey(svc.publicKeyPem());
    const ok = cryptoVerify(
      null,
      Buffer.from(`${h}.${b}`, "utf-8"),
      pub,
      Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64"),
    );
    expect(ok).toBe(true);
  });
});
