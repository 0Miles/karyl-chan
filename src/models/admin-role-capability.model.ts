import { DataTypes } from 'sequelize';
import { sequelize } from './db.js';
import { AdminRole } from './admin-role.model.js';

/**
 * Bag-of-capabilities mapping: a role → one capability token. Composite PK
 * so the same role can hold many tokens without duplicates. Capability
 * tokens themselves are validated against the code's catalog at read time.
 */
export const AdminRoleCapability = sequelize.define('AdminRoleCapability', {
    role: {
        type: DataTypes.STRING,
        primaryKey: true,
        // FK → admin_roles(name). CASCADE mirrors the manual cascade the
        // service already does on role deletion; having it at the DB
        // layer means out-of-band deletes (SQL console, migrations) stay
        // consistent too.
        references: {
            model: AdminRole,
            key: 'name'
        },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE'
    },
    capability: {
        type: DataTypes.STRING,
        primaryKey: true
    }
}, {
    tableName: 'admin_role_capabilities',
    timestamps: true
});
