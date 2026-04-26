import { DataTypes, Op } from 'sequelize';
import { sequelize } from './db.js';
import { RoleEmojiGroup } from './role-emoji-group.model.js';

/**
 * Junction between a watched message and the {@link RoleEmojiGroup}s
 * whose mappings should be honoured on that message. When no rows
 * exist for a watched message, the runtime treats it as "use every
 * group in the guild" so legacy single-group setups keep working.
 */
export const RoleReceiveMessageGroup = sequelize.define('RoleReceiveMessageGroup', {
    guildId: { type: DataTypes.STRING, primaryKey: true },
    channelId: { type: DataTypes.STRING, primaryKey: true },
    messageId: { type: DataTypes.STRING, primaryKey: true },
    groupId: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        references: { model: RoleEmojiGroup, key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE'
    }
}, {
    tableName: 'RoleReceiveMessageGroups'
});

export const findMessageGroupIds = async (guildId: string, channelId: string, messageId: string): Promise<number[]> => {
    const rows = await RoleReceiveMessageGroup.findAll({ where: { guildId, channelId, messageId } });
    return rows.map(r => r.getDataValue('groupId') as number);
};

export const setMessageGroups = async (guildId: string, channelId: string, messageId: string, groupIds: number[]) => {
    await sequelize.transaction(async (transaction) => {
        await RoleReceiveMessageGroup.destroy({ where: { guildId, channelId, messageId }, transaction });
        if (groupIds.length === 0) return;
        const unique = [...new Set(groupIds)];
        await RoleReceiveMessageGroup.bulkCreate(
            unique.map(groupId => ({ guildId, channelId, messageId, groupId })),
            { transaction }
        );
    });
};

export const removeAllMessageGroups = async (guildId: string, channelId: string, messageId: string) => {
    await RoleReceiveMessageGroup.destroy({ where: { guildId, channelId, messageId } });
};

export const findAllMessageGroupsByGuild = async (guildId: string) => {
    return await RoleReceiveMessageGroup.findAll({ where: { guildId } });
};

export const findMessageGroupsForGroupIds = async (guildId: string, groupIds: number[]) => {
    if (groupIds.length === 0) return [];
    return await RoleReceiveMessageGroup.findAll({
        where: { guildId, groupId: { [Op.in]: groupIds } }
    });
};
