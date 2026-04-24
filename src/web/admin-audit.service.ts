import { AdminAuditLog } from '../models/admin-audit-log.model.js';

export interface AdminAuditEntry {
    id: number;
    actorUserId: string;
    action: string;
    target: string | null;
    context: Record<string, unknown> | null;
    createdAt: string;
}

/**
 * Append a single audit row. Best-effort: we log-and-swallow errors so
 * a failing audit write doesn't break the mutation that triggered it.
 * The cost of a false-negative in the log beats the cost of a 500 on
 * a successful role change because the audit table is briefly locked.
 */
export async function recordAudit(
    actorUserId: string,
    action: string,
    target: string | null = null,
    context: Record<string, unknown> | null = null
): Promise<void> {
    try {
        await AdminAuditLog.create({
            actorUserId,
            action,
            target,
            context: context ? JSON.stringify(context) : null
        });
    } catch (err) {
        console.error('admin audit write failed:', err);
    }
}

export interface ListAuditOptions {
    limit?: number;
    before?: number;
}

export async function listAudit(options: ListAuditOptions = {}): Promise<AdminAuditEntry[]> {
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 500);
    const where = typeof options.before === 'number'
        ? { id: { [(await import('sequelize')).Op.lt]: options.before } }
        : undefined;
    const rows = await AdminAuditLog.findAll({
        where,
        order: [['id', 'DESC']],
        limit
    });
    return rows.map(row => {
        const rawContext = row.getDataValue('context') as string | null;
        let context: Record<string, unknown> | null = null;
        if (rawContext) {
            try {
                const parsed = JSON.parse(rawContext);
                if (parsed && typeof parsed === 'object') context = parsed as Record<string, unknown>;
            } catch {
                // Malformed context — skip rather than 500 the whole list.
            }
        }
        return {
            id: row.getDataValue('id') as number,
            actorUserId: row.getDataValue('actorUserId') as string,
            action: row.getDataValue('action') as string,
            target: (row.getDataValue('target') as string | null) ?? null,
            context,
            createdAt: (row.getDataValue('createdAt') as Date).toISOString()
        };
    });
}
