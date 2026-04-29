import { DataTypes, Op } from "sequelize";
import { sequelize } from "../../../models/db.js";

/**
 * Sequelize wrapper for the `plugins` table.
 *
 * `manifestJson` is the raw JSON string of the last accepted manifest;
 * callers that need typed access parse it. We store the raw string
 * (rather than DataTypes.JSON) to keep diffs deterministic across
 * SQLite versions and to make the on-disk representation match what
 * a plugin will POST again on re-register.
 */
export const Plugin = sequelize.define(
  "Plugin",
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    pluginKey: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },
    name: { type: DataTypes.STRING, allowNull: false },
    version: { type: DataTypes.STRING, allowNull: false },
    url: { type: DataTypes.TEXT, allowNull: false },
    manifestJson: { type: DataTypes.TEXT, allowNull: false },
    status: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: "inactive",
      validate: { isIn: [["active", "inactive"]] },
    },
    tokenHash: { type: DataTypes.STRING, allowNull: true },
    enabled: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    lastHeartbeatAt: { type: DataTypes.DATE, allowNull: true },
  },
  {
    tableName: "plugins",
    timestamps: true,
  },
);

export type PluginStatus = "active" | "inactive";

export interface PluginRow {
  id: number;
  pluginKey: string;
  name: string;
  version: string;
  url: string;
  manifestJson: string;
  status: PluginStatus;
  tokenHash: string | null;
  enabled: boolean;
  lastHeartbeatAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

function rowOf(model: InstanceType<typeof Plugin>): PluginRow {
  return {
    id: model.getDataValue("id") as number,
    pluginKey: model.getDataValue("pluginKey") as string,
    name: model.getDataValue("name") as string,
    version: model.getDataValue("version") as string,
    url: model.getDataValue("url") as string,
    manifestJson: model.getDataValue("manifestJson") as string,
    status: model.getDataValue("status") as PluginStatus,
    tokenHash: (model.getDataValue("tokenHash") as string | null) ?? null,
    enabled: !!model.getDataValue("enabled"),
    lastHeartbeatAt:
      (model.getDataValue("lastHeartbeatAt") as Date | null) ?? null,
    createdAt: model.getDataValue("createdAt") as Date,
    updatedAt: model.getDataValue("updatedAt") as Date,
  };
}

export const findPluginById = async (id: number): Promise<PluginRow | null> => {
  const row = await Plugin.findByPk(id);
  return row ? rowOf(row) : null;
};

export const findPluginByKey = async (
  pluginKey: string,
): Promise<PluginRow | null> => {
  const row = await Plugin.findOne({ where: { pluginKey } });
  return row ? rowOf(row) : null;
};

export const findPluginByTokenHash = async (
  tokenHash: string,
): Promise<PluginRow | null> => {
  const row = await Plugin.findOne({ where: { tokenHash } });
  return row ? rowOf(row) : null;
};

export const findAllPlugins = async (): Promise<PluginRow[]> => {
  const rows = await Plugin.findAll({ order: [["pluginKey", "ASC"]] });
  return rows.map(rowOf);
};

export interface UpsertPluginInput {
  pluginKey: string;
  name: string;
  version: string;
  url: string;
  manifestJson: string;
  tokenHash: string;
  /** Initial value for newly-created rows. Existing rows preserve their setting. */
  defaultEnabled?: boolean;
}

/**
 * Insert or update by `pluginKey`. Always marks the row `active` and
 * stamps `lastHeartbeatAt` because the only caller is the registration
 * endpoint, which is by definition a fresh handshake.
 *
 * The `enabled` flag is only set on first insert; re-registration
 * preserves whatever value the admin has set, so a plugin restart
 * doesn't quietly re-enable a plugin that was paused.
 */
export const upsertPluginRegistration = async (
  input: UpsertPluginInput,
  now: Date = new Date(),
): Promise<PluginRow> => {
  const existing = await Plugin.findOne({
    where: { pluginKey: input.pluginKey },
  });
  if (existing) {
    await existing.update({
      name: input.name,
      version: input.version,
      url: input.url,
      manifestJson: input.manifestJson,
      tokenHash: input.tokenHash,
      status: "active",
      lastHeartbeatAt: now,
    });
    return rowOf(existing);
  }
  const created = await Plugin.create({
    pluginKey: input.pluginKey,
    name: input.name,
    version: input.version,
    url: input.url,
    manifestJson: input.manifestJson,
    tokenHash: input.tokenHash,
    status: "active",
    enabled: input.defaultEnabled ?? true,
    lastHeartbeatAt: now,
  });
  return rowOf(created);
};

export const touchHeartbeat = async (
  id: number,
  now: Date = new Date(),
): Promise<void> => {
  await Plugin.update(
    { lastHeartbeatAt: now, status: "active" },
    { where: { id } },
  );
};

export const setPluginEnabled = async (
  id: number,
  enabled: boolean,
): Promise<PluginRow | null> => {
  const row = await Plugin.findByPk(id);
  if (!row) return null;
  await row.update({ enabled });
  return rowOf(row);
};

/**
 * Mark every plugin whose last heartbeat is older than `cutoff` as
 * inactive. Returns affected ids so the caller can also revoke their
 * tokens / log the failure.
 */
export const expireStalePlugins = async (cutoff: Date): Promise<number[]> => {
  const stale = await Plugin.findAll({
    where: {
      status: "active",
      lastHeartbeatAt: { [Op.lt]: cutoff },
    },
    attributes: ["id"],
  });
  const ids = stale.map((m) => m.getDataValue("id") as number);
  if (ids.length > 0) {
    await Plugin.update({ status: "inactive" }, { where: { id: ids } });
  }
  return ids;
};
