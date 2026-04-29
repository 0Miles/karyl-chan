import { DataTypes } from "sequelize";
import { sequelize } from "../../../db.js";

/**
 * plugin_feature_defaults — operator-controlled default for a plugin
 * feature, overriding the manifest's static `enabled_by_default`.
 *
 * Lookup precedence at admin-page render time:
 *   1. plugin_guild_features row for (pluginId, guildId, featureKey) — if exists, that's the truth
 *   2. plugin_feature_defaults row for (pluginId, featureKey) — operator override
 *   3. manifest.guild_features[].enabled_by_default — author-declared default
 *   4. false — final fallback
 */
export const PluginFeatureDefault = sequelize.define(
  "PluginFeatureDefault",
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    pluginId: { type: DataTypes.INTEGER, allowNull: false },
    featureKey: { type: DataTypes.STRING, allowNull: false },
    enabled: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
  },
  {
    tableName: "plugin_feature_defaults",
    timestamps: true,
  },
);

export interface PluginFeatureDefaultRow {
  pluginId: number;
  featureKey: string;
  enabled: boolean;
  updatedAt: Date;
}

function rowOf(
  m: InstanceType<typeof PluginFeatureDefault>,
): PluginFeatureDefaultRow {
  return {
    pluginId: m.getDataValue("pluginId") as number,
    featureKey: m.getDataValue("featureKey") as string,
    enabled: !!m.getDataValue("enabled"),
    updatedAt: m.getDataValue("updatedAt") as Date,
  };
}

export const findFeatureDefault = async (
  pluginId: number,
  featureKey: string,
): Promise<PluginFeatureDefaultRow | null> => {
  const row = await PluginFeatureDefault.findOne({
    where: { pluginId, featureKey },
  });
  return row ? rowOf(row) : null;
};

export const findFeatureDefaultsByPlugin = async (
  pluginId: number,
): Promise<PluginFeatureDefaultRow[]> => {
  const rows = await PluginFeatureDefault.findAll({ where: { pluginId } });
  return rows.map(rowOf);
};

export const findAllFeatureDefaults = async (): Promise<
  PluginFeatureDefaultRow[]
> => {
  const rows = await PluginFeatureDefault.findAll();
  return rows.map(rowOf);
};

export const upsertFeatureDefault = async (
  pluginId: number,
  featureKey: string,
  enabled: boolean,
): Promise<PluginFeatureDefaultRow> => {
  const existing = await PluginFeatureDefault.findOne({
    where: { pluginId, featureKey },
  });
  if (existing) {
    await existing.update({ enabled });
    return rowOf(existing);
  }
  const created = await PluginFeatureDefault.create({
    pluginId,
    featureKey,
    enabled,
  });
  return rowOf(created);
};
