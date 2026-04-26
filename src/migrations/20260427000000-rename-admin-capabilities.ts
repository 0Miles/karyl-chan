import { QueryTypes } from 'sequelize';
import type { Migration } from './runner.js';

/**
 * Rewrite legacy admin capability tokens after the permission redesign:
 *
 *   - `dm.read`  + `dm.write`   →  `dm.message`     (single token covers both)
 *   - `guild.read` + `guild.write` → `guild.message` + `guild.manage`
 *
 * Old `guild.read` already carried both message-reading AND member /
 * audit visibility, and `guild.write` carried message-sending AND
 * settings mutation. The new model splits read/write per scope so any
 * role that previously had either gets BOTH new tokens to preserve the
 * effective access surface.
 *
 * Per-guild scoped tokens (`guild:<id>.message`/`.manage`) didn't exist
 * before this migration so there's nothing to rewrite at that level.
 *
 * `down` is intentionally a no-op — the new tokens carry strictly more
 * information than the old ones, so any reverse mapping would lose
 * granularity. Operators rolling back should restore from a backup.
 */
const TABLE = 'admin_role_capabilities';
const LEGACY_DM = ['dm.read', 'dm.write'];
const LEGACY_GUILD = ['guild.read', 'guild.write'];

interface CapRow { role: string; capability: string }

const migration: Migration = {
    up: async ({ queryInterface, sequelize }) => {
        const tables = await queryInterface.showAllTables();
        if (!tables.includes(TABLE)) return;

        const rows = await sequelize.query<CapRow>(
            `SELECT role, capability FROM ${TABLE}
             WHERE capability IN (:legacy)`,
            {
                type: QueryTypes.SELECT,
                replacements: { legacy: [...LEGACY_DM, ...LEGACY_GUILD] }
            }
        );

        const dmRoles = new Set<string>();
        const guildRoles = new Set<string>();
        for (const row of rows) {
            if (LEGACY_DM.includes(row.capability)) dmRoles.add(row.role);
            if (LEGACY_GUILD.includes(row.capability)) guildRoles.add(row.role);
        }

        async function ensure(role: string, capability: string): Promise<void> {
            // Plain INSERT OR IGNORE — sequelize's bulkInsert doesn't
            // expose ON CONFLICT portably across dialects, but the
            // composite primary key (role, capability) means a duplicate
            // simply no-ops on SQLite/Postgres if we use INSERT ... WHERE NOT EXISTS.
            await sequelize.query(
                `INSERT INTO ${TABLE} (role, capability, "createdAt", "updatedAt")
                 SELECT :role, :capability, datetime('now'), datetime('now')
                 WHERE NOT EXISTS (
                     SELECT 1 FROM ${TABLE} WHERE role = :role AND capability = :capability
                 )`,
                { replacements: { role, capability } }
            );
        }

        for (const role of dmRoles) await ensure(role, 'dm.message');
        for (const role of guildRoles) {
            await ensure(role, 'guild.message');
            await ensure(role, 'guild.manage');
        }

        await sequelize.query(
            `DELETE FROM ${TABLE} WHERE capability IN (:legacy)`,
            { replacements: { legacy: [...LEGACY_DM, ...LEGACY_GUILD] } }
        );
    },
    down: async () => {
        // No-op — see the doc comment above.
    }
};

export default migration;
