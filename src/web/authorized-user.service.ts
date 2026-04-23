import { AuthorizedUser } from '../models/authorized-user.model.js';
import { AdminRole } from '../models/admin-role.model.js';
import { AdminRoleCapability } from '../models/admin-role-capability.model.js';
import {
    ADMIN_CAPABILITIES,
    ADMIN_CAPABILITY_KEYS,
    DEFAULT_ROLES,
    isAdminCapability,
    type AdminCapability
} from '../permission/admin-capabilities.js';

export { ADMIN_CAPABILITIES, ADMIN_CAPABILITY_KEYS, isAdminCapability, type AdminCapability };

export interface AuthorizedUserRecord {
    userId: string;
    role: string;
    note: string | null;
}

export interface AdminRoleRecord {
    name: string;
    description: string | null;
    capabilities: AdminCapability[];
}

function readOwnerId(): string | null {
    return process.env.BOT_OWNER_ID?.trim() || null;
}

function toUserRecord(row: InstanceType<typeof AuthorizedUser>): AuthorizedUserRecord {
    return {
        userId: row.getDataValue('userId') as string,
        role: row.getDataValue('role') as string,
        note: (row.getDataValue('note') as string | null) ?? null
    };
}

// ── Seeding ────────────────────────────────────────────────────────────────
// Runs on boot so a fresh DB has at least an `admin` role granting every
// current capability. Existing rows are left alone — seeding only adds
// missing defaults.

export async function seedDefaultRoles(): Promise<void> {
    for (const def of DEFAULT_ROLES) {
        await AdminRole.findOrCreate({
            where: { name: def.name },
            defaults: { name: def.name, description: def.description }
        });
        for (const cap of def.capabilities) {
            await AdminRoleCapability.findOrCreate({
                where: { role: def.name, capability: cap },
                defaults: { role: def.name, capability: cap }
            });
        }
    }
}

// ── Capability resolution ─────────────────────────────────────────────────

async function capabilitiesForRole(role: string): Promise<Set<AdminCapability>> {
    const rows = await AdminRoleCapability.findAll({ where: { role } });
    const result = new Set<AdminCapability>();
    for (const row of rows) {
        const cap = row.getDataValue('capability') as string;
        if (isAdminCapability(cap)) result.add(cap);
    }
    return result;
}

/**
 * Combined resolution: bot owner gets every capability; any other user gets
 * the set defined by their assigned role. Returns an empty set (caller should
 * treat as unauthorized) for users with no entry in authorized_users.
 */
export async function resolveUserCapabilities(
    userId: string,
    ownerId: string | null = readOwnerId()
): Promise<Set<AdminCapability>> {
    if (ownerId && userId === ownerId) return new Set(ADMIN_CAPABILITY_KEYS);
    const user = await AuthorizedUser.findByPk(userId);
    if (!user) return new Set();
    return capabilitiesForRole(user.getDataValue('role') as string);
}

/**
 * Lightweight "can this user log in?" check. Owner is always allowed; any
 * other user needs a row in authorized_users AND at least one capability
 * granted via their role. The returned role name is what we put in the
 * login-link message and (optionally) the session context.
 */
export async function resolveLoginRole(
    userId: string,
    ownerId: string | null = readOwnerId()
): Promise<string | null> {
    if (ownerId && userId === ownerId) return 'admin';
    const user = await AuthorizedUser.findByPk(userId);
    if (!user) return null;
    const role = user.getDataValue('role') as string;
    const caps = await capabilitiesForRole(role);
    if (caps.size === 0) return null;
    return role;
}

// ── Authorized-user CRUD ──────────────────────────────────────────────────

export async function listAuthorizedUsers(): Promise<AuthorizedUserRecord[]> {
    const rows = await AuthorizedUser.findAll({ order: [['userId', 'ASC']] });
    return rows.map(toUserRecord);
}

export async function findAuthorizedUser(userId: string): Promise<AuthorizedUserRecord | null> {
    const row = await AuthorizedUser.findByPk(userId);
    return row ? toUserRecord(row) : null;
}

export async function addAuthorizedUser(userId: string, role: string, note: string | null = null): Promise<AuthorizedUserRecord> {
    // Caller is expected to pre-validate that the role exists; we don't
    // enforce a FK so listing a user against an undefined role leaves them
    // harmless (capabilities set resolves to empty → no access).
    const [row] = await AuthorizedUser.upsert({ userId, role, note });
    return toUserRecord(row);
}

export async function removeAuthorizedUser(userId: string): Promise<boolean> {
    const deleted = await AuthorizedUser.destroy({ where: { userId } });
    return deleted > 0;
}

// ── Role CRUD ─────────────────────────────────────────────────────────────

export async function listAdminRoles(): Promise<AdminRoleRecord[]> {
    const roles = await AdminRole.findAll({ order: [['name', 'ASC']] });
    const result: AdminRoleRecord[] = [];
    for (const role of roles) {
        const name = role.getDataValue('name') as string;
        const caps = await capabilitiesForRole(name);
        result.push({
            name,
            description: (role.getDataValue('description') as string | null) ?? null,
            capabilities: [...caps]
        });
    }
    return result;
}

export async function createAdminRole(name: string, description: string | null = null): Promise<AdminRoleRecord> {
    await AdminRole.upsert({ name, description });
    const caps = await capabilitiesForRole(name);
    return { name, description, capabilities: [...caps] };
}

export async function deleteAdminRole(name: string): Promise<boolean> {
    // Cap rows cascade manually — sequelize doesn't enforce FKs on SQLite by
    // default here. Any AuthorizedUser still referencing this role will
    // resolve to an empty capability set and be treated as unauthorized.
    await AdminRoleCapability.destroy({ where: { role: name } });
    const removed = await AdminRole.destroy({ where: { name } });
    return removed > 0;
}

export async function grantRoleCapability(role: string, capability: AdminCapability): Promise<void> {
    await AdminRoleCapability.findOrCreate({
        where: { role, capability },
        defaults: { role, capability }
    });
}

export async function revokeRoleCapability(role: string, capability: AdminCapability): Promise<void> {
    await AdminRoleCapability.destroy({ where: { role, capability } });
}
