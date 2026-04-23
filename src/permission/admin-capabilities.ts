/**
 * Capability tokens for the admin web panel. Each token names a discrete
 * power a role can grant; `admin` is a superuser token that bypasses every
 * other check. Future tokens will land here (read-messages, send-messages,
 * view-guilds, etc.) — keep this list as the single source of truth.
 */
export const ADMIN_CAPABILITIES = {
    admin: '完整操作 admin 系統的權限(可無視其他所有限制)'
} as const;

export type AdminCapability = keyof typeof ADMIN_CAPABILITIES;

export const ADMIN_CAPABILITY_KEYS = Object.keys(ADMIN_CAPABILITIES) as AdminCapability[];

export function isAdminCapability(value: string): value is AdminCapability {
    return Object.prototype.hasOwnProperty.call(ADMIN_CAPABILITIES, value);
}

/**
 * Pure evaluator: does this set of capabilities satisfy the required one?
 * `admin` always passes. Kept side-effect-free so it's trivially unit-tested.
 */
export function hasAdminCapability(
    granted: Iterable<AdminCapability>,
    required: AdminCapability
): boolean {
    for (const cap of granted) {
        if (cap === 'admin') return true;
        if (cap === required) return true;
    }
    return false;
}

/** Default role definitions — seeded on first boot so a fresh install works. */
export const DEFAULT_ROLES: { name: string; description: string; capabilities: AdminCapability[] }[] = [
    {
        name: 'admin',
        description: 'Full administrative access',
        capabilities: ['admin']
    }
];
