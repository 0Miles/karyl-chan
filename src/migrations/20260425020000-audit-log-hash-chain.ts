import { DataTypes, QueryTypes } from 'sequelize';
import { createHash } from 'crypto';
import type { Migration } from './runner.js';

/**
 * Add tamper-evident hash chain to admin_audit_log: each row carries
 * `previousHash` (genesis row is null) and `hash` over
 * `sha256(previousHash || canonical(payload))`. Existing rows are
 * back-filled in id-ascending order so the chain is contiguous from
 * day one — note this does NOT prove pre-migration rows weren't
 * tampered; it just establishes a baseline that any future tampering
 * will break.
 *
 * Canonicalisation MUST match
 * src/modules/admin/admin-audit.service.ts#canonicalPayload exactly. If that
 * function ever changes, version both.
 */

const TABLE = 'admin_audit_log';

interface AuditRow {
    id: number;
    actorUserId: string;
    action: string;
    target: string | null;
    context: string | null;
    createdAt: string;
}

function canonicalPayload(row: AuditRow): string {
    return JSON.stringify({
        actorUserId: row.actorUserId,
        action: row.action,
        target: row.target,
        context: row.context,
        createdAt: new Date(row.createdAt).getTime()
    });
}

function chainHash(previousHash: string | null, payload: string): string {
    return createHash('sha256').update(previousHash ?? '').update('|').update(payload).digest('hex');
}

const migration: Migration = {
    up: async ({ queryInterface, sequelize }) => {
        const tables = await queryInterface.showAllTables();
        if (!tables.includes(TABLE)) return;
        const columns = await queryInterface.describeTable(TABLE);
        if (!columns.previousHash) {
            await queryInterface.addColumn(TABLE, 'previousHash', {
                type: DataTypes.STRING(64),
                allowNull: true
            });
        }
        if (!columns.hash) {
            await queryInterface.addColumn(TABLE, 'hash', {
                type: DataTypes.STRING(64),
                allowNull: false,
                defaultValue: ''
            });
        }
        // Back-fill any rows whose hash is still empty (newly added or
        // existing pre-migration). Walk ascending so each row sees its
        // predecessor's freshly-computed hash.
        const rows = await sequelize.query<AuditRow>(
            `SELECT id, actorUserId, action, target, context, createdAt FROM ${TABLE} ORDER BY id ASC`,
            { type: QueryTypes.SELECT }
        );
        let previousHash: string | null = null;
        for (const row of rows) {
            const payload = canonicalPayload(row);
            const hash = chainHash(previousHash, payload);
            await sequelize.query(
                `UPDATE ${TABLE} SET previousHash = :previousHash, hash = :hash WHERE id = :id`,
                {
                    type: QueryTypes.UPDATE,
                    replacements: { previousHash, hash, id: row.id }
                }
            );
            previousHash = hash;
        }
    },
    down: async ({ queryInterface }) => {
        const tables = await queryInterface.showAllTables();
        if (!tables.includes(TABLE)) return;
        const columns = await queryInterface.describeTable(TABLE);
        if (columns.previousHash) await queryInterface.removeColumn(TABLE, 'previousHash');
        if (columns.hash) await queryInterface.removeColumn(TABLE, 'hash');
    }
};

export default migration;
