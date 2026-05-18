import { describe, expect, it } from "vitest";
import {
  createHmac,
  createPublicKey,
  generateKeyPairSync,
  verify as cryptoVerify,
} from "crypto";
import {
  JwtService,
  type JwtClaims,
} from "../src/modules/web-core/jwt.service.js";

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

const loginClaims: JwtClaims = {
  purpose: "login",
  userId: "user-1",
  guildId: "guild-1",
  channelId: "channel-1",
  messageId: "message-1",
};

const sessionClaims: JwtClaims = {
  purpose: "plugin-session",
  userId: "user-1",
  guildId: "guild-1",
  capabilities: ["admin", "plugin:karyl-radio:manage"],
};

describe("JwtService (Ed25519)", () => {
  it("round-trips login claims via sign + verify", () => {
    const svc = new JwtService(newKey());
    const { token } = svc.sign(loginClaims);
    expect(svc.verify(token)).toEqual(loginClaims);
  });

  it("round-trips plugin-session claims (capabilities, no channel/message)", () => {
    const svc = new JwtService(newKey());
    const { token } = svc.sign(sessionClaims, { ttlMs: 60_000 });
    expect(svc.verify(token)).toEqual(sessionClaims);
  });

  it("preserves a null guildId (DM context)", () => {
    const svc = new JwtService(newKey());
    const { token } = svc.sign({ ...loginClaims, guildId: null });
    expect(svc.verify(token)).toEqual({ ...loginClaims, guildId: null });
  });

  it("defaults to a 5-minute TTL", () => {
    const svc = new JwtService(newKey());
    const now = Date.now();
    const { expiresAt } = svc.sign(loginClaims, { now });
    expect(expiresAt).toBe(now + 5 * 60 * 1000);
  });

  it("honors a caller-supplied TTL", () => {
    const svc = new JwtService(newKey());
    const now = Date.now();
    const { token, expiresAt } = svc.sign(loginClaims, { now, ttlMs: 60_000 });
    expect(expiresAt).toBe(now + 60_000);
    expect(svc.verify(token, { now: now + 30_000 })).toEqual(loginClaims);
    expect(svc.verify(token, { now: now + 61_000 })).toBeNull();
  });

  it("rejects tokens past their exp", () => {
    const svc = new JwtService(newKey());
    const now = Date.now();
    const { token } = svc.sign(loginClaims, { now });
    expect(svc.verify(token, { now: now + 6 * 60 * 1000 })).toBeNull();
  });

  it("rejects tokens signed with a different key", () => {
    const issuer = new JwtService(newKey());
    const verifier = new JwtService(newKey());
    const { token } = issuer.sign(loginClaims);
    expect(verifier.verify(token)).toBeNull();
  });

  it("rejects tokens whose signature has been tampered with", () => {
    const svc = new JwtService(newKey());
    const { token } = svc.sign(loginClaims);
    const [h, b, sig] = token.split(".");
    const flipped = sig[0] === "A" ? "B" + sig.slice(1) : "A" + sig.slice(1);
    expect(svc.verify(`${h}.${b}.${flipped}`)).toBeNull();
  });

  it("rejects tokens whose body has been tampered with", () => {
    const svc = new JwtService(newKey());
    const { token } = svc.sign(loginClaims);
    const [h, , sig] = token.split(".");
    const forgedBody = b64u(
      JSON.stringify({
        ...loginClaims,
        userId: "attacker",
        iat: 0,
        exp: Math.floor(Date.now() / 1000) + 60,
      }),
    );
    expect(svc.verify(`${h}.${forgedBody}.${sig}`)).toBeNull();
  });

  it("rejects an `alg: none` confusion attempt", () => {
    const svc = new JwtService(newKey());
    const header = b64u(JSON.stringify({ alg: "none", typ: "JWT" }));
    const body = b64u(
      JSON.stringify({
        ...loginClaims,
        iat: 0,
        exp: Math.floor(Date.now() / 1000) + 60,
      }),
    );
    expect(svc.verify(`${header}.${body}.`)).toBeNull();
  });

  it("rejects an HS256 token forged with the public key PEM as the HMAC secret", () => {
    const svc = new JwtService(newKey());
    const pubPem = svc.publicKeyPem();
    const header = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" }));
    const body = b64u(
      JSON.stringify({
        ...loginClaims,
        userId: "attacker",
        iat: 0,
        exp: Math.floor(Date.now() / 1000) + 60,
      }),
    );
    const sig = b64u(
      createHmac("sha256", pubPem).update(`${header}.${body}`).digest(),
    );
    expect(svc.verify(`${header}.${body}.${sig}`)).toBeNull();
  });

  it("rejects malformed tokens", () => {
    const svc = new JwtService(newKey());
    expect(svc.verify("")).toBeNull();
    expect(svc.verify("not.a.jwt.shape")).toBeNull();
    expect(svc.verify("only-one-segment")).toBeNull();
    expect(svc.verify("a.b.c")).toBeNull();
  });

  it("refuses to construct with a non-Ed25519 key", () => {
    const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
    expect(() => new JwtService(rsa)).toThrow(/Ed25519/i);
  });

  it("refuses to sign without a userId", () => {
    const svc = new JwtService(newKey());
    expect(() => svc.sign({ ...loginClaims, userId: "" })).toThrow();
  });

  it("publicKeyPem() verifies tokens this service issues", () => {
    const svc = new JwtService(newKey());
    const { token } = svc.sign(loginClaims);
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

  describe("purpose", () => {
    it("round-trips the purpose claim", () => {
      const svc = new JwtService(newKey());
      const { token } = svc.sign({ ...loginClaims, purpose: "link-account" });
      expect(svc.verify(token)?.purpose).toBe("link-account");
    });

    it("refuses to sign without a purpose", () => {
      const svc = new JwtService(newKey());
      expect(() => svc.sign({ ...loginClaims, purpose: "" })).toThrow();
    });

    it("verify(purpose) accepts matching tokens", () => {
      const svc = new JwtService(newKey());
      const { token } = svc.sign(loginClaims);
      expect(svc.verify(token, { purpose: "login" })).toEqual(loginClaims);
    });

    it("verify(purpose) rejects mismatching tokens", () => {
      const svc = new JwtService(newKey());
      const { token } = svc.sign({ ...loginClaims, purpose: "link-account" });
      expect(svc.verify(token, { purpose: "login" })).toBeNull();
      expect(svc.verify(token)).not.toBeNull();
    });
  });
});
