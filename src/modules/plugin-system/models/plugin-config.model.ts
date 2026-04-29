import { DataTypes } from "sequelize";
import { sequelize } from "../../../db.js";

/**
 * Plugin-level admin-editable config + plugin-self KV. See migration
 * 20260429080000-plugin-config.ts for the source-tier split.
 *
 * Reads (model layer) return values as stored — encrypted secrets
 * stay encrypted; the route + RPC layers decide whether to decrypt
 * (RPC: yes, plugin needs the real value) or mask (admin UI: yes,
 * never echo a plaintext secret back over an admin response).
 */
export type PluginConfigSource = "admin" | "plugin";

export const PluginConfig = sequelize.define(
  "PluginConfig",
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    pluginId: { type: DataTypes.INTEGER, allowNull: false },
    key: { type: DataTypes.STRING, allowNull: false },
    value: { type: DataTypes.TEXT, allowNull: false },
    source: { type: DataTypes.STRING, allowNull: false, defaultValue: "admin" },
  },
  { tableName: "plugin_configs", timestamps: true },
);

export interface PluginConfigRow {
  id: number;
  pluginId: number;
  key: string;
  value: string;
  source: PluginConfigSource;
  updatedAt: Date;
}

function rowOf(m: InstanceType<typeof PluginConfig>): PluginConfigRow {
  return {
    id: m.getDataValue("id") as number,
    pluginId: m.getDataValue("pluginId") as number,
    key: m.getDataValue("key") as string,
    value: m.getDataValue("value") as string,
    source: m.getDataValue("source") as PluginConfigSource,
    updatedAt: m.getDataValue("updatedAt") as Date,
  };
}

export const findConfigByPlugin = async (
  pluginId: number,
): Promise<PluginConfigRow[]> => {
  const rows = await PluginConfig.findAll({ where: { pluginId } });
  return rows.map(rowOf);
};

export const findConfigByPluginAndSource = async (
  pluginId: number,
  source: PluginConfigSource,
): Promise<PluginConfigRow[]> => {
  const rows = await PluginConfig.findAll({ where: { pluginId, source } });
  return rows.map(rowOf);
};

export const findConfigKey = async (
  pluginId: number,
  key: string,
): Promise<PluginConfigRow | null> => {
  const row = await PluginConfig.findOne({ where: { pluginId, key } });
  return row ? rowOf(row) : null;
};

export const upsertConfigKey = async (
  pluginId: number,
  key: string,
  value: string,
  source: PluginConfigSource,
): Promise<PluginConfigRow> => {
  const existing = await PluginConfig.findOne({ where: { pluginId, key } });
  if (existing) {
    // Refuse to let one source overwrite the other's row. The admin UI
    // never touches plugin-self rows; a plugin RPC writing through
    // config.set never lands on an admin-owned schema field. Mixing
    // would surprise both sides.
    const existingSource = existing.getDataValue(
      "source",
    ) as PluginConfigSource;
    if (existingSource !== source) {
      throw new Error(
        `plugin-config: cannot overwrite '${key}' (owner=${existingSource}, attempted=${source})`,
      );
    }
    await existing.update({ value });
    return rowOf(existing);
  }
  const created = await PluginConfig.create({ pluginId, key, value, source });
  return rowOf(created);
};

export const deleteConfigKey = async (
  pluginId: number,
  key: string,
  source: PluginConfigSource,
): Promise<boolean> => {
  // Same source-isolation rule as upsert.
  const existing = await PluginConfig.findOne({ where: { pluginId, key } });
  if (!existing) return false;
  const existingSource = existing.getDataValue("source") as PluginConfigSource;
  if (existingSource !== source) {
    throw new Error(
      `plugin-config: cannot delete '${key}' (owner=${existingSource}, attempted=${source})`,
    );
  }
  await existing.destroy();
  return true;
};
