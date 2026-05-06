import { DataTypes } from "sequelize";
import { sequelize } from "../../../db.js";

// ── v2 列舉型別 ──────────────────────────────────────────────────────────────

export type BehaviorSource = "custom" | "plugin" | "system";
export type BehaviorTriggerType = "slash_command" | "message_pattern";
export type BehaviorMessagePatternKind = "startswith" | "endswith" | "regex";
export type BehaviorForwardType = "one_time" | "continuous";
export type BehaviorScope = "global" | "guild";
export type BehaviorAudienceKind = "all" | "user" | "group";
export type BehaviorWebhookAuthMode = "token" | "hmac";
export type BehaviorSystemKey = "admin-login" | "manual" | "break";

// ── system behavior 常數（供 main.ts + dispatcher 用，M1-C 接管後移除）────────

export const SYSTEM_BEHAVIOR_KEY_LOGIN = "admin-login" as const;
export const SYSTEM_BEHAVIOR_KEY_MANUAL = "manual" as const;
export const SYSTEM_BEHAVIOR_KEY_BREAK = "break" as const;

export const SYSTEM_BEHAVIOR_KEYS = [
  SYSTEM_BEHAVIOR_KEY_LOGIN,
  SYSTEM_BEHAVIOR_KEY_MANUAL,
  SYSTEM_BEHAVIOR_KEY_BREAK,
] as const;

// ── Sequelize model 定義 ──────────────────────────────────────────────────────

/**
 * v2 behaviors 表。軌二 webhook 接口層的核心表，source ∈ {custom, plugin, system}。
 *
 * 欄位對應 A-schema §1.2 DDL（破壞性遷移版，無 legacyId）。
 * 所有 CHECK invariant（I-1~I-7）由 migration DDL 在 SQLite 層強制，
 * model 層只宣告欄位型別，不重複 validate（避免重複邏輯發散）。
 *
 * 注意：integrationTypes / contexts 為 lexicographically-sorted comma-joined string，
 * 應用層在 INSERT/UPDATE 前必須強制 sort+dedup 後才寫入。
 *
 * M1-C 接管前，dispatcher / routes 全部 stub（回 503 或 throw）。
 */
export const Behavior = sequelize.define(
  "Behavior",
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    // 基本元資料
    title: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: false,
      defaultValue: "",
    },
    enabled: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
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
    forwardType: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: "one_time",
      validate: { isIn: [["one_time", "continuous"]] },
    },
    // 三維分類
    source: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: { isIn: [["custom", "plugin", "system"]] },
    },
    triggerType: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: { isIn: [["slash_command", "message_pattern"]] },
    },
    // message_pattern 子型
    messagePatternKind: {
      type: DataTypes.STRING,
      allowNull: true,
      validate: { isIn: [[null, "startswith", "endswith", "regex"]] },
    },
    messagePatternValue: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    // slash_command 子欄位
    slashCommandName: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    slashCommandDescription: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    // 三軸
    scope: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: "global",
      validate: { isIn: [["global", "guild"]] },
    },
    integrationTypes: {
      type: DataTypes.TEXT,
      allowNull: false,
      defaultValue: "guild_install",
    },
    contexts: {
      type: DataTypes.TEXT,
      allowNull: false,
      defaultValue: "Guild",
    },
    // placement
    placementGuildId: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    placementChannelId: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    // audience
    audienceKind: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: "all",
      validate: { isIn: [["all", "user", "group"]] },
    },
    audienceUserId: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    audienceGroupName: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    // source-specific：custom
    webhookUrl: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    webhookSecret: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    webhookAuthMode: {
      type: DataTypes.STRING,
      allowNull: true,
      validate: { isIn: [[null, "token", "hmac"]] },
    },
    // source-specific：plugin
    pluginId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    pluginBehaviorKey: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    // source-specific：system
    systemKey: {
      type: DataTypes.STRING,
      allowNull: true,
      validate: { isIn: [[null, "admin-login", "manual", "break"]] },
    },
  },
  {
    tableName: "behaviors",
    timestamps: true,
  },
);

// ── Row 型別 ──────────────────────────────────────────────────────────────────

export interface BehaviorRow {
  id: number;
  title: string;
  description: string;
  enabled: boolean;
  sortOrder: number;
  stopOnMatch: boolean;
  forwardType: BehaviorForwardType;
  source: BehaviorSource;
  triggerType: BehaviorTriggerType;
  messagePatternKind: BehaviorMessagePatternKind | null;
  messagePatternValue: string | null;
  slashCommandName: string | null;
  slashCommandDescription: string | null;
  scope: BehaviorScope;
  integrationTypes: string;
  contexts: string;
  placementGuildId: string | null;
  placementChannelId: string | null;
  audienceKind: BehaviorAudienceKind;
  audienceUserId: string | null;
  audienceGroupName: string | null;
  webhookUrl: string | null;
  webhookSecret: string | null;
  webhookAuthMode: BehaviorWebhookAuthMode | null;
  pluginId: number | null;
  pluginBehaviorKey: string | null;
  systemKey: BehaviorSystemKey | null;
}

function rowOf(model: InstanceType<typeof Behavior>): BehaviorRow {
  return {
    id: model.getDataValue("id") as number,
    title: model.getDataValue("title") as string,
    description: (model.getDataValue("description") as string) ?? "",
    enabled: !!model.getDataValue("enabled"),
    sortOrder: model.getDataValue("sortOrder") as number,
    stopOnMatch: !!model.getDataValue("stopOnMatch"),
    forwardType: model.getDataValue("forwardType") as BehaviorForwardType,
    source: model.getDataValue("source") as BehaviorSource,
    triggerType: model.getDataValue("triggerType") as BehaviorTriggerType,
    messagePatternKind:
      (model.getDataValue("messagePatternKind") as BehaviorMessagePatternKind | null) ??
      null,
    messagePatternValue:
      (model.getDataValue("messagePatternValue") as string | null) ?? null,
    slashCommandName:
      (model.getDataValue("slashCommandName") as string | null) ?? null,
    slashCommandDescription:
      (model.getDataValue("slashCommandDescription") as string | null) ?? null,
    scope: model.getDataValue("scope") as BehaviorScope,
    integrationTypes: model.getDataValue("integrationTypes") as string,
    contexts: model.getDataValue("contexts") as string,
    placementGuildId:
      (model.getDataValue("placementGuildId") as string | null) ?? null,
    placementChannelId:
      (model.getDataValue("placementChannelId") as string | null) ?? null,
    audienceKind: model.getDataValue("audienceKind") as BehaviorAudienceKind,
    audienceUserId:
      (model.getDataValue("audienceUserId") as string | null) ?? null,
    audienceGroupName:
      (model.getDataValue("audienceGroupName") as string | null) ?? null,
    webhookUrl: (model.getDataValue("webhookUrl") as string | null) ?? null,
    webhookSecret:
      (model.getDataValue("webhookSecret") as string | null) ?? null,
    webhookAuthMode:
      (model.getDataValue("webhookAuthMode") as BehaviorWebhookAuthMode | null) ??
      null,
    pluginId: (model.getDataValue("pluginId") as number | null) ?? null,
    pluginBehaviorKey:
      (model.getDataValue("pluginBehaviorKey") as string | null) ?? null,
    systemKey:
      (model.getDataValue("systemKey") as BehaviorSystemKey | null) ?? null,
  };
}

// ── Query helpers ─────────────────────────────────────────────────────────────

export const findBehaviorById = async (
  id: number,
): Promise<BehaviorRow | null> => {
  const row = await Behavior.findByPk(id);
  return row ? rowOf(row) : null;
};

/**
 * 查詢所有 source='system' 的 behavior rows。
 * M1-C 接管前供 main.ts interactionCreate dispatcher 使用。
 */
export const findAllSystemBehaviors = async (): Promise<BehaviorRow[]> => {
  const rows = await Behavior.findAll({ where: { source: "system" } });
  return rows.map(rowOf);
};

// ── Deprecated v1 stubs（M1-C 接管後移除）────────────────────────────────────

/**
 * @deprecated v1 API。v2 schema 無 targetId；M1-C 接管後移除。
 * 暫回空陣列，不爆炸，讓 bot 能 boot。
 */
export const findBehaviorsByTargets = async (
  _targetIds: number[],
  _options?: { enabledOnly?: boolean },
): Promise<BehaviorRow[]> => {
  return [];
};

/**
 * @deprecated v1 API。v2 schema 無 targetId；M1-C 接管後移除。
 */
export const findBehaviorsByTarget = async (
  _targetId: number,
  _options?: { enabledOnly?: boolean },
): Promise<BehaviorRow[]> => {
  return [];
};

/**
 * @deprecated v1 API（type='system' + pluginBehaviorKey）。
 * v2 改用 systemKey 欄位；M1-C 接管後移除。
 * 暫回 null，讓舊呼叫方不爆炸。
 */
export const findSystemBehaviorByKey = async (
  _key: string,
): Promise<BehaviorRow | null> => {
  return null;
};

/**
 * @deprecated v1 seed function（需要 targetId + v1 schema）。
 * v2 schema 中 system seed 由 M1-C 接管。
 * 暫 no-op（不插入），讓 main.ts 的呼叫不爆炸。
 * TODO M1-C：改寫為 v2 seed（systemKey 欄位，無 targetId）。
 */
export const ensureSystemLoginBehavior = async (
  _allDmsTargetId: number,
): Promise<void> => {
  // M1-A1: v2 schema 破壞性遷移後，system seed 暫時 no-op。
  // M1-C 將重寫為 v2 schema 的 system seed（systemKey='admin-login'）。
};

/**
 * @deprecated v1 seed function。同上。
 * TODO M1-C：改寫。
 */
export const ensureSystemManualBehavior = async (
  _allDmsTargetId: number,
): Promise<void> => {
  // M1-A1: no-op。M1-C 接管。
};

/**
 * @deprecated v1 seed function。同上。
 * TODO M1-C：改寫。
 */
export const ensureSystemBreakBehavior = async (
  _allDmsTargetId: number,
): Promise<void> => {
  // M1-A1: no-op。M1-C 接管。
};

/**
 * @deprecated v1 API。v2 schema 無 targetId；M1-C 接管後移除。
 */
export const reorderBehaviors = async (
  _targetId: number,
  _orderedIds: number[],
): Promise<void> => {
  throw new Error(
    "M1-A1: reorderBehaviors is deprecated (v1 API). Will be replaced in M1-C.",
  );
};

/**
 * @deprecated v1 API。M1-C 接管後移除。
 */
export const createBehavior = async (
  _input: unknown,
): Promise<BehaviorRow> => {
  throw new Error(
    "M1-A1: createBehavior is deprecated (v1 API). Will be replaced in M1-C.",
  );
};

/**
 * @deprecated v1 API。M1-C 接管後移除。
 */
export const updateBehavior = async (
  _id: number,
  _patch: unknown,
): Promise<BehaviorRow | null> => {
  throw new Error(
    "M1-A1: updateBehavior is deprecated (v1 API). Will be replaced in M1-C.",
  );
};

/**
 * @deprecated v1 API。M1-C 接管後移除。
 */
export const deleteBehavior = async (_id: number): Promise<void> => {
  throw new Error(
    "M1-A1: deleteBehavior is deprecated (v1 API). Will be replaced in M1-C.",
  );
};

// ── v1 型別 alias（供仍在 import 的地方 compile 通過）─────────────────────────

/**
 * @deprecated v1 型別。使用 BehaviorTriggerType（v2）。
 */
export type BehaviorType = "webhook" | "plugin" | "system";

/**
 * @deprecated v1 input 型別（有 targetId / triggerValue 等 v1 欄位）。
 * 只供 compile 通過，不應在 M1-C 後繼續使用。
 */
export interface NewBehaviorInput {
  targetId: number;
  title: string;
  description?: string;
  triggerType: string;
  triggerValue: string;
  forwardType: BehaviorForwardType;
  webhookUrl: string;
  webhookSecret?: string | null;
  stopOnMatch?: boolean;
  enabled?: boolean;
  type?: BehaviorType;
  pluginId?: number | null;
  pluginBehaviorKey?: string | null;
}

/**
 * @deprecated v1 update 型別。
 */
export interface BehaviorUpdate {
  title?: string;
  description?: string;
  triggerType?: string;
  triggerValue?: string;
  forwardType?: BehaviorForwardType;
  webhookUrl?: string;
  webhookSecret?: string | null;
  stopOnMatch?: boolean;
  enabled?: boolean;
  targetId?: number;
  type?: BehaviorType;
  pluginId?: number | null;
  pluginBehaviorKey?: string | null;
}
