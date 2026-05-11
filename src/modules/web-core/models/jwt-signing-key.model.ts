import { DataTypes } from "sequelize";
import { sequelize } from "../../../db.js";

/**
 * `jwt_signing_keys` — persisted Ed25519 keys for the bot's JWT signing
 * authority (see jwt.service.ts). Exactly one row has `active = true`
 * (the key currently in use); rotation inserts a new active row and
 * flips the previous one to inactive. Old rows are kept for audit.
 *
 * `privateKeyEnc` is `encryptSecret(base64(PKCS#8 DER))` — the private
 * key never sits on disk in cleartext. `publicKeyPem` is the SPKI PEM
 * (public — handed to plugins, surfaced in the admin UI).
 */
export const JwtSigningKey = sequelize.define(
  "JwtSigningKey",
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    algorithm: { type: DataTypes.STRING, allowNull: false },
    privateKeyEnc: { type: DataTypes.TEXT, allowNull: false },
    publicKeyPem: { type: DataTypes.TEXT, allowNull: false },
    active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
  },
  {
    tableName: "jwt_signing_keys",
    timestamps: true,
  },
);

export interface JwtSigningKeyRow {
  id: number;
  algorithm: string;
  privateKeyEnc: string;
  publicKeyPem: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

function rowOf(model: InstanceType<typeof JwtSigningKey>): JwtSigningKeyRow {
  return {
    id: model.getDataValue("id") as number,
    algorithm: model.getDataValue("algorithm") as string,
    privateKeyEnc: model.getDataValue("privateKeyEnc") as string,
    publicKeyPem: model.getDataValue("publicKeyPem") as string,
    active: !!model.getDataValue("active"),
    createdAt: model.getDataValue("createdAt") as Date,
    updatedAt: model.getDataValue("updatedAt") as Date,
  };
}

/** The currently-active signing key row, or null on a fresh DB. */
export const getActiveJwtSigningKey =
  async (): Promise<JwtSigningKeyRow | null> => {
    const row = await JwtSigningKey.findOne({ where: { active: true } });
    return row ? rowOf(row) : null;
  };

/**
 * Insert a new active key, demoting any previously-active one. Runs in a
 * transaction so there's never zero or two active rows.
 */
export const insertActiveJwtSigningKey = async (input: {
  algorithm: string;
  privateKeyEnc: string;
  publicKeyPem: string;
}): Promise<JwtSigningKeyRow> => {
  return sequelize.transaction(async (t) => {
    await JwtSigningKey.update(
      { active: false },
      { where: { active: true }, transaction: t },
    );
    const created = await JwtSigningKey.create(
      {
        algorithm: input.algorithm,
        privateKeyEnc: input.privateKeyEnc,
        publicKeyPem: input.publicKeyPem,
        active: true,
      },
      { transaction: t },
    );
    return rowOf(created);
  });
};
