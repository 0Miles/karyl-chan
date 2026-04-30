import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "crypto";
import { moduleLogger } from "../logger.js";

const log = moduleLogger("crypto");
const ALGO = "aes-256-gcm";
const ENC_VERSION_V2 = "v2";
const IV_BYTES = 12;
const KEY_BYTES = 32;

interface EncKey {
  /** First 8 hex chars of sha256(key) — embedded in v2 ciphertext so
   *  we can pick the right key on decrypt during a rotation window. */
  id: string;
  bytes: Buffer;
}

function parseKeys(raw: string): EncKey[] {
  const hexes = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (hexes.length === 0) {
    throw new Error("ENCRYPTION_KEY contains no usable key");
  }
  return hexes.map((hex) => {
    const bytes = Buffer.from(hex, "hex");
    if (bytes.length !== KEY_BYTES) {
      throw new Error(
        `encryption key must be ${KEY_BYTES} bytes (${KEY_BYTES * 2} hex chars)`,
      );
    }
    const id = createHash("sha256").update(bytes).digest("hex").slice(0, 8);
    return { id, bytes };
  });
}

/**
 * Load every configured encryption key. Comma-separated to support
 * rotation: the FIRST key is the active writer (new ciphertext is
 * sealed with it), and any other listed key still decrypts existing
 * rows. To rotate: prepend a new key, deploy, run a re-encrypt sweep
 * over stored ciphertexts, then drop the old key on the next deploy.
 */
function getKeys(): EncKey[] {
  // Read directly from process.env on every call so key rotation (prepending
  // a new key to ENCRYPTION_KEY) takes effect without a restart. This is an
  // intentional exception to the "read env via config singleton" rule: the
  // key set is operationally changed at runtime and must be re-read each call.
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "ENCRYPTION_KEY is not set. Generate one with: openssl rand -hex 32",
    );
  }
  return parseKeys(raw);
}

export function encryptSecret(plaintext: string): string {
  const [active] = getKeys();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, active.bytes, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    ENC_VERSION_V2,
    active.id,
    iv.toString("base64"),
    tag.toString("base64"),
    ct.toString("base64"),
  ].join(":");
}

function decryptWith(
  keyBytes: Buffer,
  ivB64: string,
  tagB64: string,
  ctB64: string,
): string {
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const ct = Buffer.from(ctB64, "base64");
  const decipher = createDecipheriv(ALGO, keyBytes, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString(
    "utf8",
  );
}

export function decryptSecret(value: string): string {
  const keys = getKeys();
  if (value.startsWith(`${ENC_VERSION_V2}:`)) {
    const parts = value.split(":");
    if (parts.length !== 5)
      throw new Error("Invalid v2 encrypted value format");
    const [, keyId, ivB64, tagB64, ctB64] = parts;
    const key = keys.find((k) => k.id === keyId);
    if (!key)
      throw new Error(
        `unknown encryption key id ${keyId} — was the key rotated out?`,
      );
    return decryptWith(key.bytes, ivB64, tagB64, ctB64);
  }
  // v0 plaintext and v1 ciphertext are no longer supported. Run the
  // encryption-v2-uplift migration to backfill all stored values.
  log.error(
    { prefix: value.slice(0, 8) },
    "decryptSecret: unknown encryption format detected; run migration 20260430030000-encryption-v2-uplift",
  );
  throw new Error(
    "unknown encryption format; run migration 20260430030000-encryption-v2-uplift",
  );
}
