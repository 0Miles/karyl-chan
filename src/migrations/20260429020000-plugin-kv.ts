import type { Migration } from "./runner.js";

/**
 * Per-plugin per-guild key/value storage.
 *
 *   plugin_kv  — opaque JSON value addressable by (pluginId, guildId, key).
 *                Plugins use this to keep small bits of state without
 *                running their own database; quota is enforced at the
 *                application layer based on the manifest's
 *                storage.guild_kv_quota_kb.
 *
 * Hard size cap on `value` enforced by the route layer
 * (storage.kv_set rejects payloads above MAX_VALUE_BYTES). The DB
 * column itself is TEXT with no SQL-level limit because SQLite's
 * TEXT is unbounded and adding a CHECK on length(value) would lock
 * us out of small-quota plugins later if we wanted to relax.
 *
 * `bytes` is denormalized from length(value) at write time so the
 * quota query (`SUM(bytes) WHERE pluginId=X AND guildId=Y`) doesn't
 * have to scan every row's TEXT value.
 *
 * Cascading deletes: a plugin row gone (admin removed via future
 * unregister flow) wipes its KV automatically.
 */
const migration: Migration = {
  up: async ({ queryInterface }) => {
    const tables = await queryInterface.showAllTables();

    if (!tables.includes("plugin_kv")) {
      await queryInterface.sequelize.query(`
        CREATE TABLE plugin_kv (
            id        INTEGER  PRIMARY KEY AUTOINCREMENT,
            pluginId  INTEGER  NOT NULL REFERENCES plugins(id) ON DELETE CASCADE,
            guildId   TEXT     NOT NULL,
            key       TEXT     NOT NULL,
            value     TEXT     NOT NULL,
            bytes     INTEGER  NOT NULL,
            createdAt DATETIME NOT NULL,
            updatedAt DATETIME NOT NULL
        );
      `);
    }
    await queryInterface.sequelize.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS plugin_kv_lookup_uq
          ON plugin_kv(pluginId, guildId, key);
    `);
    // Quota query needs to sum bytes per (pluginId, guildId); the
    // unique index above also covers it but make the intent explicit.
    await queryInterface.sequelize.query(`
      CREATE INDEX IF NOT EXISTS plugin_kv_quota_idx
          ON plugin_kv(pluginId, guildId);
    `);
  },
  down: async ({ queryInterface }) => {
    await queryInterface.sequelize.query(
      `DROP INDEX IF EXISTS plugin_kv_quota_idx;`,
    );
    await queryInterface.sequelize.query(
      `DROP INDEX IF EXISTS plugin_kv_lookup_uq;`,
    );
    await queryInterface.dropTable("plugin_kv");
  },
};

export default migration;
