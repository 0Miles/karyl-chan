import type { Migration } from "./runner.js";

/**
 * plugin_capabilities 表
 *
 * 每個 plugin 在 manifest `capabilities[]` 宣告的 RBAC 權限詞條。
 * register 時 reconcile（宣告 upsert / 移除 delete）；plugin 刪除時
 * 整列由 FK ON DELETE CASCADE 清掉。
 *
 * 表結構：
 *   pluginId    INTEGER  NOT NULL  — FK → plugins(id) ON DELETE CASCADE
 *   capKey      TEXT     NOT NULL  — plugin 內唯一，[a-z0-9][a-z0-9._-]*
 *   description TEXT     NOT NULL  — 給 admin 看的說明
 *   createdAt   DATETIME NOT NULL
 *   updatedAt   DATETIME NOT NULL
 *   PRIMARY KEY (pluginId, capKey)
 *
 * 對外 token 形式：`plugin:<plugins.pluginKey>:<capKey>`，存於
 * admin_role_capabilities（plugin 刪除時由 delete handler 一併清除）。
 *
 * 無 backfill：既有 plugins.manifestJson 是升級前的 manifest，不含
 * capabilities[]；plugin 以新 SDK 重新 register 時 reconcile 自會填入。
 *
 * up:   CREATE TABLE（transaction）
 * down: DROP TABLE IF EXISTS
 */

const migration: Migration = {
  up: async ({ queryInterface }) => {
    await queryInterface.sequelize.transaction(async (t) => {
      await queryInterface.sequelize.query(
        `
        CREATE TABLE IF NOT EXISTS plugin_capabilities (
            pluginId    INTEGER  NOT NULL,
            capKey      TEXT     NOT NULL,
            description TEXT     NOT NULL,
            createdAt   DATETIME NOT NULL,
            updatedAt   DATETIME NOT NULL,
            PRIMARY KEY (pluginId, capKey),
            FOREIGN KEY (pluginId) REFERENCES plugins(id) ON DELETE CASCADE
        );
        `,
        { transaction: t },
      );
    });
  },

  down: async ({ queryInterface }) => {
    await queryInterface.sequelize.transaction(async (t) => {
      await queryInterface.sequelize.query(
        "DROP TABLE IF EXISTS plugin_capabilities;",
        { transaction: t },
      );
    });
  },
};

export default migration;
