import { QueryTypes } from 'sequelize';
import type { Migration } from './runner.js';

/**
 * Add a unique index on DmChannels.recipientId. Discord enforces
 * one-DM-channel-per-recipient as an invariant, but the table never
 * encoded that — a misbehaving import or race could leave duplicate
 * rows pointing at the same recipient with different channel ids.
 *
 * Pre-flight: collapse any existing duplicates by keeping the row
 * with the most recent `lastMessageAt` (ISO 8601 string sort) and
 * deleting the rest. Falls back to the highest channel id (newer
 * snowflake) when none of the duplicates have activity recorded.
 */
const TABLE = 'DmChannels';
const INDEX = 'dm_channels_recipient_id_unique';

interface DupRow { recipientId: string }
interface ChannelRow { id: string; lastMessageAt: string | null }

const migration: Migration = {
    up: async ({ queryInterface, sequelize }) => {
        const tables = await queryInterface.showAllTables();
        if (!tables.includes(TABLE)) return;

        const indexes = await queryInterface.showIndex(TABLE) as Array<{ name: string }>;
        if (indexes.some(idx => idx.name === INDEX)) return;

        const dups = await sequelize.query<DupRow>(
            `SELECT recipientId FROM ${TABLE} GROUP BY recipientId HAVING COUNT(*) > 1`,
            { type: QueryTypes.SELECT }
        );
        for (const { recipientId } of dups) {
            const rows = await sequelize.query<ChannelRow>(
                `SELECT id, lastMessageAt FROM ${TABLE} WHERE recipientId = :recipientId`,
                { type: QueryTypes.SELECT, replacements: { recipientId } }
            );
            // Keep the most-recently active row; tie-break on newer
            // channel id (snowflakes increase monotonically).
            const keep = rows.reduce((best, row) => {
                const bestKey = best.lastMessageAt ?? '';
                const rowKey = row.lastMessageAt ?? '';
                if (rowKey > bestKey) return row;
                if (rowKey === bestKey && row.id > best.id) return row;
                return best;
            }, rows[0]);
            await sequelize.query(
                `DELETE FROM ${TABLE} WHERE recipientId = :recipientId AND id != :keepId`,
                { type: QueryTypes.DELETE, replacements: { recipientId, keepId: keep.id } }
            );
        }

        await queryInterface.addIndex(TABLE, {
            name: INDEX,
            fields: ['recipientId'],
            unique: true
        });
    },
    down: async ({ queryInterface }) => {
        const tables = await queryInterface.showAllTables();
        if (!tables.includes(TABLE)) return;
        const indexes = await queryInterface.showIndex(TABLE) as Array<{ name: string }>;
        if (!indexes.some(idx => idx.name === INDEX)) return;
        await queryInterface.removeIndex(TABLE, INDEX);
    }
};

export default migration;
