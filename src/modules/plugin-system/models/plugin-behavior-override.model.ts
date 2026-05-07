import { DataTypes, Op } from "sequelize";
import { sequelize } from "../../../db.js";

/**
 * plugin_behavior_overrides 表（OQ-11）
 *
 * Admin 對 plugin manifest behaviors[] 的 on/off override。
 * 語意：row 不存在 → 預設 enabled=true（lazy upsert）。
 *
 * 複合 PK (pluginId, behaviorKey)，Sequelize 不原生支援複合 PK；
 * 使用 primaryKey: false + UNIQUE 的 workaround 不必要——
 * 這裡直接宣告兩欄皆為 primaryKey，Sequelize 會正確對應 SQLite 建表。
 */
export const PluginBehaviorOverride = sequelize.define(
  "PluginBehaviorOverride",
  {
    pluginId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true,
    },
    behaviorKey: {
      type: DataTypes.TEXT,
      allowNull: false,
      primaryKey: true,
    },
    enabled: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
  },
  {
    tableName: "plugin_behavior_overrides",
    timestamps: true,
  },
);

// ── Row 型別 ──────────────────────────────────────────────────────────────────

export interface PluginBehaviorOverrideRow {
  pluginId: number;
  behaviorKey: string;
  enabled: boolean;
}

// ── Query Helpers ─────────────────────────────────────────────────────────────

/**
 * 查詢單一 behavior 是否 enabled。
 * 預設 true：row 不存在時回 true；row 存在且 enabled=false 才回 false。
 */
export async function isPluginBehaviorEnabled(
  pluginId: number,
  behaviorKey: string,
): Promise<boolean> {
  const row = await PluginBehaviorOverride.findOne({
    where: { pluginId, behaviorKey },
  });
  if (!row) return true;
  return !!row.getDataValue("enabled");
}

/**
 * Upsert plugin behavior override（lazy）。
 * 第一次 toggle off 時建 row（enabled=false）；
 * toggle back on 時更新 enabled=true。
 */
export async function setPluginBehaviorEnabled(
  pluginId: number,
  behaviorKey: string,
  enabled: boolean,
): Promise<void> {
  const existing = await PluginBehaviorOverride.findOne({
    where: { pluginId, behaviorKey },
  });
  if (existing) {
    await existing.update({ enabled });
  } else {
    await PluginBehaviorOverride.create({ pluginId, behaviorKey, enabled });
  }
}

/**
 * 批次取得某 plugin 所有 disabled 的 behaviorKey 集合。
 * 供 reconciler buildDesiredSet 使用：O(1) in-memory lookup 而非 N+1 query。
 * Row 不存在（預設 enabled）的 key 不在此集合內。
 */
export async function findDisabledBehaviorKeys(
  pluginId: number,
): Promise<Set<string>> {
  const rows = await PluginBehaviorOverride.findAll({
    where: {
      pluginId,
      enabled: false,
    },
    attributes: ["behaviorKey"],
  });
  return new Set(rows.map((r) => r.getDataValue("behaviorKey") as string));
}

/**
 * 批次取得多個 plugin 的所有 disabled override，回傳 Map<pluginId, Set<behaviorKey>>。
 * Reconciler buildDesiredSet 呼叫一次即可 cover 全量 plugin，避免 N+1。
 */
export async function findAllDisabledBehaviorOverrides(): Promise<
  Map<number, Set<string>>
> {
  const rows = await PluginBehaviorOverride.findAll({
    where: { enabled: false },
    attributes: ["pluginId", "behaviorKey"],
  });
  const result = new Map<number, Set<string>>();
  for (const row of rows) {
    const pid = row.getDataValue("pluginId") as number;
    const key = row.getDataValue("behaviorKey") as string;
    if (!result.has(pid)) result.set(pid, new Set());
    result.get(pid)!.add(key);
  }
  return result;
}

/**
 * 取得某 plugin 所有 behaviors 的 enabled 狀態（含 override 與預設）。
 * 用於 GET /api/plugins/by-key/:pluginKey 回傳 behaviors[].enabled。
 *
 * @param pluginId    plugin DB id
 * @param behaviorKeys manifest 宣告的所有 behavior keys
 * @returns Map<behaviorKey, enabled>
 */
export async function getBehaviorEnabledMap(
  pluginId: number,
  behaviorKeys: string[],
): Promise<Map<string, boolean>> {
  if (behaviorKeys.length === 0) return new Map();

  const rows = await PluginBehaviorOverride.findAll({
    where: {
      pluginId,
      behaviorKey: { [Op.in]: behaviorKeys },
    },
    attributes: ["behaviorKey", "enabled"],
  });

  const overrideMap = new Map<string, boolean>(
    rows.map((r) => [
      r.getDataValue("behaviorKey") as string,
      !!r.getDataValue("enabled"),
    ]),
  );

  const result = new Map<string, boolean>();
  for (const key of behaviorKeys) {
    // row 不存在 → 預設 true
    result.set(key, overrideMap.has(key) ? overrideMap.get(key)! : true);
  }
  return result;
}
