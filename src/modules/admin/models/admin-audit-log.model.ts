import { DataTypes } from "sequelize";
import { sequelize } from "../../../db.js";

/**
 * Append-only audit trail for admin mutations: who (Discord user id of
 * the actor), what (action token — namespaced strings like "user.upsert"),
 * target (the row/key the action touched, if any), and a JSON context
 * blob for action-specific extras (old vs new role, the capability
 * involved, etc.). `createdAt` comes from Sequelize timestamps.
 *
 * Each row is also linked to the previous one via a sha256 hash chain
 * (see admin-audit.service#recordAudit) so any post-hoc modification of
 * a historical row breaks the chain and a periodic verification pass
 * can detect tampering even with full DB write access.
 *
 * Deletes are intentionally not supported — the row is the provenance
 * record. If truncation is ever needed, do it with a window + explicit
 * SQL, not via the ORM.
 */
export const AdminAuditLog = sequelize.define(
  "AdminAuditLog",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    actorUserId: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    action: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    target: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    // JSON column lets Sequelize handle (de)serialization for callers,
    // so route handlers see/store a plain object. Storage on SQLite is
    // still TEXT under the hood — `DataTypes.JSON` is a Sequelize
    // construct, not a SQL type — so existing rows that already hold
    // JSON.stringify output round-trip cleanly without a data migration.
    // The audit hash chain canonicaliser compensates by re-stringifying
    // on both write and verify so the byte form fed into sha256 stays
    // stable across the type change.
    context: {
      type: DataTypes.JSON,
      allowNull: true,
    },
    // Chain links. `previousHash` is null for the genesis row; `hash`
    // covers (previousHash || canonical(payload)) for THIS row. Indexed
    // lookup-by-id is fine — verification walks ascending and doesn't
    // need a hash index.
    previousHash: {
      type: DataTypes.STRING(64),
      allowNull: true,
    },
    hash: {
      type: DataTypes.STRING(64),
      allowNull: false,
      defaultValue: "",
    },
  },
  {
    tableName: "admin_audit_log",
    timestamps: true,
    updatedAt: false,
    indexes: [
      // "show me what user X did" is a foreseeable filter once the log
      // grows; a single column index is cheap here and saves a full
      // scan every time the future per-actor view is added.
      { name: "admin_audit_log_actor_user_id_idx", fields: ["actorUserId"] },
    ],
  },
);
