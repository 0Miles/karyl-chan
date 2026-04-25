import type { Migration } from './runner.js';

/**
 * Index RefreshTokens.ownerId so revoke-by-owner (sign-out, global
 * invalidate) doesn't full-scan the table. Idempotent: skips if the
 * index or table already exists. The model declaration uses the same
 * index name so a fresh `sync()` and an upgraded DB stay aligned.
 */
const INDEX_NAME = 'refresh_tokens_owner_id_idx';
const TABLE_NAME = 'RefreshTokens';

const migration: Migration = {
    up: async ({ queryInterface }) => {
        const tables = await queryInterface.showAllTables();
        if (!tables.includes(TABLE_NAME)) return;
        const indexes = await queryInterface.showIndex(TABLE_NAME) as Array<{ name: string }>;
        if (indexes.some(idx => idx.name === INDEX_NAME)) return;
        await queryInterface.addIndex(TABLE_NAME, {
            name: INDEX_NAME,
            fields: ['ownerId']
        });
    },
    down: async ({ queryInterface }) => {
        const tables = await queryInterface.showAllTables();
        if (!tables.includes(TABLE_NAME)) return;
        const indexes = await queryInterface.showIndex(TABLE_NAME) as Array<{ name: string }>;
        if (!indexes.some(idx => idx.name === INDEX_NAME)) return;
        await queryInterface.removeIndex(TABLE_NAME, INDEX_NAME);
    }
};

export default migration;
