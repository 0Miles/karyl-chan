/**
 * Unit tests for 20260430030000-encryption-v2-uplift migration.
 *
 * Coverage:
 *   1. uplift skips rows already in v2 format (idempotent)
 *   2. uplift re-encrypts v0 plaintext → v2
 *   3. uplift re-encrypts v1 ciphertext → v2  (last allowed brute-force)
 *   4. fresh DB (no tables) — migration is a no-op, does not throw
 *   5. behaviors table: webhookUrl + webhookSecret columns handled
 *   6. RconForwardChannels table: password column handled
 *   7. plugin_configs: only source='admin' secret-typed fields uplifted
 *   8. plugin_guild_features: configJson secret keys uplifted, non-secret left alone
 */
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomBytes, createCipheriv, createDecipheriv } from "crypto";

// ── env setup (before any imports that read process.env) ─────────────
// vi.hoisted cannot reference ESM imports — use require() inside the callback.
vi.hoisted(() => {
  const { randomBytes: rb } = require("crypto") as { randomBytes: (n: number) => Buffer };
  process.env.ENCRYPTION_KEY = rb(32).toString("hex");
  process.env.SQLITE_DB_PATH = ":memory:";
  process.env.NODE_ENV = "test";
});

// ── helpers ───────────────────────────────────────────────────────────

const KEY_BYTES = 32;
const ALGO = "aes-256-gcm";
const IV_BYTES = 12;

/** Build a v1 ciphertext using the given key hex */
function makeV1(plaintext: string, hexKey: string): string {
  const key = Buffer.from(hexKey, "hex");
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64"), tag.toString("base64"), ct.toString("base64")].join(":");
}

/** Decrypt a v2 ciphertext to verify round-trip */
function decryptV2(ciphertext: string, hexKey: string): string {
  const parts = ciphertext.split(":");
  if (parts.length !== 5 || parts[0] !== "v2") throw new Error("not v2");
  const [, , ivB64, tagB64, ctB64] = parts;
  const key = Buffer.from(hexKey, "hex");
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const ct = Buffer.from(ctB64, "base64");
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

// ── import migration (must be after env setup) ────────────────────────
import migration from "../src/migrations/20260430030000-encryption-v2-uplift.js";
import { encryptSecret } from "../src/utils/crypto.js";

// ── QueryInterface mock builder ───────────────────────────────────────

type SelectRow = Record<string, unknown>;

/**
 * Minimal mock of Sequelize's QueryInterface + Sequelize.
 * `showAllTables` returns the configured table list.
 * `sequelize.query` dispatches on SQL prefix:
 *   SELECT → returns the rows from `selectMap[tableStem]`
 *   UPDATE → appends to `updates[]`
 */
function buildMock(opts: {
  tables: string[];
  selectMap: Record<string, SelectRow[]>;
}) {
  const updates: Array<{ sql: string; replacements: unknown[] }> = [];

  const sequelizeMock = {
    query: vi.fn(async (sql: string, params?: { replacements?: unknown[] }) => {
      const normalized = sql.replace(/\s+/g, " ").trim();
      if (normalized.toUpperCase().startsWith("UPDATE")) {
        updates.push({
          sql: normalized,
          replacements: (params?.replacements ?? []) as unknown[],
        });
        return;
      }
      // SELECT — match by table stem
      for (const [stem, rows] of Object.entries(opts.selectMap)) {
        if (normalized.toLowerCase().includes(stem.toLowerCase())) {
          return rows;
        }
      }
      return [];
    }),
  };

  const qi = {
    showAllTables: vi.fn().mockResolvedValue(opts.tables),
    sequelize: sequelizeMock,
  };

  return { qi, updates, sequelizeMock };
}

// ── tests ─────────────────────────────────────────────────────────────

describe("20260430030000-encryption-v2-uplift", () => {
  const activeKey = process.env.ENCRYPTION_KEY!;

  beforeEach(() => {
    process.env.ENCRYPTION_KEY = activeKey;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ── 1. idempotent: already-v2 rows are skipped ─────────────────────
  it("skips rows that are already v2-encrypted", async () => {
    const v2Value = encryptSecret("already-encrypted");
    const { qi, updates } = buildMock({
      tables: ["behaviors"],
      selectMap: {
        behaviors: [{ id: 1, webhookUrl: v2Value, webhookSecret: null }],
      },
    });

    await migration.up({ queryInterface: qi as never, sequelize: qi.sequelize as never });

    expect(updates).toHaveLength(0);
  });

  // ── 2. v0 plaintext → v2 ──────────────────────────────────────────
  it("re-encrypts v0 plaintext webhookUrl to v2", async () => {
    const { qi, updates } = buildMock({
      tables: ["behaviors"],
      selectMap: {
        behaviors: [{ id: 42, webhookUrl: "system://plain", webhookSecret: null }],
      },
    });

    await migration.up({ queryInterface: qi as never, sequelize: qi.sequelize as never });

    expect(updates).toHaveLength(1);
    const [newValue] = updates[0].replacements as string[];
    expect(newValue.startsWith("v2:")).toBe(true);
    expect(decryptV2(newValue, activeKey)).toBe("system://plain");
  });

  // ── 3. v1 ciphertext → v2 ─────────────────────────────────────────
  it("re-encrypts v1 ciphertext to v2 using brute-force (last allowed use)", async () => {
    const v1 = makeV1("rcon-secret", activeKey);
    const { qi, updates } = buildMock({
      tables: ["behaviors"],
      selectMap: {
        behaviors: [{ id: 7, webhookUrl: null, webhookSecret: v1 }],
      },
    });

    await migration.up({ queryInterface: qi as never, sequelize: qi.sequelize as never });

    expect(updates).toHaveLength(1);
    const replacements = updates[0].replacements as string[];
    // webhookSecret update: SET webhookSecret = ? → replacement[0] is the new value
    const newValue = replacements[0];
    expect(newValue.startsWith("v2:")).toBe(true);
    expect(decryptV2(newValue, activeKey)).toBe("rcon-secret");
  });

  // ── 4. fresh DB — no tables → no-op ───────────────────────────────
  it("is a no-op on a fresh DB with no tables", async () => {
    const { qi, updates } = buildMock({ tables: [], selectMap: {} });

    await expect(
      migration.up({ queryInterface: qi as never, sequelize: qi.sequelize as never }),
    ).resolves.toBeUndefined();
    expect(updates).toHaveLength(0);
  });

  // ── 5. behaviors: both columns updated in single UPDATE ────────────
  it("issues one UPDATE per behaviors row that needs changes", async () => {
    const { qi, updates } = buildMock({
      tables: ["behaviors"],
      selectMap: {
        behaviors: [
          { id: 1, webhookUrl: "plain-url", webhookSecret: "plain-secret" },
        ],
      },
    });

    await migration.up({ queryInterface: qi as never, sequelize: qi.sequelize as never });

    expect(updates).toHaveLength(1);
    const sql = updates[0].sql;
    expect(sql).toMatch(/webhookUrl/i);
    expect(sql).toMatch(/webhookSecret/i);
  });

  // ── 6. RconForwardChannels password ───────────────────────────────
  it("uplifts RconForwardChannels.password from v0 to v2", async () => {
    const { qi, updates } = buildMock({
      tables: ["RconForwardChannels"],
      selectMap: {
        RconForwardChannels: [
          { channelId: "ch1", guildId: "g1", password: "hunter2" },
        ],
      },
    });

    await migration.up({ queryInterface: qi as never, sequelize: qi.sequelize as never });

    expect(updates).toHaveLength(1);
    const [newPw] = updates[0].replacements as string[];
    expect(newPw.startsWith("v2:")).toBe(true);
    expect(decryptV2(newPw, activeKey)).toBe("hunter2");
  });

  // ── 7. plugin_configs: only secret-typed admin fields uplifted ─────
  it("uplifts only secret-typed admin plugin_configs rows", async () => {
    const manifest = JSON.stringify({
      config_schema: [
        { key: "apiKey", type: "secret" },
        { key: "region", type: "string" },
      ],
    });
    const { qi, updates } = buildMock({
      tables: ["plugin_configs", "plugins"],
      selectMap: {
        plugin_configs: [
          // Secret field with v0 value
          { id: 1, key: "apiKey", value: "plain-api-key", manifestJson: manifest },
          // Non-secret field — must not be uplifted
          { id: 2, key: "region", value: "us-east-1", manifestJson: manifest },
        ],
      },
    });

    await migration.up({ queryInterface: qi as never, sequelize: qi.sequelize as never });

    expect(updates).toHaveLength(1);
    expect(updates[0].sql).toMatch(/plugin_configs/i);
    const [newVal, id] = updates[0].replacements as [string, number];
    expect(id).toBe(1);
    expect(newVal.startsWith("v2:")).toBe(true);
    expect(decryptV2(newVal, activeKey)).toBe("plain-api-key");
  });

  // ── 8. plugin_guild_features: configJson secret keys only ─────────
  it("uplifts secret keys in plugin_guild_features.configJson, leaves non-secret alone", async () => {
    const manifest = JSON.stringify({
      features: [
        {
          key: "my-feature",
          config_schema: [
            { key: "token", type: "secret" },
            { key: "label", type: "string" },
          ],
        },
      ],
    });
    const configJson = JSON.stringify({
      token: "plain-token",
      label: "keep-me",
    });

    const { qi, updates } = buildMock({
      tables: ["plugin_guild_features", "plugins"],
      selectMap: {
        plugin_guild_features: [
          { id: 5, configJson, manifestJson: manifest, featureKey: "my-feature" },
        ],
      },
    });

    await migration.up({ queryInterface: qi as never, sequelize: qi.sequelize as never });

    expect(updates).toHaveLength(1);
    const [newJson, id] = updates[0].replacements as [string, number];
    expect(id).toBe(5);
    const parsed = JSON.parse(newJson) as { token: string; label: string };
    expect(parsed.token.startsWith("v2:")).toBe(true);
    expect(decryptV2(parsed.token, activeKey)).toBe("plain-token");
    // non-secret field must be preserved verbatim
    expect(parsed.label).toBe("keep-me");
  });
});
