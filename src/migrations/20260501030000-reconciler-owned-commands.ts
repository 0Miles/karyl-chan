import type { Migration } from "./runner.js";

/**
 * M1-A3 — reconciler_owned_commands 表（CR-7 第 3 條）
 *
 * CommandReconciler 的「管理名冊」：記錄由 reconciler 負責的 Discord 指令，
 * 防止 reconcile diff 誤刪軌一 in-process 指令或 plugin guild_features.commands。
 *
 * 表結構（M0-FROZEN §1.3 + C-runtime OQ-3）：
 *   name     TEXT NOT NULL  — Discord 指令名稱
 *   scope    TEXT NOT NULL  — 'global' 或 'guild'（Discord 登記作用域）
 *   guildId  TEXT NULL      — scope='guild' 時填 Discord guild ID；scope='global' 時 NULL
 *   ownedAt  DATETIME NOT NULL — 首次登記時間戳
 *
 * 跨欄位 invariant：
 *   (scope='global' AND guildId IS NULL) OR (scope='guild' AND guildId IS NOT NULL)
 *
 * UNIQUE 保證（解決 SQLite NULL-in-UNIQUE 問題）：
 *   - 全域指令：partial UNIQUE index (name) WHERE scope='global' AND guildId IS NULL
 *   - guild 指令：partial UNIQUE index (name, guildId) WHERE scope='guild'
 *
 * SQLite NULL 語意備注：
 *   SQLite 在 UNIQUE 約束中將每個 NULL 視為「與其他 NULL 不同」，
 *   若用單一 UNIQUE(name, scope, guildId)，多筆 (name, 'global', NULL) 不會互斥。
 *   以兩個 partial index 分別處理 global / guild 兩種形狀，完整覆蓋唯一性要求。
 *
 * 不含 FK，無需切換 PRAGMA foreign_keys。
 * 不含 backfill（M1-C 啟動 reconciler 時填入）。
 *
 * up：CREATE TABLE + 兩個 partial UNIQUE index（全包 transaction）
 * down：DROP TABLE IF EXISTS
 */

const migration: Migration = {
  up: async ({ queryInterface }) => {
    await queryInterface.sequelize.transaction(async (t) => {
      // Step 1：建立 reconciler_owned_commands 表
      await queryInterface.sequelize.query(
        `
        CREATE TABLE reconciler_owned_commands (
            name    TEXT     NOT NULL,
            scope   TEXT     NOT NULL CHECK (scope IN ('global', 'guild')),
            guildId TEXT     NULL,
            ownedAt DATETIME NOT NULL,

            -- guildId IS NULL 時 scope 必為 'global'；
            -- guildId IS NOT NULL 時 scope 必為 'guild'
            CHECK (
                (scope = 'global' AND guildId IS NULL)
             OR (scope = 'guild'  AND guildId IS NOT NULL)
            )
        );
        `,
        { transaction: t },
      );

      // Step 2：global 指令唯一性
      // partial index 只看 scope='global' AND guildId IS NULL 的列，
      // 避免 SQLite UNIQUE 中 NULL != NULL 的語意洞。
      await queryInterface.sequelize.query(
        `CREATE UNIQUE INDEX reconciler_owned_global_uq
             ON reconciler_owned_commands(name)
             WHERE scope = 'global' AND guildId IS NULL;`,
        { transaction: t },
      );

      // Step 3：guild 指令唯一性
      // 相同名稱不得在同一 guild 登記兩次。
      await queryInterface.sequelize.query(
        `CREATE UNIQUE INDEX reconciler_owned_guild_uq
             ON reconciler_owned_commands(name, guildId)
             WHERE scope = 'guild';`,
        { transaction: t },
      );
    }); // end transaction
  },

  down: async ({ queryInterface }) => {
    // down：對稱刪表（兩個 index 隨表一起消失）
    await queryInterface.sequelize.transaction(async (t) => {
      await queryInterface.sequelize.query(
        "DROP TABLE IF EXISTS reconciler_owned_commands;",
        { transaction: t },
      );
    });
  },
};

export default migration;
