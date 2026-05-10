import { DataTypes, Op } from "sequelize";
import { sequelize } from "../../../db.js";

/**
 * plugin_capabilities 表
 *
 * 每個 plugin 在 manifest `capabilities[]` 宣告的 RBAC 權限詞條。
 * bot 在 register 時 reconcile：宣告的 upsert、移除的 delete（並從
 * admin_role_capabilities 一併清除對應的 `plugin:<key>:<capKey>` token）。
 * plugin 刪除時整列由 FK ON DELETE CASCADE 清掉（token 由 delete handler
 * 另行清理）。
 *
 * 複合 PK (pluginId, capKey) — 同 plugin 內 capKey 唯一。
 *
 * 對外 token 形式：`plugin:<pluginKey>:<capKey>`（pluginKey 來自 plugins.pluginKey，
 * 非 id，所以身分組授權在 DB rebuild 後仍有效）。
 */
export const PluginCapability = sequelize.define(
  "PluginCapability",
  {
    pluginId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true,
    },
    capKey: {
      type: DataTypes.TEXT,
      allowNull: false,
      primaryKey: true,
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
  },
  {
    tableName: "plugin_capabilities",
    timestamps: true,
  },
);

export interface PluginCapabilityRow {
  pluginId: number;
  capKey: string;
  description: string;
}

function rowOf(model: InstanceType<typeof PluginCapability>): PluginCapabilityRow {
  return {
    pluginId: model.getDataValue("pluginId") as number,
    capKey: model.getDataValue("capKey") as string,
    description: model.getDataValue("description") as string,
  };
}

/** All capability rows declared by one plugin. */
export async function findCapabilitiesByPlugin(
  pluginId: number,
): Promise<PluginCapabilityRow[]> {
  const rows = await PluginCapability.findAll({
    where: { pluginId },
    order: [["capKey", "ASC"]],
  });
  return rows.map(rowOf);
}

/** All capability rows across every plugin (catalog use). */
export async function findAllCapabilities(): Promise<PluginCapabilityRow[]> {
  const rows = await PluginCapability.findAll({
    order: [
      ["pluginId", "ASC"],
      ["capKey", "ASC"],
    ],
  });
  return rows.map(rowOf);
}

/** Insert or update one capability row (atomic via findOrCreate). */
export async function upsertPluginCapability(
  pluginId: number,
  capKey: string,
  description: string,
): Promise<void> {
  const [row, created] = await PluginCapability.findOrCreate({
    where: { pluginId, capKey },
    defaults: { pluginId, capKey, description },
  });
  if (!created && (row.getDataValue("description") as string) !== description) {
    await row.update({ description });
  }
}

/**
 * Delete every capability row for this plugin whose capKey is NOT in
 * `keepKeys`. Returns the removed capKeys (so the caller can purge the
 * matching role-capability tokens).
 */
export async function deleteStaleCapabilities(
  pluginId: number,
  keepKeys: string[],
): Promise<string[]> {
  const where: Record<string, unknown> = { pluginId };
  if (keepKeys.length > 0) where.capKey = { [Op.notIn]: keepKeys };
  const stale = await PluginCapability.findAll({
    where,
    attributes: ["capKey"],
  });
  const removed = stale.map((r) => r.getDataValue("capKey") as string);
  if (removed.length > 0) {
    await PluginCapability.destroy({ where });
  }
  return removed;
}

/** Drop all capability rows for a plugin (used on plugin delete, pre-cascade). */
export async function deleteAllCapabilities(pluginId: number): Promise<string[]> {
  const rows = await PluginCapability.findAll({
    where: { pluginId },
    attributes: ["capKey"],
  });
  const keys = rows.map((r) => r.getDataValue("capKey") as string);
  if (keys.length > 0) await PluginCapability.destroy({ where: { pluginId } });
  return keys;
}
