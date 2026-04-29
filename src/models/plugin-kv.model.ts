import { DataTypes, fn, col, Op } from "sequelize";
import { sequelize } from "./db.js";

/**
 * Per-plugin per-guild KV. Caller-side quota enforcement happens in
 * the route layer (storage.kv_set), which reads the plugin's manifest
 * to learn its quota and consults `sumGuildBytes` before accepting a
 * write. Centralizing all writes through `setKv` makes the quota
 * accounting trivial.
 */
export const PluginKv = sequelize.define(
  "PluginKv",
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    pluginId: { type: DataTypes.INTEGER, allowNull: false },
    guildId: { type: DataTypes.STRING, allowNull: false },
    key: { type: DataTypes.STRING, allowNull: false },
    value: { type: DataTypes.TEXT, allowNull: false },
    bytes: { type: DataTypes.INTEGER, allowNull: false },
  },
  {
    tableName: "plugin_kv",
    timestamps: true,
  },
);

export interface PluginKvRow {
  pluginId: number;
  guildId: string;
  key: string;
  value: string;
  bytes: number;
  updatedAt: Date;
}

function rowOf(model: InstanceType<typeof PluginKv>): PluginKvRow {
  return {
    pluginId: model.getDataValue("pluginId") as number,
    guildId: model.getDataValue("guildId") as string,
    key: model.getDataValue("key") as string,
    value: model.getDataValue("value") as string,
    bytes: model.getDataValue("bytes") as number,
    updatedAt: model.getDataValue("updatedAt") as Date,
  };
}

export const getKv = async (
  pluginId: number,
  guildId: string,
  key: string,
): Promise<PluginKvRow | null> => {
  const row = await PluginKv.findOne({
    where: { pluginId, guildId, key },
  });
  return row ? rowOf(row) : null;
};

export const setKv = async (
  pluginId: number,
  guildId: string,
  key: string,
  value: string,
): Promise<PluginKvRow> => {
  const bytes = Buffer.byteLength(value, "utf8");
  const existing = await PluginKv.findOne({
    where: { pluginId, guildId, key },
  });
  if (existing) {
    await existing.update({ value, bytes });
    return rowOf(existing);
  }
  const created = await PluginKv.create({
    pluginId,
    guildId,
    key,
    value,
    bytes,
  });
  return rowOf(created);
};

export const deleteKv = async (
  pluginId: number,
  guildId: string,
  key: string,
): Promise<boolean> => {
  const n = await PluginKv.destroy({ where: { pluginId, guildId, key } });
  return n > 0;
};

export const listKvKeys = async (
  pluginId: number,
  guildId: string,
  options: { prefix?: string; limit?: number; offset?: number } = {},
): Promise<{ keys: string[]; total: number }> => {
  const where: Record<string, unknown> = { pluginId, guildId };
  if (options.prefix && options.prefix.length > 0) {
    where.key = { [Op.like]: `${options.prefix.replace(/[%_]/g, "\\$&")}%` };
  }
  const total = await PluginKv.count({ where });
  const rows = await PluginKv.findAll({
    where,
    attributes: ["key"],
    order: [["key", "ASC"]],
    limit: Math.min(options.limit ?? 100, 500),
    offset: Math.max(options.offset ?? 0, 0),
  });
  return { keys: rows.map((r) => r.getDataValue("key") as string), total };
};

/**
 * Sum total bytes a plugin currently uses inside one guild. Cheap
 * because (pluginId, guildId) is indexed and `bytes` is on the row
 * — no need to read `value` to compute size.
 */
export const sumGuildBytes = async (
  pluginId: number,
  guildId: string,
): Promise<number> => {
  const result = (await PluginKv.findOne({
    where: { pluginId, guildId },
    attributes: [[fn("COALESCE", fn("SUM", col("bytes")), 0), "total"]],
    raw: true,
  })) as { total: number | string } | null;
  if (!result) return 0;
  const v = result.total;
  return typeof v === "number" ? v : Number.parseInt(v, 10);
};
