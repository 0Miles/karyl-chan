import type { Migration } from "./runner.js";

/**
 * plugin_guild_features — admin's per-guild on/off + config for each
 * guild feature a plugin's manifest declares.
 *
 *   (pluginId, guildId, featureKey) is unique:
 *     - one row per plugin × guild × feature
 *     - enabled flag toggled by admin in guild page UI
 *     - configJson stores the user-filled config_schema values, with
 *       any `secret` typed fields encryptSecret'd in place
 *     - metricsJson is plugin-pushed counters (overview_metrics) —
 *       admin UI reads and renders, plugin writes via a future RPC
 *       (Phase 3); for now this column is reserved
 */
const migration: Migration = {
  up: async ({ queryInterface }) => {
    const tables = await queryInterface.showAllTables();
    if (!tables.includes("plugin_guild_features")) {
      await queryInterface.sequelize.query(`
        CREATE TABLE plugin_guild_features (
            id          INTEGER  PRIMARY KEY AUTOINCREMENT,
            pluginId    INTEGER  NOT NULL REFERENCES plugins(id) ON DELETE CASCADE,
            guildId     TEXT     NOT NULL,
            featureKey  TEXT     NOT NULL,
            enabled     INTEGER  NOT NULL DEFAULT 0,
            configJson  TEXT     NOT NULL DEFAULT '{}',
            metricsJson TEXT     NOT NULL DEFAULT '{}',
            createdAt   DATETIME NOT NULL,
            updatedAt   DATETIME NOT NULL
        );
      `);
    }
    await queryInterface.sequelize.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS plugin_guild_features_unique
          ON plugin_guild_features(pluginId, guildId, featureKey);
    `);
    // Lookup-by-guild path (admin guild page renders all enabled
    // plugin features for that guild).
    await queryInterface.sequelize.query(`
      CREATE INDEX IF NOT EXISTS plugin_guild_features_by_guild
          ON plugin_guild_features(guildId);
    `);
  },
  down: async ({ queryInterface }) => {
    await queryInterface.sequelize.query(
      `DROP INDEX IF EXISTS plugin_guild_features_by_guild;`,
    );
    await queryInterface.sequelize.query(
      `DROP INDEX IF EXISTS plugin_guild_features_unique;`,
    );
    await queryInterface.dropTable("plugin_guild_features");
  },
};

export default migration;
