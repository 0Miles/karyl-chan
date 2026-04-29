import { DataTypes } from "sequelize";
import { sequelize } from "./db.js";
import { BehaviorTarget } from "./behavior-target.model.js";

export type BehaviorTriggerType =
  | "startswith"
  | "endswith"
  | "regex"
  | "slash_command";
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
    // Plugin-mode discriminator and references. Added in migration
    // 20260429010000-behavior-plugin-type. Existing rows backfill to
    // type='webhook' and the dispatcher keeps its old direct-POST path.
    // Type='plugin' rows resolve the live plugin URL via plugins.url
    // and ignore webhookUrl (which holds a placeholder for NOT NULL).
    type: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: "webhook",
      validate: { isIn: [["webhook", "plugin", "system"]] },
    },
    pluginId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    pluginBehaviorKey: {
      type: DataTypes.STRING,
      allowNull: true,
    },
  },
  {
    tableName: "behaviors",
    timestamps: true,
  },
);

export type BehaviorType = "webhook" | "plugin" | "system";

/**
 * Stable subkey used to identify which built-in system behavior a
 * type='system' row implements. Stored in pluginBehaviorKey so we
 * don't add a fresh column. Only one value is supported today —
 * the admin-login DM/slash flow — but the discriminator leaves room
 * for future system flows (e.g. /manual, /break) to migrate in.
 */
export const SYSTEM_BEHAVIOR_KEY_LOGIN = "admin-login";

export interface BehaviorRow {
  id: number;
  targetId: number;
  title: string;
  description: string;
  triggerType: BehaviorTriggerType;
  triggerValue: string;
  forwardType: BehaviorForwardType;
  /**
   * For type='webhook': plaintext URL after decrypt; the actual
   * destination POST'd to.
   * For type='plugin':  placeholder string ("plugin://<key>/<behaviorKey>"),
   * not used at dispatch time — the live plugin URL is read from the
   * plugins table.
   */
  webhookUrl: string;
  /**
   * For type='webhook': optional HMAC secret (encrypted at rest);
   * decrypted before signing.
   * For type='plugin':  always null — plugin dispatch uses the
   * plugin-level shared secret, not a per-behavior secret.
   */
  webhookSecret: string | null;
  sortOrder: number;
  stopOnMatch: boolean;
  enabled: boolean;
  type: BehaviorType;
  /** Set when type='plugin'; references plugins.id. Null for webhook rows. */
  pluginId: number | null;
  /**
   * The dm_behaviors[].key from the plugin's manifest, identifying
   * which DM-flavor of the plugin this behavior routes to. Null for
   * webhook rows.
   */
  pluginBehaviorKey: string | null;
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
    type: ((model.getDataValue("type") as BehaviorType | null) ??
      "webhook") as BehaviorType,
    pluginId: (model.getDataValue("pluginId") as number | null) ?? null,
    pluginBehaviorKey:
      (model.getDataValue("pluginBehaviorKey") as string | null) ?? null,
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
  /** Defaults to 'webhook' to keep legacy callers working unchanged. */
  type?: BehaviorType;
  /** Required when type='plugin'. */
  pluginId?: number | null;
  /** Required when type='plugin'. */
  pluginBehaviorKey?: string | null;
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
    type: input.type ?? "webhook",
    pluginId: input.pluginId ?? null,
    pluginBehaviorKey: input.pluginBehaviorKey ?? null,
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
  /**
   * Plugin-mode discriminator and refs. Generally set ONLY at create
   * time; updating type/pluginId on an existing row is rare (it would
   * change the dispatch path entirely) but the schema permits it.
   */
  type?: BehaviorType;
  pluginId?: number | null;
  pluginBehaviorKey?: string | null;
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

/**
 * Look up a singleton system behavior by its `pluginBehaviorKey`
 * subkey. Returns null if the row hasn't been seeded yet.
 */
export const findSystemBehaviorByKey = async (
  key: string,
): Promise<BehaviorRow | null> => {
  const row = await Behavior.findOne({
    where: { type: "system", pluginBehaviorKey: key },
  });
  return row ? rowOf(row) : null;
};

/**
 * Idempotent seed of the admin-login system behavior. Called from
 * main.ts at startup, after migrations and the all_dms target seed.
 *
 * The row is treated as a permanent system fixture by behavior-routes
 * (DELETE refused, most fields locked from PATCH). Defaults:
 *   - target = ALL_DMS_TARGET_ID (1)
 *   - type = 'system', pluginBehaviorKey = SYSTEM_BEHAVIOR_KEY_LOGIN
 *   - triggerType = 'slash_command', triggerValue = 'login'
 *     (admin can switch to startswith / regex etc. later if they
 *     want a chat-text alternative; the dispatcher still routes any
 *     match to the admin-login service)
 *   - stopOnMatch = true (system rows always halt evaluation)
 *   - sortOrder = -1000 so the row sorts above any user-created row
 *   - webhookUrl = placeholder ("system://admin-login") to satisfy
 *     the NOT NULL column; never read at dispatch time
 */
export const ensureSystemLoginBehavior = async (
  allDmsTargetId: number,
): Promise<BehaviorRow> => {
  const existing = await findSystemBehaviorByKey(SYSTEM_BEHAVIOR_KEY_LOGIN);
  if (existing) return existing;
  const created = await Behavior.create({
    targetId: allDmsTargetId,
    title: "發送登入連結",
    description: "私訊 bot `/login`(或符合觸發條件)時,發送一次性 admin 登入連結給授權使用者。系統行為,不可刪除或更換目標對象。",
    triggerType: "slash_command",
    triggerValue: "login",
    forwardType: "one_time",
    webhookUrl: "system://admin-login",
    webhookSecret: null,
    sortOrder: -1000,
    stopOnMatch: true,
    enabled: true,
    type: "system",
    pluginId: null,
    pluginBehaviorKey: SYSTEM_BEHAVIOR_KEY_LOGIN,
  });
  return rowOf(created);
};
