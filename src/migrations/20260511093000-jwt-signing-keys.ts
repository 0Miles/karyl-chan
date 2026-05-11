import type { Migration } from "./runner.js";

/**
 * jwt_signing_keys 表 — bot 的 JWT 簽章金鑰（Ed25519）持久化。
 *
 * 之前金鑰來自 env（HS256 `JWT_SECRET`，後改 Ed25519 `JWT_SIGNING_KEY`）。
 * 現在改成 runtime 生成、存 DB、admin UI 可輪替；輪替時 plugin 透過
 * heartbeat 回應拿到新公鑰。一律只有一列 `active = 1`（最新一把）；
 * 舊列保留供稽核（`active = 0`）。
 *
 * 表結構：
 *   id             INTEGER PK AUTOINCREMENT
 *   algorithm      TEXT     NOT NULL              — 目前固定 'ed25519'
 *   privateKeyEnc  TEXT     NOT NULL              — encryptSecret(base64 PKCS#8 DER)
 *   publicKeyPem   TEXT     NOT NULL              — SPKI PEM（公開，明文）
 *   active         INTEGER  NOT NULL DEFAULT 0    — 1 = 現役（最多一列）
 *   createdAt      DATETIME NOT NULL
 *   updatedAt      DATETIME NOT NULL
 *
 * 無 backfill：首次啟動時 initJwtSigningAuthority() 會生成並插入第一把。
 *
 * up:   CREATE TABLE + 唯一索引（部分索引：WHERE active = 1）
 * down: DROP TABLE IF EXISTS
 */

const migration: Migration = {
  up: async ({ queryInterface }) => {
    await queryInterface.sequelize.transaction(async (t) => {
      await queryInterface.sequelize.query(
        `
        CREATE TABLE IF NOT EXISTS jwt_signing_keys (
            id             INTEGER  PRIMARY KEY AUTOINCREMENT,
            algorithm      TEXT     NOT NULL,
            privateKeyEnc  TEXT     NOT NULL,
            publicKeyPem   TEXT     NOT NULL,
            active         INTEGER  NOT NULL DEFAULT 0,
            createdAt      DATETIME NOT NULL,
            updatedAt      DATETIME NOT NULL
        );
        `,
        { transaction: t },
      );
      // At most one active key. SQLite supports partial indexes.
      await queryInterface.sequelize.query(
        `CREATE UNIQUE INDEX IF NOT EXISTS jwt_signing_keys_one_active
           ON jwt_signing_keys (active) WHERE active = 1;`,
        { transaction: t },
      );
    });
  },

  down: async ({ queryInterface }) => {
    await queryInterface.sequelize.transaction(async (t) => {
      await queryInterface.sequelize.query(
        "DROP TABLE IF EXISTS jwt_signing_keys;",
        { transaction: t },
      );
    });
  },
};

export default migration;
