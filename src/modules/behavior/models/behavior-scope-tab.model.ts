import { DataTypes } from "sequelize";
import { sequelize } from "../../../db.js";

// ── Tab type enum ────────────────────────────────────────────────────────────

export type ScopeTabType =
  | "global_all"
  | "all_dms"
  | "all_bot_dms"
  | "all_guilds"
  | "specific_guild"
  | "specific_channel"
  | "specific_user"
  | "specific_group";

export const FIXED_TAB_TYPES: readonly ScopeTabType[] = [
  "global_all",
  "all_dms",
  "all_bot_dms",
  "all_guilds",
] as const;

export const FIXED_TAB_IDS = {
  global_all: 1,
  all_dms: 2,
  all_bot_dms: 3,
  all_guilds: 4,
} as const;

// ── Sequelize model ──────────────────────────────────────────────────────────

export const BehaviorScopeTab = sequelize.define(
  "BehaviorScopeTab",
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    tabType: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        isIn: [
          [
            "global_all",
            "all_dms",
            "all_bot_dms",
            "all_guilds",
            "specific_guild",
            "specific_channel",
            "specific_user",
            "specific_group",
          ],
        ],
      },
    },
    label: {
      type: DataTypes.TEXT,
      allowNull: false,
      defaultValue: "",
    },
    isFixed: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    guildId: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    channelId: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    userId: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    groupName: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    sortOrder: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
  },
  {
    tableName: "behavior_scope_tabs",
    timestamps: true,
  },
);

// ── Row interface ────────────────────────────────────────────────────────────

export interface BehaviorScopeTabRow {
  id: number;
  tabType: ScopeTabType;
  label: string;
  isFixed: boolean;
  guildId: string | null;
  channelId: string | null;
  userId: string | null;
  groupName: string | null;
  sortOrder: number;
}

export function rowOf(
  model: InstanceType<typeof BehaviorScopeTab>,
): BehaviorScopeTabRow {
  return {
    id: model.getDataValue("id") as number,
    tabType: model.getDataValue("tabType") as ScopeTabType,
    label: model.getDataValue("label") as string,
    isFixed: !!model.getDataValue("isFixed"),
    guildId: (model.getDataValue("guildId") as string | null) ?? null,
    channelId: (model.getDataValue("channelId") as string | null) ?? null,
    userId: (model.getDataValue("userId") as string | null) ?? null,
    groupName: (model.getDataValue("groupName") as string | null) ?? null,
    sortOrder: model.getDataValue("sortOrder") as number,
  };
}

// ── Derived fields ───────────────────────────────────────────────────────────

export interface DerivedBehaviorFields {
  scope: "global" | "guild";
  contexts: string;
  audienceKind: "all" | "user" | "group";
  audienceUserId: string | null;
  audienceGroupName: string | null;
  placementGuildId: string | null;
  placementChannelId: string | null;
}

export function deriveFieldsFromTab(
  tab: BehaviorScopeTabRow,
): DerivedBehaviorFields {
  switch (tab.tabType) {
    case "global_all":
      return {
        scope: "global",
        contexts: "BotDM,Guild,PrivateChannel",
        audienceKind: "all",
        audienceUserId: null,
        audienceGroupName: null,
        placementGuildId: null,
        placementChannelId: null,
      };
    case "all_dms":
      return {
        scope: "global",
        contexts: "BotDM,PrivateChannel",
        audienceKind: "all",
        audienceUserId: null,
        audienceGroupName: null,
        placementGuildId: null,
        placementChannelId: null,
      };
    case "all_bot_dms":
      return {
        scope: "global",
        contexts: "BotDM",
        audienceKind: "all",
        audienceUserId: null,
        audienceGroupName: null,
        placementGuildId: null,
        placementChannelId: null,
      };
    case "all_guilds":
      return {
        scope: "guild",
        contexts: "Guild",
        audienceKind: "all",
        audienceUserId: null,
        audienceGroupName: null,
        placementGuildId: null,
        placementChannelId: null,
      };
    case "specific_guild":
      return {
        scope: "guild",
        contexts: "Guild",
        audienceKind: "all",
        audienceUserId: null,
        audienceGroupName: null,
        placementGuildId: tab.guildId,
        placementChannelId: null,
      };
    case "specific_channel":
      return {
        scope: "guild",
        contexts: "Guild",
        audienceKind: "all",
        audienceUserId: null,
        audienceGroupName: null,
        placementGuildId: tab.guildId,
        placementChannelId: tab.channelId,
      };
    case "specific_user":
      return {
        scope: "global",
        contexts: "BotDM,PrivateChannel",
        audienceKind: "user",
        audienceUserId: tab.userId,
        audienceGroupName: null,
        placementGuildId: null,
        placementChannelId: null,
      };
    case "specific_group":
      return {
        scope: "global",
        contexts: "BotDM,PrivateChannel",
        audienceKind: "group",
        audienceGroupName: tab.groupName,
        audienceUserId: null,
        placementGuildId: null,
        placementChannelId: null,
      };
  }
}

// ── Scope key ───────────────────────────────────────────────────────────────
//
// Stable, human-readable identifier derived from the tab's content rather
// than its auto-increment id. Used as the segment in capability tokens
// (`behavior:<scopeKey>.manage`) so grants survive database rebuilds.

export function scopeKeyOf(tab: BehaviorScopeTabRow): string {
  switch (tab.tabType) {
    case "global_all":
      return "global_all";
    case "all_dms":
      return "all_dms";
    case "all_bot_dms":
      return "all_bot_dms";
    case "all_guilds":
      return "all_guilds";
    case "specific_guild":
      return `guild:${tab.guildId}`;
    case "specific_channel":
      return `channel:${tab.guildId}:${tab.channelId}`;
    case "specific_user":
      return `user:${tab.userId}`;
    case "specific_group":
      return `group:${tab.groupName}`;
  }
}

// ── Query helpers ────────────────────────────────────────────────────────────

export async function findScopeTabById(
  id: number,
): Promise<BehaviorScopeTabRow | null> {
  const row = await BehaviorScopeTab.findByPk(id);
  return row ? rowOf(row) : null;
}

export async function findAllScopeTabs(): Promise<BehaviorScopeTabRow[]> {
  const rows = await BehaviorScopeTab.findAll({
    order: [
      ["isFixed", "DESC"],
      ["sortOrder", "ASC"],
      ["id", "ASC"],
    ],
  });
  return rows.map(rowOf);
}
