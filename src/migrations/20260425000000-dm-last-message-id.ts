import { DataTypes } from 'sequelize';
import type { Migration } from './runner.js';

/**
 * Add `lastMessageId` to DmChannels so the unread-count batch endpoint
 * can pass it to Discord's `messages.fetch({ after })`. Timestamp-based
 * markers (`lastMessageAt`) still exist for display but the Discord
 * REST API can't filter by them directly.
 */
const migration: Migration = {
    up: async ({ queryInterface }) => {
        const tables = await queryInterface.showAllTables();
        if (!tables.includes('DmChannels')) return;
        const columns = await queryInterface.describeTable('DmChannels');
        if (columns.lastMessageId) return;
        await queryInterface.addColumn('DmChannels', 'lastMessageId', {
            type: DataTypes.STRING,
            allowNull: true,
        });
    },
    down: async ({ queryInterface }) => {
        const tables = await queryInterface.showAllTables();
        if (!tables.includes('DmChannels')) return;
        const columns = await queryInterface.describeTable('DmChannels');
        if (!columns.lastMessageId) return;
        await queryInterface.removeColumn('DmChannels', 'lastMessageId');
    },
};

export default migration;
