import { DataTypes, Op } from 'sequelize';
import { sequelize } from '../../../db.js';

/**
 * A target that a DM message can be matched against. Three kinds:
 *
 *   - 'all_dms'  — singleton (id=1); matches every DM sender. Seeded by
 *                  the webhook-behavior migration; never deleted.
 *   - 'user'     — matches a single Discord user; userId is the snowflake.
 *   - 'group'    — matches any user listed in behavior_target_members for
 *                  this row; groupName is the human-readable label.
 *
 * Uniqueness for 'user' and 'group' is enforced by partial unique indexes
 * created in the migration (allow many all_dms-key rows in principle, but
 * the all_dms partial index pins it to one).
 */
export const BehaviorTarget = sequelize.define('BehaviorTarget', {
    id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true
    },
    kind: {
        type: DataTypes.STRING,
        allowNull: false,
        validate: {
            isIn: [['all_dms', 'user', 'group']]
        }
    },
    userId: {
        type: DataTypes.STRING,
        allowNull: true
    },
    groupName: {
        type: DataTypes.STRING,
        allowNull: true
    }
}, {
    tableName: 'behavior_targets',
    timestamps: true
});

export const ALL_DMS_TARGET_ID = 1;

export type BehaviorTargetKind = 'all_dms' | 'user' | 'group';

export interface BehaviorTargetRow {
    id: number;
    kind: BehaviorTargetKind;
    userId: string | null;
    groupName: string | null;
}

export const findAllBehaviorTargets = async (): Promise<BehaviorTargetRow[]> => {
    const rows = await BehaviorTarget.findAll({ order: [['id', 'ASC']] });
    return rows.map(r => ({
        id: r.getDataValue('id') as number,
        kind: r.getDataValue('kind') as BehaviorTargetKind,
        userId: (r.getDataValue('userId') as string | null) ?? null,
        groupName: (r.getDataValue('groupName') as string | null) ?? null
    }));
};

export const findBehaviorTargetById = async (id: number): Promise<BehaviorTargetRow | null> => {
    const row = await BehaviorTarget.findByPk(id);
    if (!row) return null;
    return {
        id: row.getDataValue('id') as number,
        kind: row.getDataValue('kind') as BehaviorTargetKind,
        userId: (row.getDataValue('userId') as string | null) ?? null,
        groupName: (row.getDataValue('groupName') as string | null) ?? null
    };
};

export const findUserTarget = async (userId: string): Promise<BehaviorTargetRow | null> => {
    const row = await BehaviorTarget.findOne({ where: { kind: 'user', userId } });
    if (!row) return null;
    return {
        id: row.getDataValue('id') as number,
        kind: 'user',
        userId,
        groupName: null
    };
};

export const findGroupTargetByName = async (groupName: string): Promise<BehaviorTargetRow | null> => {
    const row = await BehaviorTarget.findOne({ where: { kind: 'group', groupName } });
    if (!row) return null;
    return {
        id: row.getDataValue('id') as number,
        kind: 'group',
        userId: null,
        groupName
    };
};

export const createUserTarget = async (userId: string): Promise<BehaviorTargetRow> => {
    const row = await BehaviorTarget.create({ kind: 'user', userId, groupName: null });
    return {
        id: row.getDataValue('id') as number,
        kind: 'user',
        userId,
        groupName: null
    };
};

export const createGroupTarget = async (groupName: string): Promise<BehaviorTargetRow> => {
    const row = await BehaviorTarget.create({ kind: 'group', userId: null, groupName });
    return {
        id: row.getDataValue('id') as number,
        kind: 'group',
        userId: null,
        groupName
    };
};

export const renameGroupTarget = async (id: number, newName: string): Promise<void> => {
    await BehaviorTarget.update({ groupName: newName }, { where: { id, kind: 'group' } });
};

export const deleteBehaviorTarget = async (id: number): Promise<void> => {
    if (id === ALL_DMS_TARGET_ID) {
        throw new Error('all_dms target is not deletable');
    }
    await BehaviorTarget.destroy({ where: { id, kind: { [Op.ne]: 'all_dms' } } });
};

/**
 * Ensure the all_dms singleton exists. The migration seeds it, but a
 * fresh sync()'d DB (no migration history) won't have it — call this
 * once on startup as a safety net.
 */
export const ensureAllDmsTarget = async (): Promise<void> => {
    const existing = await BehaviorTarget.findByPk(ALL_DMS_TARGET_ID);
    if (existing) return;
    await BehaviorTarget.create({
        id: ALL_DMS_TARGET_ID,
        kind: 'all_dms',
        userId: null,
        groupName: null
    });
};
