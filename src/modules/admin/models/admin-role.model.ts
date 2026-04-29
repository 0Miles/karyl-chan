import { DataTypes } from 'sequelize';
import { sequelize } from '../../../models/db.js';

/**
 * Named role assignable to AuthorizedUser rows. The capability tokens a role
 * confers live in admin_role_capabilities so the mapping is pure data and
 * can be edited by the owner at runtime.
 */
export const AdminRole = sequelize.define('AdminRole', {
    name: {
        type: DataTypes.STRING,
        primaryKey: true
    },
    description: {
        type: DataTypes.STRING,
        allowNull: true
    }
}, {
    tableName: 'admin_roles',
    timestamps: true
});
