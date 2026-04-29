import { DataTypes } from "sequelize";
import { sequelize } from "../../../db.js";

export const RefreshToken = sequelize.define(
  "RefreshToken",
  {
    hash: {
      type: DataTypes.STRING,
      primaryKey: true,
    },
    ownerId: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    expiresAt: {
      type: DataTypes.BIGINT,
      allowNull: false,
    },
  },
  {
    tableName: "RefreshTokens",
    // Keep Sequelize's default `timestamps: true` — earlier deployments
    // were created without an explicit option, so the on-disk
    // `RefreshTokens` table has NOT NULL createdAt/updatedAt columns.
    // Switching to `timestamps: false` made INSERTs blow up with a
    // NOT NULL constraint violation, killing every login flow that
    // depended on RefreshToken.upsert (see auth-store#issueTokens).
    // ownerId is the lookup column for sign-out / global revoke (see
    // refresh-token.repository#deleteByOwner). Without this index every
    // logout walks the whole table.
    indexes: [{ name: "refresh_tokens_owner_id_idx", fields: ["ownerId"] }],
  },
);
