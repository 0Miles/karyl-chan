import { DataTypes } from "sequelize";
import { sequelize } from "../../../db.js";

/**
 * Persistent log of bot lifecycle and runtime events. Replaces the
 * previous in-memory SystemEventLog which was lost on every restart.
 *
 * Events are written fire-and-forget via botEventLog (see
 * src/modules/bot-events/bot-event-log.ts) — a DB failure never propagates to the
 * bot caller. Indexed for the three foreseeable admin queries: newest
 * first, filter-by-level, filter-by-category.
 */
export const BotEvent = sequelize.define(
  "BotEvent",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    level: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    category: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    message: {
      type: DataTypes.STRING(500),
      allowNull: false,
    },
    context: {
      type: DataTypes.JSON,
      allowNull: true,
    },
  },
  {
    tableName: "bot_events",
    timestamps: true,
    indexes: [
      { name: "bot_events_created_at_idx", fields: ["createdAt"] },
      {
        name: "bot_events_level_created_at_idx",
        fields: ["level", "createdAt"],
      },
      {
        name: "bot_events_category_created_at_idx",
        fields: ["category", "createdAt"],
      },
    ],
  },
);
