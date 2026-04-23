import { DataTypes } from 'sequelize';
import { sequelize } from './db.js';

export const DmChannel = sequelize.define('DmChannel', {
    id: {
        type: DataTypes.STRING,
        primaryKey: true
    },
    recipientId: {
        type: DataTypes.STRING,
        allowNull: false
    },
    recipientUsername: {
        type: DataTypes.STRING,
        allowNull: false
    },
    recipientGlobalName: {
        type: DataTypes.STRING,
        allowNull: true
    },
    recipientAvatarUrl: {
        type: DataTypes.STRING,
        allowNull: true
    },
    lastMessageAt: {
        type: DataTypes.STRING,
        allowNull: true
    },
    lastMessagePreview: {
        type: DataTypes.STRING(160),
        allowNull: true
    }
}, { timestamps: false });
