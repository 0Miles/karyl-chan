import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "crypto";
import { QueryTypes } from "sequelize";
import type { Migration } from "./runner.js";

/**
 * One-time encryption v2 uplift.
 *
 * Backfills every encrypted-at-rest column from v0 plaintext / v1
 * ciphertext (no keyId) to the v2 format (`v2:<keyId>:<iv>:<tag>:<ct>`).
 *
 * After this migration runs, `decryptSecret` in crypto.ts no longer
 * accepts v0 or v1 values — it throws immediately on unknown formats.
 *
 * Affected tables / columns:
 *   behaviors              — webhookUrl, webhookSecret
 *   RconForwardChannels    — password
 *   plugin_configs         — value  (source='admin', secret-typed keys)
 *   plugin_guild_features  — configJson (secret-typed keys per manifest)
 *
 * Idempotent: v2 values are skipped; fresh DBs with no rows are no-ops.
 */

// ── local crypto helpers (self-contained, no import from src/utils) ──

const ALGO = "aes-256-gcm";
const IV_BYTES = 12;
const KEY_BYTES = 32;

interface EncKey {
  id: string;
  bytes: Buffer;
}

function loadKeys(): EncKey[] {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) throw new Error("ENCRYPTION_KEY is not set");
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((hex) => {
      const bytes = Buffer.from(hex, "hex");
      if (bytes.length !== KEY_BYTES)
        throw new Error(
          `encryption key must be ${KEY_BYTES} bytes (${KEY_BYTES * 2} hex chars)`,
        );
      const id = createHash("sha256").update(bytes).digest("hex").slice(0, 8);
      return { id, bytes };
    });
}

function encryptV2(plaintext: string, key: EncKey): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key.bytes, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v2", key.id, iv.toString("base64"), tag.toString("base64"), ct.toString("base64")].join(":");
}

function decryptV2(value: string, keys: EncKey[]): string {
  const parts = value.split(":");
  if (parts.length !== 5) throw new Error("Invalid v2 encrypted value format");
  const [, keyId, ivB64, tagB64, ctB64] = parts;
  const key = keys.find((k) => k.id === keyId);
  if (!key) throw new Error(`unknown key id ${keyId}`);
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const ct = Buffer.from(ctB64, "base64");
  const decipher = createDecipheriv(ALGO, key.bytes, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

/** v1: `v1:<iv>:<tag>:<ct>` — no keyId, brute-force all keys */
function decryptV1(value: string, keys: EncKey[]): string {
  const parts = value.split(":");
  if (parts.length !== 4) throw new Error("Invalid v1 encrypted value format");
  const [, ivB64, tagB64, ctB64] = parts;
  for (const key of keys) {
    try {
      const iv = Buffer.from(ivB64, "base64");
      const tag = Buffer.from(tagB64, "base64");
      const ct = Buffer.from(ctB64, "base64");
      const decipher = createDecipheriv(ALGO, key.bytes, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
    } catch {
      /* GCM auth tag mismatch — try next key */
    }
  }
  throw new Error("v1 ciphertext does not decrypt with any configured key");
}

/**
 * Uplift a single stored value to v2.
 * Returns null when no change is needed (already v2 or null/empty).
 */
function upliftValue(raw: string | null | undefined, keys: EncKey[]): string | null {
  if (!raw || raw.length === 0) return null;
  if (raw.startsWith("v2:")) return null; // already v2, skip

  let plaintext: string;
  if (raw.startsWith("v1:")) {
    plaintext = decryptV1(raw, keys);
  } else {
    // v0 — raw plaintext
    plaintext = raw;
  }
  return encryptV2(plaintext, keys[0]);
}

// ── migration body ────────────────────────────────────────────────────

const migration: Migration = {
  up: async ({ queryInterface }) => {
    const keys = loadKeys();
    const tables = await queryInterface.showAllTables();

    // ── 1. behaviors: webhookUrl + webhookSecret ──────────────────────
    if (tables.includes("behaviors")) {
      const rows = (await queryInterface.sequelize.query(
        `SELECT id, webhookUrl, webhookSecret FROM behaviors`,
        { type: QueryTypes.SELECT },
      )) as Array<{ id: number; webhookUrl: string | null; webhookSecret: string | null }>;

      for (const row of rows) {
        const newUrl = upliftValue(row.webhookUrl, keys);
        const newSecret = upliftValue(row.webhookSecret, keys);
        if (newUrl !== null || newSecret !== null) {
          const setClauses: string[] = [];
          const params: unknown[] = [];
          if (newUrl !== null) {
            setClauses.push("webhookUrl = ?");
            params.push(newUrl);
          }
          if (newSecret !== null) {
            setClauses.push("webhookSecret = ?");
            params.push(newSecret);
          }
          params.push(row.id);
          await queryInterface.sequelize.query(
            `UPDATE behaviors SET ${setClauses.join(", ")} WHERE id = ?`,
            { replacements: params },
          );
        }
      }
    }

    // ── 2. RconForwardChannels: password ─────────────────────────────
    if (tables.includes("RconForwardChannels")) {
      const rows = (await queryInterface.sequelize.query(
        `SELECT channelId, guildId, password FROM "RconForwardChannels"`,
        { type: QueryTypes.SELECT },
      )) as Array<{ channelId: string; guildId: string; password: string | null }>;

      for (const row of rows) {
        const newPassword = upliftValue(row.password, keys);
        if (newPassword !== null) {
          await queryInterface.sequelize.query(
            `UPDATE "RconForwardChannels" SET password = ? WHERE channelId = ? AND guildId = ?`,
            { replacements: [newPassword, row.channelId, row.guildId] },
          );
        }
      }
    }

    // ── 3. plugin_configs: value (source='admin', secret-typed keys) ──
    if (tables.includes("plugin_configs") && tables.includes("plugins")) {
      // Fetch admin-source rows alongside their plugin's manifestJson
      const rows = (await queryInterface.sequelize.query(
        `SELECT pc.id, pc.key, pc.value, p.manifestJson
           FROM plugin_configs pc
           JOIN plugins p ON p.id = pc.pluginId
          WHERE pc.source = 'admin'`,
        { type: QueryTypes.SELECT },
      )) as Array<{ id: number; key: string; value: string; manifestJson: string }>;

      for (const row of rows) {
        // Only uplift if the field is declared as secret in the manifest
        let isSecret = false;
        try {
          const manifest = JSON.parse(row.manifestJson) as {
            config_schema?: Array<{ key: string; type: string }>;
          };
          const field = (manifest.config_schema ?? []).find(
            (f) => f.key === row.key,
          );
          isSecret = field?.type === "secret";
        } catch {
          // Unparseable manifest — skip, conservative
        }
        if (!isSecret) continue;

        const newValue = upliftValue(row.value, keys);
        if (newValue !== null) {
          await queryInterface.sequelize.query(
            `UPDATE plugin_configs SET value = ? WHERE id = ?`,
            { replacements: [newValue, row.id] },
          );
        }
      }
    }

    // ── 4. plugin_guild_features: configJson secret-typed keys ────────
    if (tables.includes("plugin_guild_features") && tables.includes("plugins")) {
      const rows = (await queryInterface.sequelize.query(
        `SELECT pgf.id, pgf.configJson, p.manifestJson, pgf.featureKey
           FROM plugin_guild_features pgf
           JOIN plugins p ON p.id = pgf.pluginId`,
        { type: QueryTypes.SELECT },
      )) as Array<{ id: number; configJson: string; manifestJson: string; featureKey: string }>;

      for (const row of rows) {
        let config: Record<string, unknown>;
        try {
          config = JSON.parse(row.configJson) as Record<string, unknown>;
        } catch {
          continue; // unparseable JSON — skip
        }

        // Determine which keys are secret-typed for this featureKey
        let secretKeys: Set<string> = new Set();
        try {
          const manifest = JSON.parse(row.manifestJson) as {
            features?: Array<{
              key: string;
              config_schema?: Array<{ key: string; type: string }>;
            }>;
          };
          const feature = (manifest.features ?? []).find(
            (f) => f.key === row.featureKey,
          );
          for (const field of feature?.config_schema ?? []) {
            if (field.type === "secret") secretKeys.add(field.key);
          }
        } catch {
          continue; // unparseable manifest — skip
        }

        if (secretKeys.size === 0) continue;

        let changed = false;
        for (const k of secretKeys) {
          const val = config[k];
          if (typeof val !== "string") continue;
          const newVal = upliftValue(val, keys);
          if (newVal !== null) {
            config[k] = newVal;
            changed = true;
          }
        }

        if (changed) {
          await queryInterface.sequelize.query(
            `UPDATE plugin_guild_features SET configJson = ? WHERE id = ?`,
            { replacements: [JSON.stringify(config), row.id] },
          );
        }
      }
    }
  },

  down: async () => {
    // Re-encryption is one-way: cannot reverse v2 → v0/v1 without
    // knowing which rows were originally which format. This migration
    // is intentionally irreversible.
  },
};

export default migration;
