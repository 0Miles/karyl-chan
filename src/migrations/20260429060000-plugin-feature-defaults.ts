import type { Migration } from "./runner.js";

/**
 * plugin_feature_defaults — per-feature default toggle that overrides
 * the manifest's `enabled_by_default`. Used by the "All Servers"
 * dashboard so the operator can centrally pick the default for new
 * guilds (plus a "apply to all guilds now" bulk-flip).
 *
 *   (pluginId, featureKey) is unique. Falls back to manifest's
 *   `enabled_by_default` (false if also omitted) when no row exists.
 */
const migration: Migration = {
  up: async ({ queryInterface }) => {
    const tables = await queryInterface.showAllTables();
    if (!tables.includes("plugin_feature_defaults")) {
      await queryInterface.sequelize.query(`
        CREATE TABLE plugin_feature_defaults (
            id          INTEGER  PRIMARY KEY AUTOINCREMENT,
            pluginId    INTEGER  NOT NULL REFERENCES plugins(id) ON DELETE CASCADE,
            featureKey  TEXT     NOT NULL,
            enabled     INTEGER  NOT NULL DEFAULT 0,
            createdAt   DATETIME NOT NULL,
            updatedAt   DATETIME NOT NULL
        );
      `);
    }
    await queryInterface.sequelize.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS plugin_feature_defaults_unique
          ON plugin_feature_defaults(pluginId, featureKey);
    `);
  },
  down: async ({ queryInterface }) => {
    await queryInterface.sequelize.query(
      `DROP INDEX IF EXISTS plugin_feature_defaults_unique;`,
    );
    await queryInterface.dropTable("plugin_feature_defaults");
  },
};

export default migration;
