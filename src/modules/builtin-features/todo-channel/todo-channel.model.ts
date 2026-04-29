import { DataTypes } from 'sequelize';
import { sequelize } from '../../../models/db.js';

export const TodoChannel = sequelize.define('TodoChannel', {
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
    tableName: 'TodoChannels'
});

export const findTodoChannel = async (guildId: string, channelId: string) => {
    return await TodoChannel.findOne({
        where: {
            channelId: channelId,
            guildId: guildId
        }
    });
}

export const addTodoChannel = async (guildId: string, channelId: string) => {
    await TodoChannel.create({
        channelId: channelId,
        guildId: guildId
    });
}
