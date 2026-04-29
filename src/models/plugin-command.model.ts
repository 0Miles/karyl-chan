import { DataTypes, Op } from "sequelize";
import { sequelize } from "./db.js";

export const PluginCommand = sequelize.define(
  "PluginCommand",
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    pluginId: { type: DataTypes.INTEGER, allowNull: false },
    /** NULL for global-scoped commands. */
    guildId: { type: DataTypes.STRING, allowNull: true },
    name: { type: DataTypes.STRING, allowNull: false },
    discordCommandId: { type: DataTypes.STRING, allowNull: true },
    /**
     * NULL = top-level `manifest.commands[]` row (truly global).
     * non-NULL = declared under `manifest.guild_features[<key>].commands[]`,
     * gated by the per-guild feature toggle. Reconcile uses this to
     * decide which rows correspond to which feature when a toggle flips.
     */
    featureKey: { type: DataTypes.STRING, allowNull: true },
    manifestJson: { type: DataTypes.TEXT, allowNull: false },
  },
  {
    tableName: "plugin_commands",
    timestamps: true,
  },
);

export interface PluginCommandRow {
  id: number;
  pluginId: number;
  guildId: string | null;
  name: string;
  discordCommandId: string | null;
  featureKey: string | null;
  manifestJson: string;
}

function rowOf(model: InstanceType<typeof PluginCommand>): PluginCommandRow {
  return {
    id: model.getDataValue("id") as number,
    pluginId: model.getDataValue("pluginId") as number,
    guildId: (model.getDataValue("guildId") as string | null) ?? null,
    name: model.getDataValue("name") as string,
    discordCommandId:
      (model.getDataValue("discordCommandId") as string | null) ?? null,
    featureKey: (model.getDataValue("featureKey") as string | null) ?? null,
    manifestJson: model.getDataValue("manifestJson") as string,
  };
}

export const findPluginCommandsByPlugin = async (
  pluginId: number,
): Promise<PluginCommandRow[]> => {
  const rows = await PluginCommand.findAll({ where: { pluginId } });
  return rows.map(rowOf);
};

/**
 * Reverse lookup used by the interaction dispatcher. Returns the
 * plugin command for the given (name, guildId) — tries guild-scoped
 * first, falls back to global. Discord delivers the raw guildId on
 * the interaction; commands registered globally are also visible
 * inside guilds, so we have to check both.
 */
export const findPluginCommandByName = async (
  name: string,
  guildId: string | null,
): Promise<PluginCommandRow | null> => {
  if (guildId) {
    const guildScoped = await PluginCommand.findOne({
      where: { name, guildId },
    });
    if (guildScoped) return rowOf(guildScoped);
  }
  const global = await PluginCommand.findOne({
    where: { name, guildId: { [Op.is]: null } },
  });
  return global ? rowOf(global) : null;
};

/**
 * Hard collision check used by the registry to refuse a new plugin
 * registration if it would step on an existing plugin's command.
 * Looks across ALL plugins for the same (name, guildId) — including
 * guild-vs-global ambiguity (a global command and a guild command
 * with the same name in the same guild collide because Discord shows
 * them both to the user).
 */
export const findCommandCollisions = async (
  excludePluginId: number,
  candidate: { name: string; guildId: string | null },
): Promise<PluginCommandRow[]> => {
  const where: Record<string, unknown> = {
    name: candidate.name,
    pluginId: { [Op.ne]: excludePluginId },
  };
  // For a global candidate (guildId=null) collide with ANY existing
  // row of the same name (per-guild or global). For a guild-scoped
  // candidate, collide with the same guild OR with a global row.
  const rows = await PluginCommand.findAll({ where });
  return rows
    .filter((m) => {
      const g = (m.getDataValue("guildId") as string | null) ?? null;
      if (candidate.guildId === null) return true;
      return g === null || g === candidate.guildId;
    })
    .map(rowOf);
};

export interface UpsertPluginCommandInput {
  pluginId: number;
  guildId: string | null;
  name: string;
  discordCommandId: string | null;
  featureKey?: string | null;
  manifestJson: string;
}

export const upsertPluginCommand = async (
  input: UpsertPluginCommandInput,
): Promise<PluginCommandRow> => {
  const existing = await PluginCommand.findOne({
    where: {
      pluginId: input.pluginId,
      guildId: input.guildId ?? null,
      name: input.name,
    },
  });
  if (existing) {
    await existing.update({
      discordCommandId: input.discordCommandId,
      featureKey: input.featureKey ?? null,
      manifestJson: input.manifestJson,
    });
    return rowOf(existing);
  }
  const created = await PluginCommand.create({
    pluginId: input.pluginId,
    guildId: input.guildId,
    name: input.name,
    discordCommandId: input.discordCommandId,
    featureKey: input.featureKey ?? null,
    manifestJson: input.manifestJson,
  });
  return rowOf(created);
};

export const findPluginCommandsByFeature = async (
  pluginId: number,
  featureKey: string,
): Promise<PluginCommandRow[]> => {
  const rows = await PluginCommand.findAll({
    where: { pluginId, featureKey },
  });
  return rows.map(rowOf);
};

export const deletePluginCommandRow = async (
  rowId: number,
): Promise<void> => {
  await PluginCommand.destroy({ where: { id: rowId } });
};

export const deletePluginCommandsByPlugin = async (
  pluginId: number,
): Promise<PluginCommandRow[]> => {
  const rows = await findPluginCommandsByPlugin(pluginId);
  await PluginCommand.destroy({ where: { pluginId } });
  return rows;
};
