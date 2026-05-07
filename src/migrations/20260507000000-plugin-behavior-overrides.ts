import type { Migration } from "./runner.js";

/**
 * OQ-11 — plugin_behavior_overrides 表
 *
 * 記錄 admin 對 plugin manifest behaviors[] 的 on/off override。
 * 預設不寫入 row（lazy upsert：admin 第一次 toggle 時才建 row）。
 * Plugin manifest 內所有 behaviors[] 預設視為 enabled=true。
 *
 * 表結構：
 *   pluginId    INTEGER NOT NULL   — FK → plugins(id) ON DELETE CASCADE
 *   behaviorKey TEXT    NOT NULL   — 對應 behaviors[].key
 *   enabled     INTEGER NOT NULL DEFAULT 1  — 0=disabled, 1=enabled
 *   createdAt   DATETIME NOT NULL
 *   updatedAt   DATETIME NOT NULL
 *   PRIMARY KEY (pluginId, behaviorKey)
 *
 * 索引：
 *   plugin_behavior_overrides_lookup (pluginId, enabled) — reconciler 批次讀取
 *
 * 語意：
 *   - row 不存在 → enabled（預設 true，不寫 row）
 *   - row 存在且 enabled=0 → disabled（reconciler 跳過此 behavior 的 behaviors 行）
 *   - row 存在且 enabled=1 → 明確 enabled（admin 曾 toggle off 再 toggle on 後的狀態）
 *
 * up:   CREATE TABLE + CREATE INDEX（全包 transaction）
 * down: DROP TABLE IF EXISTS（index 隨表消失）
 */

const migration: Migration = {
  up: async ({ queryInterface }) => {
    await queryInterface.sequelize.transaction(async (t) => {
      await queryInterface.sequelize.query(
        `
        CREATE TABLE IF NOT EXISTS plugin_behavior_overrides (
            pluginId    INTEGER  NOT NULL,
            behaviorKey TEXT     NOT NULL,
            enabled     INTEGER  NOT NULL DEFAULT 1,
            createdAt   DATETIME NOT NULL,
            updatedAt   DATETIME NOT NULL,
            PRIMARY KEY (pluginId, behaviorKey),
            FOREIGN KEY (pluginId) REFERENCES plugins(id) ON DELETE CASCADE
        );
        `,
        { transaction: t },
      );

      await queryInterface.sequelize.query(
        `CREATE INDEX IF NOT EXISTS plugin_behavior_overrides_lookup
             ON plugin_behavior_overrides(pluginId, enabled);`,
        { transaction: t },
      );
    });
  },

  down: async ({ queryInterface }) => {
    await queryInterface.sequelize.transaction(async (t) => {
      await queryInterface.sequelize.query(
        "DROP TABLE IF EXISTS plugin_behavior_overrides;",
        { transaction: t },
      );
    });
  },
};

export default migration;
