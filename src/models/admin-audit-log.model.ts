import { DataTypes } from 'sequelize';
import { sequelize } from './db.js';

/**
 * Append-only audit trail for admin mutations: who (Discord user id of
 * the actor), what (action token — namespaced strings like "user.upsert"),
 * target (the row/key the action touched, if any), and a JSON context
 * blob for action-specific extras (old vs new role, the capability
 * involved, etc.). `createdAt` comes from Sequelize timestamps.
 *
 * Deletes are intentionally not supported — the row is the provenance
 * record. If truncation is ever needed, do it with a window + explicit
 * SQL, not via the ORM.
 */
export const AdminAuditLog = sequelize.define('AdminAuditLog', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    actorUserId: {
        type: DataTypes.STRING,
        allowNull: false
    },
    action: {
        type: DataTypes.STRING,
        allowNull: false
    },
    target: {
        type: DataTypes.STRING,
        allowNull: true
    },
    context: {
        type: DataTypes.TEXT,
        allowNull: true
    }
}, {
    tableName: 'admin_audit_log',
    timestamps: true,
    updatedAt: false
});
