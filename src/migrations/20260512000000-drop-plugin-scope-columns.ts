import type { Migration } from "./runner.js";

/**
 * Drop the plugin scope-approval columns from `plugins`.
 *
 * The "RPC scope approval" control is gone: a plugin's manifest-declared
 * `rpc_methods_used` ARE its granted scopes (issued straight into its
 * token), so the pending/approved split — and the columns that backed
 * it — are dead weight.
 *
 *   approvedScopesJson (TEXT NOT NULL DEFAULT '[]') — removed
 *   pendingScopesJson  (TEXT NULL)                  — removed
 *
 * Idempotent: describeTable-then-remove, so a re-run after a partial
 * apply is a no-op (mirrors the pattern in 20260501010000-behaviors-v2-rebuild).
 * SQLite `removeColumn` recreates the table under the hood — Sequelize
 * handles that transparently.
 *
 * `down` re-adds both columns, backfilling approvedScopesJson from each
 * row's manifestJson.rpc_methods_used (mirrors the `up` of
 * 20260430010000-plugin-scope-approval).
 */
const migration: Migration = {
  up: async ({ queryInterface }) => {
    const tables = await queryInterface.showAllTables();
    if (!tables.includes("plugins")) {
      // Fresh DB without a plugins table yet — Sequelize's model sync
      // will create it without these columns. Nothing to do.
      return;
    }
    const t = await queryInterface.describeTable("plugins");
    if (t.pendingScopesJson) {
      await queryInterface.removeColumn("plugins", "pendingScopesJson");
    }
    if (t.approvedScopesJson) {
      await queryInterface.removeColumn("plugins", "approvedScopesJson");
    }
  },

  down: async ({ queryInterface }) => {
    const tables = await queryInterface.showAllTables();
    if (!tables.includes("plugins")) return;

    const t = await queryInterface.describeTable("plugins");

    if (!t.approvedScopesJson) {
      await queryInterface.sequelize.query(
        `ALTER TABLE plugins ADD COLUMN approvedScopesJson TEXT NOT NULL DEFAULT '[]';`,
      );
    }
    if (!t.pendingScopesJson) {
      await queryInterface.sequelize.query(
        `ALTER TABLE plugins ADD COLUMN pendingScopesJson TEXT NULL;`,
      );
    }

    // Backfill: for every existing plugin row that's still on the
    // default empty array, extract rpc_methods_used from manifestJson
    // and write it into approvedScopesJson.
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
};

export default migration;
