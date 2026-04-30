import type { Migration } from "./runner.js";

/**
 * Add scope-approval columns to `plugins`.
 *
 * approved_scopes_json — scopes the admin has approved (or auto-approved
 *   on first register). Token signing only uses these scopes. Backfilled
 *   from manifestJson.rpc_methods_used for existing rows.
 *
 * pending_scopes_json — scopes declared in the latest manifest that are
 *   not yet in approved_scopes_json. Requires admin action to approve.
 *   NULL means no pending scopes.
 *
 * Idempotent: checks column existence before ALTER; safe to run twice.
 *
 * Backfill: for each existing plugin row, parses manifestJson and
 * extracts rpc_methods_used → approved_scopes_json. Rows that already
 * have the column (re-run scenario) are untouched.
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

    if (!("approvedScopesJson" in table)) {
      await queryInterface.sequelize.query(
        `ALTER TABLE plugins ADD COLUMN approvedScopesJson TEXT NOT NULL DEFAULT '[]';`,
      );
    }

    if (!("pendingScopesJson" in table)) {
      await queryInterface.sequelize.query(
        `ALTER TABLE plugins ADD COLUMN pendingScopesJson TEXT NULL;`,
      );
    }

    // Backfill: for every existing plugin row, extract rpc_methods_used
    // from manifestJson and write into approvedScopesJson (only where
    // it's still the default empty array, to avoid overwriting a
    // previous run of this migration).
    const rows = (await queryInterface.sequelize.query(
      `SELECT id, manifestJson FROM plugins WHERE approvedScopesJson = '[]';`,
    )) as [Array<{ id: number; manifestJson: string }>, unknown];

    for (const row of rows[0]) {
      let scopes: string[] = [];
      try {
        const manifest = JSON.parse(row.manifestJson) as {
          rpc_methods_used?: unknown;
        };
        if (Array.isArray(manifest.rpc_methods_used)) {
          scopes = manifest.rpc_methods_used.filter(
            (s): s is string => typeof s === "string",
          );
        }
      } catch {
        // Malformed manifestJson — leave as empty array.
      }
      await queryInterface.sequelize.query(
        `UPDATE plugins SET approvedScopesJson = ? WHERE id = ?;`,
        { replacements: [JSON.stringify(scopes), row.id] },
      );
    }
  },

  down: async ({ queryInterface }) => {
    const tables = await queryInterface.showAllTables();
    if (!tables.includes("plugins")) return;

    // SQLite >= 3.35 supports DROP COLUMN; Node's bundled sqlite3 meets
    // this requirement. dev-only teardown; not needed for production rollback.
    await queryInterface.sequelize
      .query(`ALTER TABLE plugins DROP COLUMN pendingScopesJson;`)
      .catch(() => {});
    await queryInterface.sequelize
      .query(`ALTER TABLE plugins DROP COLUMN approvedScopesJson;`)
      .catch(() => {});
  },
};

export default migration;
