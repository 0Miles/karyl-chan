import type { Migration } from "./runner.js";

/**
 * OQ-7 — behavior_sessions.expiresAt 過期欄位
 *
 * continuous forwardType session 若 plugin 永遠不回 [BEHAVIOR:END]，
 * session 會永久存在。加入 expiresAt 讓 read-side 過濾已過期 session，
 * 避免殭屍 session 無限累積並無聲吃 inbound DM。
 *
 * 新增欄位：
 *   expiresAt DATETIME NULL — NULL 代表「無限期」；
 *             startSession 設為 now + BEHAVIOR_SESSION_EXPIRE_HOURS（預設 24h）。
 *
 * 索引：
 *   behavior_sessions_expires_at_idx ON behavior_sessions(expiresAt)
 *   WHERE expiresAt IS NOT NULL — partial index，只對有值的 row 排序，
 *   供 reaper 或 cleanup query 用。
 *
 * 冪等：ADD COLUMN 以 describeTable 預檢；CREATE INDEX 用 IF NOT EXISTS。
 *
 * down：SQLite rebuild table pattern（拿掉 expiresAt 欄位）。
 */

const migration: Migration = {
  up: async ({ queryInterface }) => {
    await queryInterface.sequelize.transaction(async (t) => {
      // Step 1：ADD COLUMN expiresAt（冪等預檢）
      const table = await queryInterface.describeTable("behavior_sessions");
      if (!("expiresAt" in table)) {
        await queryInterface.sequelize.query(
          `ALTER TABLE behavior_sessions ADD COLUMN expiresAt DATETIME NULL;`,
          { transaction: t },
        );
      }

      // Step 2：加 partial index（SQLite 支援 WHERE clause index）
      await queryInterface.sequelize.query(
        `CREATE INDEX IF NOT EXISTS behavior_sessions_expires_at_idx
             ON behavior_sessions(expiresAt)
          WHERE expiresAt IS NOT NULL;`,
        { transaction: t },
      );
    });
  },

  down: async ({ queryInterface }) => {
    // down：SQLite rebuild table pattern — 拿掉 expiresAt 欄位
    // PRAGMA foreign_keys 在 transaction 外切換（SQLite 規範要求）
    await queryInterface.sequelize.query(`PRAGMA foreign_keys = OFF;`);
    try {
      await queryInterface.sequelize.transaction(async (t) => {
        // Step 1：移除 index（index 不會隨 rebuild 自動消失，需手動 DROP）
        await queryInterface.sequelize.query(
          `DROP INDEX IF EXISTS behavior_sessions_expires_at_idx;`,
          { transaction: t },
        );

        // Step 2：重建不含 expiresAt 的原始表
        await queryInterface.sequelize.query(
          `CREATE TABLE behavior_sessions_rollback (
              userId      TEXT     PRIMARY KEY NOT NULL,
              behaviorId  INTEGER  NOT NULL REFERENCES behaviors(id) ON DELETE CASCADE ON UPDATE CASCADE,
              channelId   TEXT     NOT NULL,
              startedAt   TEXT     NOT NULL,
              createdAt   DATETIME NOT NULL,
              updatedAt   DATETIME NOT NULL
          );`,
          { transaction: t },
        );

        // 複製原始欄位資料
        await queryInterface.sequelize.query(
          `INSERT INTO behavior_sessions_rollback
               (userId, behaviorId, channelId, startedAt, createdAt, updatedAt)
           SELECT userId, behaviorId, channelId, startedAt, createdAt, updatedAt
             FROM behavior_sessions;`,
          { transaction: t },
        );

        // 刪舊表、改名
        await queryInterface.sequelize.query(`DROP TABLE behavior_sessions;`, {
          transaction: t,
        });
        await queryInterface.sequelize.query(
          `ALTER TABLE behavior_sessions_rollback RENAME TO behavior_sessions;`,
          { transaction: t },
        );
      });
    } finally {
      await queryInterface.sequelize.query(`PRAGMA foreign_keys = ON;`);
    }
  },
};

export default migration;
