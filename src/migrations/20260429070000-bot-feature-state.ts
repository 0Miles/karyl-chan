import type { Migration } from "./runner.js";

/**
 * bot_feature_state — operator on/off for the bot's in-process
 * (discordx) features (todo / picture-only / role-emoji / rcon).
 *
 * Lookup precedence at runtime:
 *   1. (guildId=<gid>, featureKey) row  → per-guild override
 *   2. (guildId=NULL, featureKey) row   → operator default for new guilds
 *   3. true                              → built-in features default ON
 *
 * The NULL-guild "default" row is fully managed in the admin UI's
 * "All Servers" → Bot Features tab; per-guild rows live in the same
 * tab on a single guild's detail.
 *
 * UNIQUE (guildId, featureKey). SQLite treats NULL as not-equal in
 * UNIQUE constraints — so multiple NULL rows would slip through. We
 * compensate by always upserting via SELECT-then-INSERT/UPDATE in the
 * model layer.
 */
const migration: Migration = {
  up: async ({ queryInterface }) => {
    const tables = await queryInterface.showAllTables();
    if (!tables.includes("bot_feature_state")) {
      await queryInterface.sequelize.query(`
        CREATE TABLE bot_feature_state (
            id          INTEGER  PRIMARY KEY AUTOINCREMENT,
            guildId     TEXT,
            featureKey  TEXT     NOT NULL,
            enabled     INTEGER  NOT NULL DEFAULT 1,
            createdAt   DATETIME NOT NULL,
            updatedAt   DATETIME NOT NULL
        );
      `);
    }
    await queryInterface.sequelize.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS bot_feature_state_unique
          ON bot_feature_state(IFNULL(guildId, ''), featureKey);
    `);
    await queryInterface.sequelize.query(`
      CREATE INDEX IF NOT EXISTS bot_feature_state_by_feature
          ON bot_feature_state(featureKey);
    `);
  },
  down: async ({ queryInterface }) => {
    await queryInterface.sequelize.query(
      `DROP INDEX IF EXISTS bot_feature_state_by_feature;`,
    );
    await queryInterface.sequelize.query(
      `DROP INDEX IF EXISTS bot_feature_state_unique;`,
    );
    await queryInterface.dropTable("bot_feature_state");
  },
};

export default migration;
