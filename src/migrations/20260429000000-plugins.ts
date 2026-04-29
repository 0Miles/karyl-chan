import type { Migration } from "./runner.js";

/**
 * Plugin registry schema.
 *
 *   plugins  — one row per plugin known to the bot, keyed by the
 *              manifest's stable `pluginKey`. The full manifest is
 *              stored as JSON so reconcile / diff / re-render of UI
 *              always has the source-of-truth without round-tripping
 *              the plugin process.
 *
 * `status` is runtime liveness driven by heartbeat (active|inactive).
 * `enabled` is the admin's intent (do we want this plugin's stuff to
 * run at all?) — independent of status. Combination logic:
 *   - active   + enabled  → events dispatch, commands registered
 *   - active   + disabled → admin paused; treat as offline, but plugin
 *                           process is fine and will resume on enable
 *   - inactive + enabled  → plugin missing/crashed; UI flags red
 *   - inactive + disabled → cold storage
 *
 * `tokenHash` rotates on every successful re-registration. Any
 * previously issued plugin token is implicitly invalidated.
 *
 * Idempotent same as other migrations: CHECK existence before CREATE,
 * indexes use IF NOT EXISTS.
 */
const migration: Migration = {
  up: async ({ queryInterface }) => {
    const tables = await queryInterface.showAllTables();

    if (!tables.includes("plugins")) {
      await queryInterface.sequelize.query(`
        CREATE TABLE plugins (
            id              INTEGER  PRIMARY KEY AUTOINCREMENT,
            pluginKey       TEXT     NOT NULL UNIQUE,
            name            TEXT     NOT NULL,
            version         TEXT     NOT NULL,
            url             TEXT     NOT NULL,
            manifestJson    TEXT     NOT NULL,
            status          TEXT     NOT NULL CHECK (status IN ('active','inactive')) DEFAULT 'inactive',
            tokenHash       TEXT     NULL,
            enabled         INTEGER  NOT NULL DEFAULT 1,
            lastHeartbeatAt DATETIME NULL,
            createdAt       DATETIME NOT NULL,
            updatedAt       DATETIME NOT NULL
        );
      `);
    }

    // Lookup by status drives the heartbeat reaper + admin "which are
    // alive" listings; lookup by enabled drives event dispatch
    // filtering. Both are hot paths.
    await queryInterface.sequelize.query(`
      CREATE INDEX IF NOT EXISTS plugins_status_idx ON plugins(status);
    `);
    await queryInterface.sequelize.query(`
      CREATE INDEX IF NOT EXISTS plugins_enabled_idx ON plugins(enabled);
    `);
  },
  down: async ({ queryInterface }) => {
    await queryInterface.sequelize.query(
      `DROP INDEX IF EXISTS plugins_enabled_idx;`,
    );
    await queryInterface.sequelize.query(
      `DROP INDEX IF EXISTS plugins_status_idx;`,
    );
    await queryInterface.dropTable("plugins");
  },
};

export default migration;
