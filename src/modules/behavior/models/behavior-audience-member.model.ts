import { DataTypes } from "sequelize";
import { sequelize } from "../../../db.js";
import { Behavior } from "./behavior.model.js";

/**
 * v2 audience 成員清單。取代舊 behavior_target_members 表。
 *
 * 對應 A-schema §1.3 behavior_audience_members：
 *   - PK：(behaviorId, userId)
 *   - FK：behaviorId → behaviors(id) ON DELETE CASCADE
 *
 * 只在 audienceKind='group' 的 behavior 使用。
 * audienceKind='user' 的 behavior 直接用 behaviors.audienceUserId，不需要此表。
 */
export const BehaviorAudienceMember = sequelize.define(
  "BehaviorAudienceMember",
  {
    behaviorId: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      references: { model: Behavior, key: "id" },
      onDelete: "CASCADE",
      onUpdate: "CASCADE",
    },
    userId: {
      type: DataTypes.TEXT,
      primaryKey: true,
    },
  },
  {
    tableName: "behavior_audience_members",
    timestamps: true,
  },
);

export interface BehaviorAudienceMemberRow {
  behaviorId: number;
  userId: string;
}

export const findAudienceMembers = async (
  behaviorId: number,
): Promise<string[]> => {
  const rows = await BehaviorAudienceMember.findAll({
    where: { behaviorId },
    order: [["userId", "ASC"]],
  });
  return rows.map((r) => r.getDataValue("userId") as string);
};

export const addAudienceMember = async (
  behaviorId: number,
  userId: string,
): Promise<void> => {
  await BehaviorAudienceMember.upsert({ behaviorId, userId });
};

export const removeAudienceMember = async (
  behaviorId: number,
  userId: string,
): Promise<void> => {
  await BehaviorAudienceMember.destroy({ where: { behaviorId, userId } });
};

export const replaceAudienceMembers = async (
  behaviorId: number,
  userIds: string[],
): Promise<void> => {
  await sequelize.transaction(async (t) => {
    await BehaviorAudienceMember.destroy({
      where: { behaviorId },
      transaction: t,
    });
    if (userIds.length === 0) return;
    const unique = Array.from(new Set(userIds));
    await BehaviorAudienceMember.bulkCreate(
      unique.map((userId) => ({ behaviorId, userId })),
      { transaction: t },
    );
  });
};
