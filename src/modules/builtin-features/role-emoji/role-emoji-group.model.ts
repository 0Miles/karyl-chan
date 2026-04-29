import { DataTypes } from 'sequelize';
import { sequelize } from '../../../models/db.js';

/**
 * A named bucket of emoji→role mappings inside a guild. A watched
 * message can be associated with one or more groups; reactions only
 * resolve to a role when the emoji belongs to one of the message's
 * groups (or, when no groups are pinned, any group in the guild).
 *
 * The groups model lets one guild keep several independent reaction
 * sets — for example, a "self-assignable colours" board and a "pings
 * opt-in" board — without the same emoji on a different board granting
 * the wrong role.
 */
export const RoleEmojiGroup = sequelize.define('RoleEmojiGroup', {
    id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true
    },
    guildId: {
        type: DataTypes.STRING,
        allowNull: false
    },
    name: {
        type: DataTypes.STRING,
        allowNull: false
    }
}, {
    tableName: 'RoleEmojiGroups',
    indexes: [
        { unique: true, fields: ['guildId', 'name'] }
    ]
});

export const addRoleEmojiGroup = async (guildId: string, name: string) => {
    return await RoleEmojiGroup.create({ guildId, name });
};

export const removeRoleEmojiGroup = async (guildId: string, id: number) => {
    await RoleEmojiGroup.destroy({ where: { guildId, id } });
};

export const findRoleEmojiGroupByName = async (guildId: string, name: string) => {
    return await RoleEmojiGroup.findOne({ where: { guildId, name } });
};

export const findRoleEmojiGroupById = async (guildId: string, id: number) => {
    return await RoleEmojiGroup.findOne({ where: { guildId, id } });
};

export const findAllRoleEmojiGroups = async (guildId: string) => {
    return await RoleEmojiGroup.findAll({ where: { guildId }, order: [['name', 'ASC']] });
};
