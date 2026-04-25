import type { Migration } from './runner.js';

const TABLE = 'admin_audit_log';
const INDEX = 'admin_audit_log_actor_user_id_idx';

const migration: Migration = {
    up: async ({ queryInterface }) => {
        const tables = await queryInterface.showAllTables();
        if (!tables.includes(TABLE)) return;
        const indexes = await queryInterface.showIndex(TABLE) as Array<{ name: string }>;
        if (indexes.some(idx => idx.name === INDEX)) return;
        await queryInterface.addIndex(TABLE, { name: INDEX, fields: ['actorUserId'] });
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
