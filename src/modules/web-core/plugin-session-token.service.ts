import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as cryptoSign,
  verify as cryptoVerify,
  type KeyObject,
} from "crypto";
import { config } from "../../config.js";
import { moduleLogger } from "../../logger.js";

const log = moduleLogger("plugin-session-token");

/**
 * Asymmetric (Ed25519 / EdDSA) signer for `plugin-session` JWTs.
 *
 * Why a separate signer from {@link JwtService}:
 *   - Plugins need to *verify* these tokens on their own (the
 *     `capabilities` claim exists precisely so a plugin WebUI can do
 *     offline authorization without a round-trip to the bot). With the
 *     symmetric HS256 `JwtService`, "verify" implies "can also forge" —
 *     so handing a plugin the secret meant a compromised plugin could
 *     mint admin login tokens. EdDSA splits that: the bot holds the
 *     private key, plugins get only the public key (handed out in the
 *     `/api/plugins/register` response), and a compromised plugin
 *     learns nothing it can sign with.
 *   - `JWT_SECRET` therefore never leaves the bot. The bot's own
 *     short-lived flows (login links, etc.) keep using `JwtService`
 *     unchanged.
 *
 * Token shape (compact JWS): header `{ alg: "EdDSA", typ: "JWT" }`,
 * payload `{ purpose: "plugin-session", userId, guildId, capabilities,
 * iat, exp }`. Stateless — a token validates iff its EdDSA signature
 * checks out, `purpose` matches, and `exp` hasn't passed.
 *
 * Key material:
 *   - `PLUGIN_SESSION_SIGNING_KEY` — a PKCS#8 Ed25519 private key, given
 *     as base64-encoded DER (single line, preferred) or PEM. Production
 *     should always set this so tokens outlive a bot restart.
 *   - Unset (dev/test): an ephemeral key is generated and a warning is
 *     logged once (outstanding tokens won't survive a restart). Mirrors
 *     `JwtService`'s `JWT_SECRET` fallback.
 */

const PURPOSE = "plugin-session";

export interface PluginSessionClaims {
  /** Discord user id this token authorizes. */
  userId: string;
  /** Playback-session guild scope, or null for non-guild (`manage`) tokens. */
  guildId: string | null;
  /**
   * The user's `admin` + `plugin:<key>:*` capability subset, snapshotted
   * at mint time. `manage` tokens carry the relevant grants; `session`
   * tokens carry an empty array (authorized purely by `guildId`).
   */
  capabilities: string[];
}

interface SignedPayload extends PluginSessionClaims {
  purpose: typeof PURPOSE;
  /** Issued-at, seconds since epoch (RFC 7519 `iat`). */
  iat: number;
  /** Expiration, seconds since epoch (RFC 7519 `exp`). */
  exp: number;
}

export interface SignOptions {
  /** Token lifetime in ms. Required — callers know their own policy. */
  ttlMs: number;
  /** Override `now` for tests. */
  now?: number;
}

export interface VerifyOptions {
  /** Override `now` for tests. */
  now?: number;
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
  // A base64(url) string can never be 1 mod 4 chars long — reject rather
  // than let Buffer.from silently produce garbage.
  if (input.length % 4 === 1) throw new Error("invalid base64url length");
  const padded =
    input.replace(/-/g, "+").replace(/_/g, "/") +
    "=".repeat((4 - (input.length % 4)) % 4);
  return Buffer.from(padded, "base64");
}

export class PluginSessionTokenService {
  private readonly publicKey: KeyObject;
  /** SPKI-PEM form of the public key, cached (handed to plugins). */
  private readonly publicKeyPemCache: string;

  constructor(private readonly privateKey: KeyObject) {
    if (privateKey.asymmetricKeyType !== "ed25519") {
      throw new Error(
        `plugin-session signing key must be Ed25519 (got ${privateKey.asymmetricKeyType ?? "unknown"})`,
      );
    }
    this.publicKey = createPublicKey(privateKey);
    this.publicKeyPemCache = this.publicKey
      .export({ type: "spki", format: "pem" })
      .toString();
  }

  /** SPKI PEM the bot hands to plugins so they can verify these tokens. */
  publicKeyPem(): string {
    return this.publicKeyPemCache;
  }

  sign(
    claims: PluginSessionClaims,
    options: SignOptions,
  ): { token: string; expiresAt: number } {
    if (!claims.userId) {
      throw new Error("plugin-session token requires a userId");
    }
    const now = options.now ?? Date.now();
    const expiresAt = now + options.ttlMs;
    const payload: SignedPayload = {
      purpose: PURPOSE,
      userId: claims.userId,
      guildId: claims.guildId,
      capabilities: claims.capabilities,
      iat: Math.floor(now / 1000),
      exp: Math.floor(expiresAt / 1000),
    };
    const headerSeg = base64urlEncode(
      JSON.stringify({ alg: "EdDSA", typ: "JWT" }),
    );
    const bodySeg = base64urlEncode(JSON.stringify(payload));
    const signingInput = `${headerSeg}.${bodySeg}`;
    // Ed25519: the algorithm argument to crypto.sign MUST be null —
    // the hash is baked into the scheme.
    const signatureSeg = base64urlEncode(
      cryptoSign(null, Buffer.from(signingInput, "utf-8"), this.privateKey),
    );
    return { token: `${signingInput}.${signatureSeg}`, expiresAt };
  }

  /**
   * Verify a token we issued. Mainly for tests and bot-internal callers —
   * plugins verify with the public key on their own side. Returns the
   * claims, or null on any failure (bad signature, wrong alg, expired,
   * malformed, wrong purpose).
   */
  verify(token: string, options: VerifyOptions = {}): PluginSessionClaims | null {
    const now = options.now ?? Date.now();
    if (typeof token !== "string") return null;
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [headerSeg, bodySeg, signatureSeg] = parts;

    // Header first: reject anything that isn't our exact EdDSA header so
    // an attacker can't downgrade to `alg: none` or to HMAC-with-the-
    // public-key (the classic asymmetric→symmetric confusion).
    let header: unknown;
    try {
      header = JSON.parse(base64urlDecode(headerSeg).toString("utf-8"));
    } catch {
      return null;
    }
    if (!header || typeof header !== "object") return null;
    const h = header as Record<string, unknown>;
    if (h.alg !== "EdDSA" || h.typ !== "JWT") return null;

    let signature: Buffer;
    try {
      signature = base64urlDecode(signatureSeg);
    } catch {
      return null;
    }
    const verified = cryptoVerify(
      null,
      Buffer.from(`${headerSeg}.${bodySeg}`, "utf-8"),
      this.publicKey,
      signature,
    );
    if (!verified) return null;

    let body: unknown;
    try {
      body = JSON.parse(base64urlDecode(bodySeg).toString("utf-8"));
    } catch {
      return null;
    }
    if (!body || typeof body !== "object") return null;
    const p = body as Record<string, unknown>;
    if (p.purpose !== PURPOSE) return null;
    if (typeof p.exp !== "number" || p.exp * 1000 <= now) return null;
    if (typeof p.userId !== "string" || !p.userId) return null;
    if (p.guildId !== null && typeof p.guildId !== "string") return null;
    if (
      !Array.isArray(p.capabilities) ||
      !p.capabilities.every((c) => typeof c === "string")
    ) {
      return null;
    }
    return {
      userId: p.userId,
      guildId: p.guildId as string | null,
      capabilities: p.capabilities as string[],
    };
  }
}

function parseConfiguredKey(value: string): KeyObject {
  const trimmed = value.trim();
  // PEM (may arrive with literal "\n" if the env-file parser didn't
  // expand escapes) — createPrivateKey takes the string directly. Use a
  // strict prefix test so a base64-DER blob that happens to contain the
  // substring "BEGIN" isn't misrouted here.
  if (/^-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/.test(trimmed)) {
    return createPrivateKey(trimmed.replace(/\\n/g, "\n"));
  }
  // Otherwise: base64-encoded PKCS#8 DER (single line, the form the
  // .env.example tells admins to generate).
  return createPrivateKey({
    key: Buffer.from(trimmed, "base64"),
    format: "der",
    type: "pkcs8",
  });
}

function loadSigningKey(): KeyObject {
  const configured = config.plugin.sessionSigningKey;
  if (configured) {
    let key: KeyObject;
    try {
      key = parseConfiguredKey(configured);
    } catch (err) {
      throw new Error(
        `PLUGIN_SESSION_SIGNING_KEY is not a valid Ed25519 private key (PEM or base64 PKCS#8 DER): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (key.asymmetricKeyType !== "ed25519") {
      throw new Error(
        `PLUGIN_SESSION_SIGNING_KEY must be an Ed25519 key (got ${key.asymmetricKeyType ?? "unknown"})`,
      );
    }
    return key;
  }
  log.warn(
    "PLUGIN_SESSION_SIGNING_KEY not set — generating an ephemeral Ed25519 key. " +
      "plugin-session tokens (e.g. the radio WebUI links) won't survive a bot restart. " +
      "Set it in production: openssl genpkey -algorithm ed25519 -outform DER 2>/dev/null | base64 -w0",
  );
  const { privateKey } = generateKeyPairSync("ed25519");
  return privateKey;
}

export const pluginSessionTokenService = new PluginSessionTokenService(
  loadSigningKey(),
);
