import { DataTypes } from 'sequelize';
import { sequelize } from './db.js';


export const PictureOnlyChannel = sequelize.define('PictureOnlyChannel', {
    channelId: {
        type: DataTypes.STRING,
        primaryKey: true
    },
    guildId: {
        type: DataTypes.STRING,
        primaryKey: true
    }
}, {
    tableName: 'PictureOnlyChannels',
    timestamps: false
});