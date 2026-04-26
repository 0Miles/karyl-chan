import { DataTypes, Op } from 'sequelize';
import { sequelize } from './db.js';
import { RoleEmojiGroup } from './role-emoji-group.model.js';

/**
 * Mapping between an emoji and a role inside a single
 * {@link RoleEmojiGroup}. The composite key (groupId, emojiId, emojiChar)
 * keeps the same physical emoji distinct across different groups so a
 * 👍 in group A can grant a different role from a 👍 in group B.
 *
 * `emojiId` is set for custom emoji and empty for unicode emoji;
 * `emojiChar` is set for unicode emoji and empty for custom emoji.
 * Exactly one of the two columns is non-empty per row.
 */
export const RoleEmoji = sequelize.define('RoleEmoji', {
    groupId: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        references: { model: RoleEmojiGroup, key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE'
    },
    emojiId: {
        type: DataTypes.STRING,
        primaryKey: true
    },
    emojiChar: {
        type: DataTypes.STRING,
        primaryKey: true
    },
    emojiName: DataTypes.STRING,
    roleId: DataTypes.STRING
}, {
    // Default `timestamps: true` is intentional — earlier deployments
    // created the table with NOT NULL createdAt/updatedAt columns.
    tableName: 'RoleEmojis'
});

export const addRoleEmoji = async (groupId: number, roleId: string, emojiChar: string, emojiName: string, emojiId: string) => {
    await RoleEmoji.create({ groupId, roleId, emojiChar, emojiName, emojiId });
};

export const removeRoleEmoji = async (groupId: number, emojiChar: string, emojiId: string) => {
    await RoleEmoji.destroy({ where: { groupId, emojiChar, emojiId } });
};

export const findRoleEmojiInGroup = async (groupId: number, emojiChar: string, emojiId: string) => {
    return await RoleEmoji.findOne({ where: { groupId, emojiChar, emojiId } });
};

export const findRoleEmojiInGroups = async (groupIds: number[], emojiChar: string, emojiId: string) => {
    if (groupIds.length === 0) return null;
    return await RoleEmoji.findOne({
        where: {
            groupId: { [Op.in]: groupIds },
            emojiChar,
            emojiId
        }
    });
};

export const findAllRoleEmojisInGroup = async (groupId: number) => {
    return await RoleEmoji.findAll({ where: { groupId } });
};

export const findAllRoleEmojisInGroups = async (groupIds: number[]) => {
    if (groupIds.length === 0) return [];
    return await RoleEmoji.findAll({ where: { groupId: { [Op.in]: groupIds } } });
};
