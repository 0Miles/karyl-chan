import { DataTypes } from 'sequelize';
import { sequelize } from './db.js';
import { RoleEmojiGroup } from './role-emoji-group.model.js';

/**
 * Watched message → emoji group binding. Each row represents one
 * Discord message that the bot tracks for reaction-role behaviour;
 * `groupId` is the single {@link RoleEmojiGroup} whose mappings apply.
 *
 * The bot does not allow more than one group per message — the prior
 * many-to-many junction has been migrated away (see
 * `20260427030000-role-receive-single-group`). Only mappings inside
 * the bound group can grant a role on this message.
 */
export const RoleReceiveMessage = sequelize.define('RoleReceiveMessage', {
    messageId: { type: DataTypes.STRING, primaryKey: true },
    channelId: { type: DataTypes.STRING, primaryKey: true },
    guildId: { type: DataTypes.STRING, primaryKey: true },
    groupId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: RoleEmojiGroup, key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE'
    }
}, {
    // Default `timestamps: true` is intentional — earlier deployments
    // created the table with NOT NULL createdAt/updatedAt columns.
    tableName: 'RoleReceiveMessages'
});

export const upsertRoleReceiveMessage = async (
    guildId: string,
    channelId: string,
    messageId: string,
    groupId: number
): Promise<void> => {
    await RoleReceiveMessage.upsert({ guildId, channelId, messageId, groupId });
};

export const removeRoleReceiveMessage = async (guildId: string, channelId: string, messageId: string): Promise<void> => {
    await RoleReceiveMessage.destroy({ where: { guildId, channelId, messageId } });
};

export const findRoleReceiveMessage = async (guildId: string, channelId: string, messageId: string) => {
    return await RoleReceiveMessage.findOne({ where: { guildId, channelId, messageId } });
};

export const findAllRoleReceiveMessagesByGuild = async (guildId: string) => {
    return await RoleReceiveMessage.findAll({ where: { guildId } });
};
