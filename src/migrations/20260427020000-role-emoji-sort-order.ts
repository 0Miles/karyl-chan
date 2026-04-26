import { QueryTypes } from 'sequelize';
import type { Migration } from './runner.js';

/**
 * Add a `sortOrder` column to RoleEmojis so the watch command can
 * react in registration order. Pre-redesign the column didn't exist
 * and findAll relied on whatever order SQLite happened to return,
 * which is unspecified.
 *
 * Backfill: rows are ranked per `groupId` by their existing
 * `createdAt` (the closest proxy we have for "the order the operator
 * added them in"). Fresh installs sync() the column directly with
 * default 0; the column probe makes the migration a no-op there.
 *
 * `down` drops the column. Existing data ordering reverts to whatever
 * the storage engine returns — same behaviour as before this migration.
 */
const ROLE_EMOJIS_TABLE = 'RoleEmojis';
const COLUMN = 'sortOrder';

interface ExistingRow {
    groupId: number;
    emojiId: string;
    emojiChar: string;
    createdAt: string;
}

const migration: Migration = {
    up: async ({ queryInterface, sequelize }) => {
        const tables = await queryInterface.showAllTables();
        if (!tables.includes(ROLE_EMOJIS_TABLE)) return;
        const columns = await queryInterface.describeTable(ROLE_EMOJIS_TABLE);
        if (columns[COLUMN]) return;

        await queryInterface.addColumn(ROLE_EMOJIS_TABLE, COLUMN, {
            type: 'INTEGER',
            allowNull: false,
            defaultValue: 0
        });

        // Backfill per-group ranks. Doing one UPDATE per row keeps the
        // SQL portable across SQLite versions that lack window
        // functions; the table is small (mappings per guild rarely run
        // into the hundreds), so the row-by-row cost is irrelevant.
        const rows = await sequelize.query<ExistingRow>(
            `SELECT "groupId", "emojiId", "emojiChar", "createdAt"
             FROM "${ROLE_EMOJIS_TABLE}"
             ORDER BY "groupId" ASC, "createdAt" ASC`,
            { type: QueryTypes.SELECT }
        );
        const counters = new Map<number, number>();
        for (const row of rows) {
            const next = (counters.get(row.groupId) ?? -1) + 1;
            counters.set(row.groupId, next);
            await sequelize.query(
                `UPDATE "${ROLE_EMOJIS_TABLE}"
                 SET "${COLUMN}" = :order
                 WHERE "groupId" = :groupId
                   AND "emojiId" = :emojiId
                   AND "emojiChar" = :emojiChar`,
                {
                    replacements: {
                        order: next,
                        groupId: row.groupId,
                        emojiId: row.emojiId,
                        emojiChar: row.emojiChar
                    }
                }
            );
        }
    },
    down: async ({ queryInterface }) => {
        const tables = await queryInterface.showAllTables();
        if (!tables.includes(ROLE_EMOJIS_TABLE)) return;
        const columns = await queryInterface.describeTable(ROLE_EMOJIS_TABLE);
        if (!columns[COLUMN]) return;
        await queryInterface.removeColumn(ROLE_EMOJIS_TABLE, COLUMN);
    }
};

export default migration;
