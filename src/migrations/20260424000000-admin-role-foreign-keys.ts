import type { Migration } from './runner.js';

/**
 * Retrofit foreign keys from authorized_users.role / admin_role_capabilities.role
 * onto admin_roles.name for DBs that were created by sync() before the FK
 * declarations landed in the models. SQLite can't add a FK with ALTER
 * TABLE, so the migration rebuilds each table via the standard SQLite
 * dance: create a shadow table with the new schema, copy rows, drop the
 * original, rename. PRAGMA foreign_keys is toggled off for the duration
 * so cascading effects don't fire during the copy.
 *
 * Idempotence: on fresh installs sync() already created the tables with
 * the FK (because the models now declare them). The guard query checks
 * whether the table's foreign_key_list reports a row pointing at
 * admin_roles; if so the migration is a no-op for that table.
 */

async function hasForeignKey(
    sequelize: import('sequelize').Sequelize,
    table: string,
    column: string,
    refTable: string
): Promise<boolean> {
    const rows = (await sequelize.query(`PRAGMA foreign_key_list("${table}")`))[0] as Array<{
        from: string;
        table: string;
    }>;
    return rows.some(r => r.from === column && r.table === refTable);
}

const migration: Migration = {
    up: async ({ sequelize }) => {
        const queryInterface = sequelize.getQueryInterface();
        const tables = await queryInterface.showAllTables();
        if (!tables.includes('authorized_users') && !tables.includes('admin_role_capabilities')) {
            // Nothing to migrate — tables not present yet (will be
            // created by sync() with FKs already in place).
            return;
        }

        await sequelize.query('PRAGMA foreign_keys = OFF;');
        const transaction = await sequelize.transaction();
        try {
            if (
                tables.includes('authorized_users')
                && !(await hasForeignKey(sequelize, 'authorized_users', 'role', 'admin_roles'))
            ) {
                await sequelize.query(`
                    CREATE TABLE authorized_users_new (
                        userId TEXT PRIMARY KEY,
                        role TEXT NOT NULL REFERENCES admin_roles(name) ON UPDATE CASCADE ON DELETE CASCADE,
                        note TEXT,
                        createdAt DATETIME NOT NULL,
                        updatedAt DATETIME NOT NULL
                    );
                `, { transaction });
                await sequelize.query(`
                    INSERT INTO authorized_users_new(userId, role, note, createdAt, updatedAt)
                    SELECT userId, role, note, createdAt, updatedAt FROM authorized_users;
                `, { transaction });
                await sequelize.query('DROP TABLE authorized_users;', { transaction });
                await sequelize.query('ALTER TABLE authorized_users_new RENAME TO authorized_users;', { transaction });
            }

            if (
                tables.includes('admin_role_capabilities')
                && !(await hasForeignKey(sequelize, 'admin_role_capabilities', 'role', 'admin_roles'))
            ) {
                await sequelize.query(`
                    CREATE TABLE admin_role_capabilities_new (
                        role TEXT NOT NULL REFERENCES admin_roles(name) ON UPDATE CASCADE ON DELETE CASCADE,
                        capability TEXT NOT NULL,
                        createdAt DATETIME NOT NULL,
                        updatedAt DATETIME NOT NULL,
                        PRIMARY KEY (role, capability)
                    );
                `, { transaction });
                await sequelize.query(`
                    INSERT INTO admin_role_capabilities_new(role, capability, createdAt, updatedAt)
                    SELECT role, capability, createdAt, updatedAt FROM admin_role_capabilities;
                `, { transaction });
                await sequelize.query('DROP TABLE admin_role_capabilities;', { transaction });
                await sequelize.query('ALTER TABLE admin_role_capabilities_new RENAME TO admin_role_capabilities;', { transaction });
            }

            await transaction.commit();
        } catch (err) {
            await transaction.rollback();
            throw err;
        } finally {
            await sequelize.query('PRAGMA foreign_keys = ON;');
        }
    },

    down: async () => {
        // Dropping a FK on SQLite needs the same rebuild dance in reverse.
        // Intentionally left empty — FK enforcement is additive and losing
        // it in a downgrade isn't worth the complexity.
    }
};

export default migration;
