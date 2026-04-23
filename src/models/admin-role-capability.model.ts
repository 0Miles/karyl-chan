import { DataTypes } from 'sequelize';
import { sequelize } from './db.js';

/**
 * Bag-of-capabilities mapping: a role → one capability token. Composite PK
 * so the same role can hold many tokens without duplicates.
 */
export const AdminRoleCapability = sequelize.define('AdminRoleCapability', {
    role: {
        type: DataTypes.STRING,
        primaryKey: true
    },
    capability: {
        type: DataTypes.STRING,
        primaryKey: true
    }
}, {
    tableName: 'admin_role_capabilities',
    timestamps: true
});
