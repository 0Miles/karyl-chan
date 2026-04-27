import type { Migration } from './runner.js';

/**
 * Create the `bot_events` table for persistent bot lifecycle / runtime
 * event storage. Replaces the in-memory SystemEventLog which was
 * discarded on every restart.
 *
 * Idempotent: if the table already exists (fresh sync() or re-run),
 * the migration is a no-op.
 *
 * `down` drops the table entirely — data loss is acceptable here since
 * the rows are operational logs, not business records.
 */
const migration: Migration = {
    up: async ({ queryInterface }) => {
        const tables = await queryInterface.showAllTables();
        if (tables.includes('bot_events')) return;

        await queryInterface.sequelize.query(`
            CREATE TABLE bot_events (
                id          INTEGER  PRIMARY KEY AUTOINCREMENT,
                level       TEXT     NOT NULL,
                category    TEXT     NOT NULL,
                message     TEXT     NOT NULL,
                context     TEXT,
                createdAt   DATETIME NOT NULL,
                updatedAt   DATETIME NOT NULL
            );
        `);

        await queryInterface.sequelize.query(`
            CREATE INDEX bot_events_created_at_idx
                ON bot_events (createdAt DESC);
        `);

        await queryInterface.sequelize.query(`
            CREATE INDEX bot_events_level_created_at_idx
                ON bot_events (level, createdAt DESC);
        `);

        await queryInterface.sequelize.query(`
            CREATE INDEX bot_events_category_created_at_idx
                ON bot_events (category, createdAt DESC);
        `);
    },

    down: async ({ queryInterface }) => {
        await queryInterface.sequelize.query(`DROP TABLE IF EXISTS bot_events;`);
    }
};

export default migration;
