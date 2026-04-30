import type { Migration } from "./runner.js";

/**
 * Add per-plugin secret columns to `plugins`.
 *
 * setupSecretHash — SHA-256 hash of the admin-generated per-plugin setup
 *   secret. NULL means the plugin uses the global KARYL_PLUGIN_SECRET
 *   fallback for registration auth.
 *
 * dispatchHmacKey — cleartext HMAC key the bot uses to sign outbound
 *   dispatches (events, commands, DM behavior) to this plugin. Stored
 *   cleartext because the bot must use it to sign; it never leaves the
 *   server. NULL means fall back to the global KARYL_PLUGIN_SECRET.
 *
 * Both columns are NULL by default so all existing plugins (12+2) continue
 * to work without modification — they fall through to the global secret
 * on both the register and dispatch paths.
 *
 * Idempotent: checks column existence before ALTER; safe to run twice.
 */
const migration: Migration = {
  up: async ({ queryInterface }) => {
    const tables = await queryInterface.showAllTables();
    if (!tables.includes("plugins")) {
      // Fresh DB without plugins table yet — the 20260429000000-plugins
      // migration will create the table with these columns already
      // declared via the Sequelize model sync. Nothing to do here.
      return;
    }

    const table = await queryInterface.describeTable("plugins");

    if (!("setupSecretHash" in table)) {
      await queryInterface.sequelize.query(
        `ALTER TABLE plugins ADD COLUMN setupSecretHash TEXT NULL;`,
      );
    }

    if (!("dispatchHmacKey" in table)) {
      await queryInterface.sequelize.query(
        `ALTER TABLE plugins ADD COLUMN dispatchHmacKey TEXT NULL;`,
      );
    }
  },

  down: async ({ queryInterface }) => {
    const tables = await queryInterface.showAllTables();
    if (!tables.includes("plugins")) return;

    // SQLite >= 3.35 supports DROP COLUMN; dev-only teardown.
    await queryInterface.sequelize
      .query(`ALTER TABLE plugins DROP COLUMN dispatchHmacKey;`)
      .catch(() => {});
    await queryInterface.sequelize
      .query(`ALTER TABLE plugins DROP COLUMN setupSecretHash;`)
      .catch(() => {});
  },
};

export default migration;
