import type { Migration } from "./runner.js";

/**
 * Add `featureKey` to plugin_commands.
 *
 * Plugin manifests can now declare commands under
 * `guild_features[].commands[]` (per-guild, gated by the feature
 * toggle) in addition to the top-level `commands[]` (truly global).
 * This column tags each row with which feature it came from:
 *   featureKey IS NULL  → top-level / global command
 *   featureKey = '<key>' → declared inside that guild_feature
 *
 * Backfill is a no-op: every existing row predates feature commands,
 * so they're all top-level globals (NULL).
 */
const migration: Migration = {
  up: async ({ queryInterface }) => {
    const table = await queryInterface
      .describeTable("plugin_commands")
      .catch(() => ({}));
    // Idempotent: skip if already added (e.g. fresh `up` after partial down).
    if (!("featureKey" in table)) {
      await queryInterface.sequelize.query(
        `ALTER TABLE plugin_commands ADD COLUMN featureKey TEXT NULL;`,
      );
    }
    // Lookup-by-feature: when a per-guild toggle flips, we need to
    // find every command row that should be (un)registered for that
    // (pluginId, featureKey) pair. (pluginId, featureKey) covers it.
    await queryInterface.sequelize.query(`
      CREATE INDEX IF NOT EXISTS plugin_commands_by_feature
          ON plugin_commands(pluginId, featureKey);
    `);
  },
  down: async ({ queryInterface }) => {
    await queryInterface.sequelize.query(
      `DROP INDEX IF EXISTS plugin_commands_by_feature;`,
    );
    // SQLite < 3.35 can't DROP COLUMN; on modern SQLite (>= 3.35,
    // which Node-sqlite3 ships with) the ALTER works. We don't
    // bother with the table-rebuild fallback because down() is dev-
    // only and operators on ancient SQLite can re-bootstrap fresh.
    await queryInterface.sequelize
      .query(`ALTER TABLE plugin_commands DROP COLUMN featureKey;`)
      .catch(() => {});
  },
};

export default migration;
