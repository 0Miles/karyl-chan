import type { Migration } from "./runner.js";

/**
 * Add a behavior `type` discriminator and plugin reference columns.
 *
 *   type             ∈ {'webhook','plugin'}
 *                    Webhook (default for legacy rows) keeps the
 *                    existing direct-POST-to-URL path.
 *                    Plugin routes the dispatch through a registered
 *                    plugin's DM behavior endpoint instead.
 *   pluginId         → plugins.id when type='plugin', NULL otherwise
 *   pluginBehaviorKey → manifest's dm_behaviors[].key when type='plugin'
 *                    A single plugin may expose multiple DM behavior
 *                    flavors (forward / translate / summarize / ...)
 *                    so we need the per-behavior key in addition to
 *                    pluginId.
 *
 * webhookUrl/webhookSecret stay NOT NULL — type='webhook' rows still
 * need them, type='plugin' rows store the plugin URL in plugins.url
 * and don't read these columns. Migration backfill keeps existing
 * rows on type='webhook' so nothing breaks at switchover.
 *
 * SQLite gotcha: ALTER TABLE ADD COLUMN is fine, but adding a CHECK
 * constraint after the fact requires table rebuild. We accept the
 * type without a CHECK at the SQL level; the model layer validates.
 */
const migration: Migration = {
  up: async ({ queryInterface }) => {
    const cols = await queryInterface.describeTable("behaviors");
    if (!("type" in cols)) {
      await queryInterface.sequelize.query(`
        ALTER TABLE behaviors ADD COLUMN type TEXT NOT NULL DEFAULT 'webhook';
      `);
    }
    if (!("pluginId" in cols)) {
      await queryInterface.sequelize.query(`
        ALTER TABLE behaviors ADD COLUMN pluginId INTEGER NULL REFERENCES plugins(id) ON DELETE SET NULL;
      `);
    }
    if (!("pluginBehaviorKey" in cols)) {
      await queryInterface.sequelize.query(`
        ALTER TABLE behaviors ADD COLUMN pluginBehaviorKey TEXT NULL;
      `);
    }
    // Hot path on dispatch: lookup behaviors by pluginId when a
    // plugin disconnects so we can short-circuit dispatching to it.
    await queryInterface.sequelize.query(`
      CREATE INDEX IF NOT EXISTS behaviors_plugin_idx ON behaviors(pluginId);
    `);
  },
  down: async ({ queryInterface }) => {
    // SQLite requires column drops via table rebuild (PRAGMA
    // foreign_keys=off; rename; recreate; copy; drop). Not implementing
    // for now — Phase 1 forward-only.
    await queryInterface.sequelize.query(`DROP INDEX IF EXISTS behaviors_plugin_idx;`);
  },
};

export default migration;
