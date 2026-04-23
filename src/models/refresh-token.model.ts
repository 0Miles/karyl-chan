import { DataTypes } from 'sequelize';
import { sequelize } from './db.js';

export const RefreshToken = sequelize.define('RefreshToken', {
    hash: {
        type: DataTypes.STRING,
        primaryKey: true
    },
    ownerId: {
        type: DataTypes.STRING,
        allowNull: false
    },
    expiresAt: {
        type: DataTypes.BIGINT,
        allowNull: false
    }
});
