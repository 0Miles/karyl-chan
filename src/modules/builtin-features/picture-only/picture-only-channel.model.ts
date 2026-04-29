import { DataTypes } from "sequelize";
import { sequelize } from "../../../db.js";

export const PictureOnlyChannel = sequelize.define(
  "PictureOnlyChannel",
  {
    channelId: {
      type: DataTypes.STRING,
      primaryKey: true,
    },
    guildId: {
      type: DataTypes.STRING,
      primaryKey: true,
    },
  },
  {
    // Default `timestamps: true` is intentional — earlier deployments
    // created the table with NOT NULL createdAt/updatedAt columns; a
    // `timestamps: false` here would break INSERTs against legacy DBs.
    tableName: "PictureOnlyChannels",
  },
);
