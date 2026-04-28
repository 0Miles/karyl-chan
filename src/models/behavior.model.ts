import { DataTypes } from "sequelize";
import { sequelize } from "./db.js";
import { BehaviorTarget } from "./behavior-target.model.js";

export type BehaviorTriggerType = "startswith" | "endswith" | "regex";
export type BehaviorForwardType = "one_time" | "continuous";

/**
 * One trigger → webhook forward rule, owned by a BehaviorTarget. Rules
 * within a target are evaluated in sortOrder ASC; if `stopOnMatch` is set
 * on a rule that fires, evaluation halts entirely (across all subsequent
 * targets and rules).
 *
 * `webhookUrl` is stored AES-encrypted by the route layer (see
 * web/behavior-routes.ts) — the model itself does not encrypt/decrypt so
 * helper queries can opt into raw access for the dispatcher.
 */
export const Behavior = sequelize.define(
  "Behavior",
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    targetId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: BehaviorTarget, key: "id" },
      onDelete: "CASCADE",
      onUpdate: "CASCADE",
    },
    title: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: false,
      defaultValue: "",
    },
    triggerType: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        isIn: [["startswith", "endswith", "regex"]],
      },
    },
    triggerValue: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    forwardType: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        isIn: [["one_time", "continuous"]],
      },
    },
    webhookUrl: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    webhookSecret: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    sortOrder: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    stopOnMatch: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    enabled: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
  },
  {
    tableName: "behaviors",
    timestamps: true,
  },
);

export interface BehaviorRow {
  id: number;
  targetId: number;
  title: string;
  description: string;
  triggerType: BehaviorTriggerType;
  triggerValue: string;
  forwardType: BehaviorForwardType;
  /** Encrypted at rest. Decrypt via utils/crypto.decryptSecret before use. */
  webhookUrl: string;
  /**
   * Optional HMAC secret (encrypted at rest). When set, the dispatcher
   * signs each outgoing POST and requires a matching signature on the
   * webhook's response. NULL means "no signing/verification".
   */
  webhookSecret: string | null;
  sortOrder: number;
  stopOnMatch: boolean;
  enabled: boolean;
}

function rowOf(model: InstanceType<typeof Behavior>): BehaviorRow {
  return {
    id: model.getDataValue("id") as number,
    targetId: model.getDataValue("targetId") as number,
    title: model.getDataValue("title") as string,
    description: (model.getDataValue("description") as string) ?? "",
    triggerType: model.getDataValue("triggerType") as BehaviorTriggerType,
    triggerValue: model.getDataValue("triggerValue") as string,
    forwardType: model.getDataValue("forwardType") as BehaviorForwardType,
    webhookUrl: model.getDataValue("webhookUrl") as string,
    webhookSecret:
      (model.getDataValue("webhookSecret") as string | null) ?? null,
    sortOrder: model.getDataValue("sortOrder") as number,
    stopOnMatch: !!model.getDataValue("stopOnMatch"),
    enabled: !!model.getDataValue("enabled"),
  };
}

export const findBehaviorsByTarget = async (
  targetId: number,
  options?: { enabledOnly?: boolean },
): Promise<BehaviorRow[]> => {
  const where: Record<string, unknown> = { targetId };
  if (options?.enabledOnly) where.enabled = true;
  const rows = await Behavior.findAll({
    where,
    order: [
      ["sortOrder", "ASC"],
      ["id", "ASC"],
    ],
  });
  return rows.map(rowOf);
};

export const findBehaviorsByTargets = async (
  targetIds: number[],
  options?: { enabledOnly?: boolean },
): Promise<BehaviorRow[]> => {
  if (targetIds.length === 0) return [];
  const where: Record<string, unknown> = { targetId: targetIds };
  if (options?.enabledOnly) where.enabled = true;
  const rows = await Behavior.findAll({
    where,
    order: [
      ["sortOrder", "ASC"],
      ["id", "ASC"],
    ],
  });
  return rows.map(rowOf);
};

export const findBehaviorById = async (
  id: number,
): Promise<BehaviorRow | null> => {
  const row = await Behavior.findByPk(id);
  return row ? rowOf(row) : null;
};

export interface NewBehaviorInput {
  targetId: number;
  title: string;
  description?: string;
  triggerType: BehaviorTriggerType;
  triggerValue: string;
  forwardType: BehaviorForwardType;
  webhookUrl: string;
  /** Pass an encrypted value to enable HMAC signing; omit / null to skip. */
  webhookSecret?: string | null;
  stopOnMatch?: boolean;
  enabled?: boolean;
}

export const createBehavior = async (
  input: NewBehaviorInput,
): Promise<BehaviorRow> => {
  // New behaviors land at the bottom of the target's list; UI can
  // reorder afterwards.
  const maxRow = await Behavior.findOne({
    where: { targetId: input.targetId },
    order: [["sortOrder", "DESC"]],
  });
  const nextSort =
    ((maxRow?.getDataValue("sortOrder") as number | undefined) ?? -1) + 1;
  const created = await Behavior.create({
    targetId: input.targetId,
    title: input.title,
    description: input.description ?? "",
    triggerType: input.triggerType,
    triggerValue: input.triggerValue,
    forwardType: input.forwardType,
    webhookUrl: input.webhookUrl,
    webhookSecret: input.webhookSecret ?? null,
    sortOrder: nextSort,
    stopOnMatch: input.stopOnMatch ?? false,
    enabled: input.enabled ?? true,
  });
  return rowOf(created);
};

export interface BehaviorUpdate {
  title?: string;
  description?: string;
  triggerType?: BehaviorTriggerType;
  triggerValue?: string;
  forwardType?: BehaviorForwardType;
  /** Pass an encrypted value to overwrite; omit / undefined to keep current. */
  webhookUrl?: string;
  /**
   * Pass an encrypted value to set, `null` to clear (disable signing),
   * `undefined` to keep current.
   */
  webhookSecret?: string | null;
  stopOnMatch?: boolean;
  enabled?: boolean;
  targetId?: number;
}

export const updateBehavior = async (
  id: number,
  patch: BehaviorUpdate,
): Promise<BehaviorRow | null> => {
  const updates: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) updates[key] = value;
  }
  if (Object.keys(updates).length === 0) {
    return findBehaviorById(id);
  }
  await Behavior.update(updates, { where: { id } });
  return findBehaviorById(id);
};

export const deleteBehavior = async (id: number): Promise<void> => {
  await Behavior.destroy({ where: { id } });
};

/**
 * Bulk reorder behaviors inside a single target. The UI sends the full
 * ordered id list; we reassign sortOrder = 0..N-1 inside a transaction
 * so the table never observes a half-applied permutation.
 */
export const reorderBehaviors = async (
  targetId: number,
  orderedIds: number[],
): Promise<void> => {
  await sequelize.transaction(async (t) => {
    for (let i = 0; i < orderedIds.length; i++) {
      await Behavior.update(
        { sortOrder: i },
        { where: { id: orderedIds[i], targetId }, transaction: t },
      );
    }
  });
};
