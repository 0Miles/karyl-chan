import { Message } from 'discord.js';
import { DataTypes } from 'sequelize';
import { sequelize } from './db.js';

export const TodoMessage = sequelize.define('TodoMessage', {
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
    },
    // `createdAt` is set explicitly from the Discord message timestamp
    // (see addTodoMessage below) so we override Sequelize's automatic
    // timestamp behaviour with `timestamps: false` below — otherwise the
    // ORM would clobber the meaningful value with `Date.now()`.
    createdAt: DataTypes.DATE
}, {
    tableName: 'TodoMessages',
    timestamps: false
});

export const addTodoMessage = async (message: Message) => {
    await TodoMessage.findOrCreate({
        where: {
            messageId: message.id,
            channelId: message.channelId,
            guildId: message.guildId,
        },
        defaults: {
            messageId: message.id,
            channelId: message.channelId,
            guildId: message.guildId,
            createdAt: message.createdAt
        }
    });
}

export const removeTodoMessage = async (guildId: string, channelId: string, messageId: string) => {
    await TodoMessage.destroy({
        where: {
            channelId: channelId,
            messageId: messageId,
            guildId: guildId
        },
    });
}

export const findChannelTodoMessages = async (guildId: string, channelId: string) => {
    return await TodoMessage.findAll({
        where: {
            channelId: channelId,
            guildId: guildId
        },
        order: [
            ['createdAt', 'ASC']
        ],
    });
}