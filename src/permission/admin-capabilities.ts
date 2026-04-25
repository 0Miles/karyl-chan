/**
 * Capability tokens for the admin web panel. Each token names a discrete
 * power a role can grant; `admin` is a superuser token that bypasses
 * every other check. The granular tokens (`dm.*`, `guild.*`, `system.*`)
 * let an operator hand out narrower access — e.g. a moderator role with
 * `guild.read` + `guild.write` but no DM visibility. The default `admin`
 * role still ships with the `admin` token so every existing deployment
 * keeps working.
 */
export const ADMIN_CAPABILITIES = {
    admin: '完整操作 admin 系統的權限(可無視其他所有限制)',
    'dm.read': '讀取 DM 對話列表、訊息與未讀數',
    'dm.write': '在 DM 中傳送、編輯、刪除訊息與反應',
    'guild.read': '讀取公會頻道、訊息、成員與角色',
    'guild.write': '在公會頻道中傳送、編輯、刪除訊息與反應',
    'system.read': '查看系統事件記錄與統計資訊'
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
        // The `admin` token alone is enough thanks to the bypass in
        // hasAdminCapability; the granular ones are not added here on
        // purpose so a deployment can later split off narrower roles
        // without first having to scrub a redundant grant set.
        capabilities: ['admin']
    }
];
