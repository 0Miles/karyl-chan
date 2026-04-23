import { DataTypes } from 'sequelize';
import { sequelize } from './db.js';

export const DmMessage = sequelize.define('DmMessage', {
    id: {
        type: DataTypes.STRING,
        primaryKey: true
    },
    channelId: {
        type: DataTypes.STRING,
        allowNull: false
    },
    createdAt: {
        type: DataTypes.STRING,
        allowNull: false
    },
    data: {
        type: DataTypes.TEXT,
        allowNull: false
    }
}, {
    timestamps: false,
    indexes: [
        { fields: ['channelId', 'createdAt'] }
    ]
});
