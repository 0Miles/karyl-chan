import type { Migration } from "./runner.js";

/**
 * plugin_configs — plugin-level admin-editable config + a generic KV
 * store the plugin can write to itself.
 *
 *   source = 'admin'   → row created/updated by an admin via the
 *                        plugin's config_schema in the admin UI.
 *                        Values for `secret`-typed fields are
 *                        encryptSecret()'d at rest.
 *   source = 'plugin'  → row written by the plugin itself via the
 *                        config.set RPC. Stored as-is; not bound to
 *                        any schema.
 *
 * Both tiers live in the same row space so a single config.get RPC
 * surfaces a flat key→value map to the plugin (admin values
 * decrypted on the way out). Admin UI only shows + writes the
 * config_schema-bound rows; plugin-self KV is hidden from admin to
 * avoid an admin accidentally clobbering plugin internal state.
 *
 * UNIQUE (pluginId, key). Source rows for the same key cannot
 * coexist — the plugin and the admin can't both own the same key.
 */
const migration: Migration = {
  up: async ({ queryInterface }) => {
    const tables = await queryInterface.showAllTables();
    if (!tables.includes("plugin_configs")) {
      await queryInterface.sequelize.query(`
        CREATE TABLE plugin_configs (
            id          INTEGER  PRIMARY KEY AUTOINCREMENT,
            pluginId    INTEGER  NOT NULL REFERENCES plugins(id) ON DELETE CASCADE,
            key         TEXT     NOT NULL,
            value       TEXT     NOT NULL,
            source      TEXT     NOT NULL DEFAULT 'admin',
            createdAt   DATETIME NOT NULL,
            updatedAt   DATETIME NOT NULL
        );
      `);
    }
    await queryInterface.sequelize.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS plugin_configs_unique
          ON plugin_configs(pluginId, key);
    `);
  },
  down: async ({ queryInterface }) => {
    await queryInterface.sequelize.query(
      `DROP INDEX IF EXISTS plugin_configs_unique;`,
    );
    await queryInterface.dropTable("plugin_configs");
  },
};

export default migration;
