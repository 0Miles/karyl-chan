import { DataTypes, Op } from "sequelize";
import { sequelize } from "../../../models/db.js";

/**
 * In-process feature on/off state. See migration
 * 20260429070000-bot-feature-state.ts for precedence.
 *
 * `guildId == null` rows are the operator default; concrete-guild rows
 * override the default. Reads always go through resolveBuiltinFeatureEnabled
 * which encodes the precedence.
 */
export const BotFeatureState = sequelize.define(
  "BotFeatureState",
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    guildId: { type: DataTypes.STRING, allowNull: true },
    featureKey: { type: DataTypes.STRING, allowNull: false },
    enabled: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
  },
  {
    tableName: "bot_feature_state",
    timestamps: true,
  },
);

export interface BotFeatureStateRow {
  id: number;
  guildId: string | null;
  featureKey: string;
  enabled: boolean;
  updatedAt: Date;
}

function rowOf(m: InstanceType<typeof BotFeatureState>): BotFeatureStateRow {
  return {
    id: m.getDataValue("id") as number,
    guildId: (m.getDataValue("guildId") as string | null) ?? null,
    featureKey: m.getDataValue("featureKey") as string,
    enabled: !!m.getDataValue("enabled"),
    updatedAt: m.getDataValue("updatedAt") as Date,
  };
}

/**
 * The frozen list of in-process built-in features, mirroring the
 * frontend's guild-feature registry. Adding a new built-in feature
 * means appending here AND registering its UI in
 * `frontend/src/modules/guild-features/registry.ts`.
 */
export const BUILTIN_FEATURE_KEYS = [
  "todo",
  "picture-only",
  "role-emoji",
  "rcon",
] as const;
export type BuiltinFeatureKey = (typeof BUILTIN_FEATURE_KEYS)[number];

export function isKnownBuiltinFeature(key: string): key is BuiltinFeatureKey {
  return (BUILTIN_FEATURE_KEYS as readonly string[]).includes(key);
}

export const findStateRow = async (
  guildId: string | null,
  featureKey: string,
): Promise<BotFeatureStateRow | null> => {
  const where: Record<string, unknown> = { featureKey };
  // sequelize.where for null requires `Op.is`; { guildId: null } in
  // recent versions also works but Op.is is explicit and reliable.
  where.guildId = guildId === null ? { [Op.is]: null } : guildId;
  const row = await BotFeatureState.findOne({ where });
  return row ? rowOf(row) : null;
};

export const findAllStateRows = async (): Promise<BotFeatureStateRow[]> => {
  const rows = await BotFeatureState.findAll();
  return rows.map(rowOf);
};

export const findStateRowsByGuild = async (
  guildId: string,
): Promise<BotFeatureStateRow[]> => {
  const rows = await BotFeatureState.findAll({ where: { guildId } });
  return rows.map(rowOf);
};

export const upsertStateRow = async (
  guildId: string | null,
  featureKey: string,
  enabled: boolean,
): Promise<BotFeatureStateRow> => {
  const existing = await findStateRow(guildId, featureKey);
  if (existing) {
    const m = await BotFeatureState.findByPk(existing.id);
    if (m) {
      await m.update({ enabled });
      return rowOf(m);
    }
  }
  const created = await BotFeatureState.create({
    guildId,
    featureKey,
    enabled,
  });
  return rowOf(created);
};

/**
 * Resolve effective enabled state for a feature in a specific guild.
 * Precedence:
 *   1. (guildId, featureKey) row → use its `enabled`
 *   2. (NULL, featureKey) row    → operator default
 *   3. true                       → built-ins default ON unless told otherwise
 *
 * Falls back to true on DB error so a transient outage doesn't black
 * out every feature; the next call after recovery sees the real state.
 */
export const resolveBuiltinFeatureEnabled = async (
  featureKey: string,
  guildId: string | null,
): Promise<boolean> => {
  try {
    if (guildId !== null) {
      const perGuild = await findStateRow(guildId, featureKey);
      if (perGuild) return perGuild.enabled;
    }
    const def = await findStateRow(null, featureKey);
    if (def) return def.enabled;
    return true;
  } catch {
    return true;
  }
};
