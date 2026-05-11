import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { config } from "../../config.js";
import { moduleLogger } from "../../logger.js";

const log = moduleLogger("jwt");

const DEFAULT_TTL_MS = config.jwt.loginLinkTtlMs;

/**
 * Claims carried inside a JWT issued by this service — the
 * `messageCreate` event that triggered issuance fully describes itself
 * so the consuming endpoint can apply policy decisions (re-check role,
 * audit which message produced the action) without keeping any
 * server-side state.
 *
 * `purpose` is a free-form tag (e.g., `login`, `link-account`) that
 * tells the verifier what this token is allowed to do; verify() can
 * require a specific value so a token minted for one purpose cannot be
 * presented at a different endpoint. `guildId` is null when the
 * trigger came from a DM channel.
 */
export interface JwtClaims {
  purpose: string;
  userId: string;
  guildId: string | null;
  channelId: string;
  messageId: string;
}

interface SignedPayload extends JwtClaims {
  /** Issued-at, seconds since epoch (RFC 7519 `iat`). */
  iat: number;
  /** Expiration, seconds since epoch (RFC 7519 `exp`). */
  exp: number;
}

export interface SignOptions {
  /** Token lifetime in ms. Defaults to 5 minutes. */
  ttlMs?: number;
  /** Override `now` for tests. */
  now?: number;
}

export interface VerifyOptions {
  /** Override `now` for tests. */
  now?: number;
  /** When set, reject tokens whose `purpose` claim doesn't match. */
  purpose?: string;
}

function base64urlEncode(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf-8") : input;
  return buf
    .toString("base64")
    .replace(/=+$/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function base64urlDecode(input: string): Buffer {
  if (!/^[A-Za-z0-9_-]*$/.test(input)) throw new Error("invalid base64url");
  const padded =
    input.replace(/-/g, "+").replace(/_/g, "/") +
    "=".repeat((4 - (input.length % 4)) % 4);
  return Buffer.from(padded, "base64");
}

/**
 * Issue + verify HS256 JWTs for short-lived flows like the bot login
 * link. Stateless: a token validates iff its signature checks out and
 * its `exp` hasn't passed — no server memory required.
 *
 * The service holds a single HMAC secret. In production this should
 * come from `JWT_SECRET`; for tests / dev-without-config the singleton
 * factory below falls back to an ephemeral random secret (warns once
 * since it invalidates outstanding tokens on restart).
 */
export class JwtService {
  constructor(private readonly secret: Buffer) {
    if (secret.length < 32) {
      throw new Error("JWT secret must be at least 32 bytes");
    }
  }

  sign(
    claims: JwtClaims,
    options: SignOptions = {},
  ): { token: string; expiresAt: number } {
    if (!claims.purpose) {
      throw new Error("JWT purpose is required");
    }
    const now = options.now ?? Date.now();
    const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    const expiresAt = now + ttlMs;
    const payload: SignedPayload = {
      ...claims,
      iat: Math.floor(now / 1000),
      exp: Math.floor(expiresAt / 1000),
    };
    const headerSeg = base64urlEncode(
      JSON.stringify({ alg: "HS256", typ: "JWT" }),
    );
    const bodySeg = base64urlEncode(JSON.stringify(payload));
    const signingInput = `${headerSeg}.${bodySeg}`;
    const signatureSeg = base64urlEncode(
      createHmac("sha256", this.secret).update(signingInput).digest(),
    );
    return { token: `${signingInput}.${signatureSeg}`, expiresAt };
  }

  verify(token: string, options: VerifyOptions = {}): JwtClaims | null {
    const now = options.now ?? Date.now();
    if (typeof token !== "string") return null;
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [headerSeg, bodySeg, signatureSeg] = parts;

    // Constant-time signature check first — short-circuiting on
    // payload before signature would leak header/body validity to
    // attackers probing for soft spots.
    const expected = createHmac("sha256", this.secret)
      .update(`${headerSeg}.${bodySeg}`)
      .digest();
    let provided: Buffer;
    try {
      provided = base64urlDecode(signatureSeg);
    } catch {
      return null;
    }
    if (provided.length !== expected.length) return null;
    if (!timingSafeEqual(provided, expected)) return null;

    // Header sanity. We only ever issue HS256 so reject anything else
    // outright — guards against the classic `alg: none` confusion.
    let header: unknown;
    try {
      header = JSON.parse(base64urlDecode(headerSeg).toString("utf-8"));
    } catch {
      return null;
    }
    if (!header || typeof header !== "object") return null;
    const h = header as Record<string, unknown>;
    if (h.alg !== "HS256" || h.typ !== "JWT") return null;

    let body: unknown;
    try {
      body = JSON.parse(base64urlDecode(bodySeg).toString("utf-8"));
    } catch {
      return null;
    }
    if (!body || typeof body !== "object") return null;
    const p = body as Record<string, unknown>;

    if (typeof p.exp !== "number" || p.exp * 1000 <= now) return null;
    if (typeof p.purpose !== "string" || !p.purpose) return null;
    if (typeof p.userId !== "string" || !p.userId) return null;
    if (typeof p.channelId !== "string" || !p.channelId) return null;
    if (typeof p.messageId !== "string" || !p.messageId) return null;
    if (p.guildId !== null && typeof p.guildId !== "string") return null;

    // Purpose check is stricter than the structural ones — a token
    // minted for one flow (e.g., 'login') must not be presented at
    // an endpoint expecting another (e.g., 'link-account').
    if (options.purpose !== undefined && p.purpose !== options.purpose)
      return null;

    return {
      purpose: p.purpose,
      userId: p.userId,
      guildId: p.guildId as string | null,
      channelId: p.channelId,
      messageId: p.messageId,
    };
  }
}

function loadSecret(): Buffer {
  const secret = config.jwt.secret;
  if (secret) return Buffer.from(secret, "utf-8");
  // Dev/test fallback. Tokens are short-lived (5 min) so losing them
  // on restart is acceptable, but production should always set the
  // env var so tokens issued before a restart still validate after it.
  log.warn(
    "JWT_SECRET not set — using ephemeral random secret. Outstanding login links will not survive a restart.",
  );
  return randomBytes(64);
}

export const jwtService = new JwtService(loadSecret());
