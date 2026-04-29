import { DataTypes } from "sequelize";
import { sequelize } from "../../../db.js";
import { BehaviorTarget } from "./behavior-target.model.js";

/**
 * Membership join for kind='group' BehaviorTarget rows. (targetId, userId)
 * is the primary key — one user can belong to many groups, and a group
 * can have many users. CASCADE on the FK so deleting a group target
 * cleans the membership in lockstep.
 */
export const BehaviorTargetMember = sequelize.define(
  "BehaviorTargetMember",
  {
    targetId: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      references: { model: BehaviorTarget, key: "id" },
      onDelete: "CASCADE",
      onUpdate: "CASCADE",
    },
    userId: {
      type: DataTypes.STRING,
      primaryKey: true,
    },
  },
  {
    tableName: "behavior_target_members",
    timestamps: true,
  },
);

export const findGroupMembers = async (targetId: number): Promise<string[]> => {
  const rows = await BehaviorTargetMember.findAll({
    where: { targetId },
    order: [["userId", "ASC"]],
  });
  return rows.map((r) => r.getDataValue("userId") as string);
};

export const findGroupTargetIdsForUser = async (
  userId: string,
): Promise<number[]> => {
  const rows = await BehaviorTargetMember.findAll({ where: { userId } });
  return rows.map((r) => r.getDataValue("targetId") as number);
};

export const addGroupMember = async (
  targetId: number,
  userId: string,
): Promise<void> => {
  await BehaviorTargetMember.upsert({ targetId, userId });
};

export const removeGroupMember = async (
  targetId: number,
  userId: string,
): Promise<void> => {
  await BehaviorTargetMember.destroy({ where: { targetId, userId } });
};

export const replaceGroupMembers = async (
  targetId: number,
  userIds: string[],
): Promise<void> => {
  await sequelize.transaction(async (t) => {
    await BehaviorTargetMember.destroy({ where: { targetId }, transaction: t });
    if (userIds.length === 0) return;
    // De-dupe defensively — UI should prevent it but a stray double-paste
    // shouldn't tank the whole replace.
    const unique = Array.from(new Set(userIds));
    await BehaviorTargetMember.bulkCreate(
      unique.map((userId) => ({ targetId, userId })),
      { transaction: t },
    );
  });
};
