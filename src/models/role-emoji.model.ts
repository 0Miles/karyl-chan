import { DataTypes } from 'sequelize';
import { sequelize } from './db.js';

export const RoleEmoji = sequelize.define('RoleEmoji', {
    roleId: DataTypes.STRING,
    emojiName: DataTypes.STRING,
    emojiId: {
        type: DataTypes.STRING,
        primaryKey: true
    },
    emojiChar: {
        type: DataTypes.STRING,
        primaryKey: true
    },
    guildId: {
        type: DataTypes.STRING,
        primaryKey: true
    }
}, {
    tableName: 'RoleEmojis',
    timestamps: false
});

export const addRoleEmoji = async (guildId: string, roleId: string, emojiChar: string, emojiName: string, emojiId: string) => {
    await RoleEmoji.create({
        roleId: roleId,
        emojiChar: emojiChar,
        emojiId: emojiId,
        emojiName: emojiName,
        guildId: guildId
    });
}

export const removeRoleEmoji = async (guildId: string, emojiChar: string, emojiId: string) => {
    await RoleEmoji.destroy({
        where: {
            emojiChar: emojiChar,
            emojiId: emojiId,
            guildId: guildId
        },
    });
}

export const findRoleEmoji = async (guildId: string, emojiChar: string, emojiId: string) => {
    return await RoleEmoji.findOne({
        where: {
            emojiChar: emojiChar,
            emojiId: emojiId,
            guildId: guildId
        }
    });
}

export const findGuildAllRoleEmojis = async (guildId: string) => {
    return await RoleEmoji.findAll({
        where: {
            guildId: guildId
        }
    });
}