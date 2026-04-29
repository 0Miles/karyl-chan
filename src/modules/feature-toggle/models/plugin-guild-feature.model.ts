import { DataTypes } from "sequelize";
import { sequelize } from "../../../db.js";

export const PluginGuildFeature = sequelize.define(
  "PluginGuildFeature",
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    pluginId: { type: DataTypes.INTEGER, allowNull: false },
    guildId: { type: DataTypes.STRING, allowNull: false },
    featureKey: { type: DataTypes.STRING, allowNull: false },
    enabled: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    configJson: { type: DataTypes.TEXT, allowNull: false, defaultValue: "{}" },
    metricsJson: {
      type: DataTypes.TEXT,
      allowNull: false,
      defaultValue: "{}",
    },
  },
  {
    tableName: "plugin_guild_features",
    timestamps: true,
  },
);

export interface PluginGuildFeatureRow {
  id: number;
  pluginId: number;
  guildId: string;
  featureKey: string;
  enabled: boolean;
  configJson: string;
  metricsJson: string;
  updatedAt: Date;
}

function rowOf(
  m: InstanceType<typeof PluginGuildFeature>,
): PluginGuildFeatureRow {
  return {
    id: m.getDataValue("id") as number,
    pluginId: m.getDataValue("pluginId") as number,
    guildId: m.getDataValue("guildId") as string,
    featureKey: m.getDataValue("featureKey") as string,
    enabled: !!m.getDataValue("enabled"),
    configJson: m.getDataValue("configJson") as string,
    metricsJson: m.getDataValue("metricsJson") as string,
    updatedAt: m.getDataValue("updatedAt") as Date,
  };
}

export const findFeatureRow = async (
  pluginId: number,
  guildId: string,
  featureKey: string,
): Promise<PluginGuildFeatureRow | null> => {
  const row = await PluginGuildFeature.findOne({
    where: { pluginId, guildId, featureKey },
  });
  return row ? rowOf(row) : null;
};

export const findFeatureRowsByGuild = async (
  guildId: string,
): Promise<PluginGuildFeatureRow[]> => {
  const rows = await PluginGuildFeature.findAll({
    where: { guildId },
  });
  return rows.map(rowOf);
};

export const findFeatureRowsByPlugin = async (
  pluginId: number,
): Promise<PluginGuildFeatureRow[]> => {
  const rows = await PluginGuildFeature.findAll({ where: { pluginId } });
  return rows.map(rowOf);
};

export interface UpsertFeatureInput {
  pluginId: number;
  guildId: string;
  featureKey: string;
  enabled?: boolean;
  configJson?: string;
}

export const upsertFeatureRow = async (
  input: UpsertFeatureInput,
): Promise<PluginGuildFeatureRow> => {
  const existing = await PluginGuildFeature.findOne({
    where: {
      pluginId: input.pluginId,
      guildId: input.guildId,
      featureKey: input.featureKey,
    },
  });
  if (existing) {
    const patch: Record<string, unknown> = {};
    if (input.enabled !== undefined) patch.enabled = input.enabled;
    if (input.configJson !== undefined) patch.configJson = input.configJson;
    if (Object.keys(patch).length > 0) await existing.update(patch);
    return rowOf(existing);
  }
  const created = await PluginGuildFeature.create({
    pluginId: input.pluginId,
    guildId: input.guildId,
    featureKey: input.featureKey,
    enabled: input.enabled ?? false,
    configJson: input.configJson ?? "{}",
  });
  return rowOf(created);
};

export const updateMetricsJson = async (
  pluginId: number,
  guildId: string,
  featureKey: string,
  metricsJson: string,
): Promise<PluginGuildFeatureRow | null> => {
  const row = await PluginGuildFeature.findOne({
    where: { pluginId, guildId, featureKey },
  });
  if (!row) return null;
  await row.update({ metricsJson });
  return rowOf(row);
};
