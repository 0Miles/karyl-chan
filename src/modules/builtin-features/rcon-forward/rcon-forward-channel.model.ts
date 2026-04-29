import { DataTypes } from "sequelize";
import { sequelize } from "../../../db.js";

export const RconForwardChannel = sequelize.define(
  "RconForwardChannel",
  {
    channelId: {
      type: DataTypes.STRING,
      primaryKey: true,
    },
    guildId: {
      type: DataTypes.STRING,
      primaryKey: true,
    },
    commandPrefix: DataTypes.STRING,
    triggerPrefix: DataTypes.STRING,
    host: DataTypes.STRING,
    port: DataTypes.INTEGER,
    password: DataTypes.STRING,
  },
  {
    // Default `timestamps: true` is intentional — earlier deployments
    // created the table with NOT NULL createdAt/updatedAt columns.
    tableName: "RconForwardChannels",
  },
);
