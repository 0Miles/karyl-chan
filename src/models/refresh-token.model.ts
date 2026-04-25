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
}, {
    tableName: 'RefreshTokens',
    timestamps: false,
    // ownerId is the lookup column for sign-out / global revoke (see
    // refresh-token.repository#deleteByOwner). Without this index every
    // logout walks the whole table.
    indexes: [
        { name: 'refresh_tokens_owner_id_idx', fields: ['ownerId'] }
    ]
});
