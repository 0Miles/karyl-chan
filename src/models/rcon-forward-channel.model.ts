import { DataTypes } from 'sequelize';
import { sequelize } from './db.js';


export const RconForwardChannel = sequelize.define('RconForwardChannel', {
    channelId: {
        type: DataTypes.STRING,
        primaryKey: true
    },
    guildId: {
        type: DataTypes.STRING,
        primaryKey: true
    },
    commandPrefix: DataTypes.STRING,
    triggerPrefix: DataTypes.STRING,
    host: DataTypes.STRING,
    port: DataTypes.INTEGER,
    password: DataTypes.STRING
}, {
    tableName: 'RconForwardChannels',
    timestamps: false
});