import { QueryTypes } from 'sequelize';
import type { Migration } from './runner.js';

/**
 * Collapse role-receive watched messages to a single bound group.
 *
 * Pre-redesign each watched message could pin a subset of groups via
 * the `RoleReceiveMessageGroups` junction (or zero rows → "use every
 * group in the guild"). The new model is one watched message → one
 * group, so we hoist the group id onto the message row itself and
 * drop the junction.
 *
 * Migration steps:
 *   1. If `RoleReceiveMessages.groupId` already exists, no-op
 *      (fresh installs sync() the new schema directly).
 *   2. Otherwise rebuild `RoleReceiveMessages` with the new schema,
 *      seeded by joining with `RoleReceiveMessageGroups`:
 *        - exactly one matching junction row → carry that groupId.
 *        - >1 matching → pick the smallest groupId so the choice is
 *          deterministic; operators can re-bind via the UI.
 *        - 0 matching (legacy "no pin" rows) → drop entirely; with no
 *          target group their reactions can't resolve to a role under
 *          the new rules.
 *   3. Drop `RoleReceiveMessageGroups` — no caller reads it after this.
 *
 * SQLite doesn't support `ALTER COLUMN` to add a NOT NULL FK, so the
 * step-2 rebuild creates `_new`, copies, drops, renames. The temp name
 * is process-private; concurrent migrations don't run, so collision is
 * not a concern.
 *
 * `down` is a no-op — reversing requires the original junction layout
 * and would lose the post-migration single-group binding intent.
 * Operators rolling back should restore from a backup.
 */
const TABLE = 'RoleReceiveMessages';
const JUNCTION = 'RoleReceiveMessageGroups';
const TEMP = 'RoleReceiveMessages_new';

interface SeedRow {
    guildId: string;
    channelId: string;
    messageId: string;
    groupId: number;
    createdAt: string;
    updatedAt: string;
}

const migration: Migration = {
    up: async ({ queryInterface, sequelize }) => {
        const tables = await queryInterface.showAllTables();
        if (!tables.includes(TABLE)) return;
        const columns = await queryInterface.describeTable(TABLE);
        if (columns['groupId']) return;

        // The junction may not exist on installs that pre-date the
        // groups migration; treat its absence as "no rows to seed."
        const hasJunction = tables.includes(JUNCTION);

        const seedRows = hasJunction
            ? await sequelize.query<SeedRow>(
                  `SELECT m."guildId" AS "guildId",
                          m."channelId" AS "channelId",
                          m."messageId" AS "messageId",
                          MIN(j."groupId") AS "groupId",
                          m."createdAt" AS "createdAt",
                          m."updatedAt" AS "updatedAt"
                   FROM "${TABLE}" m
                   INNER JOIN "${JUNCTION}" j
                     ON j."guildId" = m."guildId"
                    AND j."channelId" = m."channelId"
                    AND j."messageId" = m."messageId"
                   GROUP BY m."guildId", m."channelId", m."messageId",
                            m."createdAt", m."updatedAt"`,
                  { type: QueryTypes.SELECT }
              )
            : [];

        await sequelize.query(`
            CREATE TABLE ${TEMP} (
                guildId   TEXT    NOT NULL,
                channelId TEXT    NOT NULL,
                messageId TEXT    NOT NULL,
                groupId   INTEGER NOT NULL,
                createdAt DATETIME NOT NULL,
                updatedAt DATETIME NOT NULL,
                PRIMARY KEY (guildId, channelId, messageId),
                FOREIGN KEY (groupId) REFERENCES RoleEmojiGroups(id) ON DELETE CASCADE ON UPDATE CASCADE
            );
        `);

        for (const row of seedRows) {
            await sequelize.query(
                `INSERT INTO ${TEMP} ("guildId", "channelId", "messageId", "groupId", "createdAt", "updatedAt")
                 VALUES (:guildId, :channelId, :messageId, :groupId, :createdAt, :updatedAt)`,
                { replacements: { ...row } }
            );
        }

        await sequelize.query(`DROP TABLE "${TABLE}";`);
        await sequelize.query(`ALTER TABLE ${TEMP} RENAME TO ${TABLE};`);

        if (hasJunction) {
            await sequelize.query(`DROP TABLE "${JUNCTION}";`);
        }
    },
    down: async () => {
        // Intentionally no-op — see header.
    }
};

export default migration;
