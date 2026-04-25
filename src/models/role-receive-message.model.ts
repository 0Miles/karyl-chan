import { DataTypes } from 'sequelize';
import { sequelize } from './db.js';

export const RoleReceiveMessage = sequelize.define('RoleReceiveMessage', {
    messageId: {
        type: DataTypes.STRING,
        primaryKey: true
    },
    channelId: {
        type: DataTypes.STRING,
        primaryKey: true
    },
    guildId: {
        type: DataTypes.STRING,
        primaryKey: true
    }
}, {
    // Default `timestamps: true` is intentional — earlier deployments
    // created the table with NOT NULL createdAt/updatedAt columns.
    tableName: 'RoleReceiveMessages'
});

export const addRoleReceiveMessage = async (guildId: string, channelId: string, messageId: string) => {
    await RoleReceiveMessage.create({
        guildId,
        channelId,
        messageId
    });
}

export const removeRoleReceiveMessage = async (guildId: string, channelId: string, messageId: string) => {
    await RoleReceiveMessage.destroy({
        where: {
            guildId,
            channelId,
            messageId
        },
    });
}

export const findRoleReceiveMessage = async (guildId: string, channelId: string, messageId: string) => {
    return await RoleReceiveMessage.findOne({
        where: {
            guildId,
            channelId,
            messageId
        },
    });
}
