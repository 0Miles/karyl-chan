import { DataTypes, Op } from "sequelize";
import { sequelize } from "../../../db.js";
import { config } from "../../../config.js";
import { Behavior } from "./behavior.model.js";

// behavior-session.model.ts：v2 schema 不變（PK=userId，FK=behaviorId→behaviors.id）
// v2 behaviors 表名稱相同，FK 仍正確對齊。

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
export const BehaviorSession = sequelize.define(
  "BehaviorSession",
  {
    userId: {
      type: DataTypes.STRING,
      primaryKey: true,
    },
    behaviorId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: Behavior, key: "id" },
      onDelete: "CASCADE",
      onUpdate: "CASCADE",
    },
    channelId: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    startedAt: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    expiresAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  },
  {
    tableName: "behavior_sessions",
    timestamps: true,
  },
);

export interface BehaviorSessionRow {
  userId: string;
  behaviorId: number;
  channelId: string;
  startedAt: string;
  /** ISO string when the session expires. null = never expires (legacy rows). */
  expiresAt: string | null;
}

function rowOf(
  model: InstanceType<typeof BehaviorSession>,
): BehaviorSessionRow {
  const expiresAtRaw = model.getDataValue("expiresAt");
  return {
    userId: model.getDataValue("userId") as string,
    behaviorId: model.getDataValue("behaviorId") as number,
    channelId: model.getDataValue("channelId") as string,
    startedAt: model.getDataValue("startedAt") as string,
    expiresAt:
      expiresAtRaw instanceof Date
        ? expiresAtRaw.toISOString()
        : (expiresAtRaw as string | null) ?? null,
  };
}

export const findActiveSession = async (
  userId: string,
): Promise<BehaviorSessionRow | null> => {
  const now = new Date();

  // 先順手清掉已過期的 session（避免殭屍 row 無限累積）
  await BehaviorSession.destroy({
    where: {
      userId,
      expiresAt: { [Op.lt]: now },
    },
  });

  // 讀取 session：只回傳尚未過期（expiresAt IS NULL OR expiresAt > now）
  const row = await BehaviorSession.findOne({
    where: {
      userId,
      [Op.or]: [
        { expiresAt: null },
        { expiresAt: { [Op.gt]: now } },
      ],
    },
  });

  return row ? rowOf(row) : null;
};

export const startSession = async (
  userId: string,
  behaviorId: number,
  channelId: string,
): Promise<BehaviorSessionRow> => {
  const startedAt = new Date().toISOString();
  const expireMs = config.behavior.sessionExpireHours * 60 * 60 * 1000;
  const expiresAt = new Date(Date.now() + expireMs).toISOString();
  await BehaviorSession.upsert({
    userId,
    behaviorId,
    channelId,
    startedAt,
    expiresAt,
  });
  return { userId, behaviorId, channelId, startedAt, expiresAt };
};

export const endSession = async (userId: string): Promise<boolean> => {
  const removed = await BehaviorSession.destroy({ where: { userId } });
  return removed > 0;
};

export const endSessionsForBehavior = async (
  behaviorId: number,
): Promise<void> => {
  await BehaviorSession.destroy({ where: { behaviorId } });
};
