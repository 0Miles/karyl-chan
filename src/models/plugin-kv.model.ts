import { DataTypes, fn, col, Op, Transaction } from "sequelize";
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
 * Atomic increment-or-create. Used by plugins that need a monotonic
 * counter (accounting-plugin's nextId, etc.) without the read-modify-
 * write race that the kv_get + kv_set sequence has when two RPCs
 * land simultaneously.
 *
 * Implementation runs as a single transaction:
 *   - If the row exists and parses as a finite number, set it to
 *     value + delta.
 *   - If the row doesn't exist, seed at delta.
 *   - If the row exists but isn't a number, throw — a caller using
 *     kv_increment on a non-numeric key is a bug.
 *
 * Returns the new numeric value after the increment.
 */
export const incrementKv = async (
  pluginId: number,
  guildId: string,
  key: string,
  delta: number,
): Promise<{ row: PluginKvRow; value: number }> => {
  // SQLite needs IMMEDIATE so the transaction acquires its write lock
  // up front; the default DEFERRED only takes the lock on the first
  // write, by which time concurrent transactions race and one of them
  // bombs with SQLITE_BUSY despite our busy_timeout. IMMEDIATE plus
  // busy_timeout = serialised increments, no lost updates.
  return sequelize.transaction(
    { type: Transaction.TYPES.IMMEDIATE },
    async (tx) => {
    const existing = await PluginKv.findOne({
      where: { pluginId, guildId, key },
      transaction: tx,
    });
    let next: number;
    if (existing) {
      const cur = existing.getDataValue("value") as string;
      const parsed = Number.parseFloat(cur);
      if (!Number.isFinite(parsed)) {
        throw new Error(
          `kv_increment: existing value at key '${key}' is not a finite number`,
        );
      }
      next = parsed + delta;
      const valueStr = String(next);
      await existing.update(
        { value: valueStr, bytes: Buffer.byteLength(valueStr, "utf8") },
        { transaction: tx },
      );
      return { row: rowOf(existing), value: next };
    }
    next = delta;
    const valueStr = String(next);
    const created = await PluginKv.create(
      {
        pluginId,
        guildId,
        key,
        value: valueStr,
        bytes: Buffer.byteLength(valueStr, "utf8"),
      },
      { transaction: tx },
    );
    return { row: rowOf(created), value: next };
    },
  );
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
