import { DataTypes } from 'sequelize';
import { sequelize } from './db.js';
import { Behavior } from './behavior.model.js';

/**
 * Active continuous-forward state for a user. Persisted in DB so a bot
 * restart resumes forwarding on the next DM from that user — the
 * contract is "if a session row exists, the next inbound DM gets POSTed
 * to that behavior's webhook regardless of triggers."
 *
 * One row per user (PK = userId): a user can only run one continuous
 * session at a time. Starting a new continuous behavior while a session
 * is active is forbidden by the event handler — the user must /break
 * first or the prior webhook must reply with [BEHAVIOR:END].
 *
 * `channelId` is captured so the relay-back path can DM the user even
 * if Discord's cache cold-misses on a subsequent restart.
 */
export const BehaviorSession = sequelize.define('BehaviorSession', {
    userId: {
        type: DataTypes.STRING,
        primaryKey: true
    },
    behaviorId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: Behavior, key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE'
    },
    channelId: {
        type: DataTypes.STRING,
        allowNull: false
    },
    startedAt: {
        type: DataTypes.STRING,
        allowNull: false
    }
}, {
    tableName: 'behavior_sessions',
    timestamps: true
});

export interface BehaviorSessionRow {
    userId: string;
    behaviorId: number;
    channelId: string;
    startedAt: string;
}

function rowOf(model: InstanceType<typeof BehaviorSession>): BehaviorSessionRow {
    return {
        userId: model.getDataValue('userId') as string,
        behaviorId: model.getDataValue('behaviorId') as number,
        channelId: model.getDataValue('channelId') as string,
        startedAt: model.getDataValue('startedAt') as string
    };
}

export const findActiveSession = async (userId: string): Promise<BehaviorSessionRow | null> => {
    const row = await BehaviorSession.findByPk(userId);
    return row ? rowOf(row) : null;
};

export const startSession = async (userId: string, behaviorId: number, channelId: string): Promise<BehaviorSessionRow> => {
    const startedAt = new Date().toISOString();
    await BehaviorSession.upsert({ userId, behaviorId, channelId, startedAt });
    return { userId, behaviorId, channelId, startedAt };
};

export const endSession = async (userId: string): Promise<boolean> => {
    const removed = await BehaviorSession.destroy({ where: { userId } });
    return removed > 0;
};

export const endSessionsForBehavior = async (behaviorId: number): Promise<void> => {
    await BehaviorSession.destroy({ where: { behaviorId } });
};
