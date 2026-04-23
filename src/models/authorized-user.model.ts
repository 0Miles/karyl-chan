import { DataTypes } from 'sequelize';
import { sequelize } from './db.js';

/**
 * Non-owner Discord users allowed to request login tokens from the bot. The
 * `role` column references AdminRole.name; actual capabilities are looked
 * up through admin_role_capabilities. The bot owner (BOT_OWNER_ID env var)
 * is always authorized implicitly and receives every capability.
 */
export const AuthorizedUser = sequelize.define('AuthorizedUser', {
    userId: {
        type: DataTypes.STRING,
        primaryKey: true
    },
    role: {
        type: DataTypes.STRING,
        allowNull: false
    },
    note: {
        type: DataTypes.STRING,
        allowNull: true
    }
}, {
    tableName: 'authorized_users',
    timestamps: true
});
