import { DataTypes } from "sequelize";
import { sequelize } from "../../../db.js";
import { AdminRole } from "./admin-role.model.js";

/**
 * Non-owner Discord users allowed to request login tokens from the bot. The
 * `role` column references AdminRole.name; actual capabilities are looked
 * up through admin_role_capabilities. The bot owner (BOT_OWNER_ID env var)
 * is always authorized implicitly and receives every capability.
 */
export const AuthorizedUser = sequelize.define(
  "AuthorizedUser",
  {
    userId: {
      type: DataTypes.STRING,
      primaryKey: true,
    },
    role: {
      type: DataTypes.STRING,
      allowNull: false,
      // FK → admin_roles(name). On SQLite the constraint is only
      // enforced when PRAGMA foreign_keys is ON (set in db.ts). If the
      // referenced role is deleted, CASCADE removes the row here too;
      // the service layer also wipes the session cache to cut access.
      references: {
        model: AdminRole,
        key: "name",
      },
      onDelete: "CASCADE",
      onUpdate: "CASCADE",
    },
    note: {
      type: DataTypes.STRING,
      allowNull: true,
    },
  },
  {
    tableName: "authorized_users",
    timestamps: true,
  },
);
