/**
 * Capability tokens for the admin web panel.
 *
 * The model has three concentric layers:
 *
 *   1. `admin` — superuser bypass, satisfies every check.
 *   2. Global tokens (`dm.message`, `system.read`, `guild.message`,
 *      `guild.manage`) — apply across the entire bot's surface.
 *   3. Guild-scoped tokens (`guild:<id>.message`, `guild:<id>.manage`)
 *      — restrict the same guild scope to a single guild id.
 *
 * Storage stays a flat string column on `admin_role_capabilities`; the
 * scoped tokens are encoded into the same string. Matching:
 *
 *   - "can user act on guild X with `message` scope?"  →  satisfied by
 *     `admin`, `guild.message`, OR `guild:X.message`.
 *   - "what guild scope does this user have?" — `accessibleGuildIds`
 *     returns either `'all'` (when `admin` or a global guild scope is
 *     present) or the explicit set of guild ids the per-guild tokens
 *     name.
 *
 * Default `admin` role keeps shipping with the `admin` token so every
 * existing deployment still works.
 */

export const GLOBAL_CAPABILITY_DESCRIPTIONS = {
    admin: '完整操作 admin 系統的權限(可無視其他所有限制)',
    'dm.message': '讀寫 DM 對話列表、訊息、未讀數與反應',
    'guild.message': '讀寫所有公會的頻道訊息、反應',
    'guild.manage': '管理所有公會的成員、角色、設定與 bot 功能',
    'system.read': '查看系統事件記錄與統計資訊'
} as const;

export type GlobalCapability = keyof typeof GLOBAL_CAPABILITY_DESCRIPTIONS;
export const GLOBAL_CAPABILITY_KEYS = Object.keys(GLOBAL_CAPABILITY_DESCRIPTIONS) as GlobalCapability[];

/**
 * Per-guild scope kinds. `message` covers reading + sending messages
 * in the guild's channels; `manage` covers everything else (member
 * management, settings, bot-feature configuration).
 */
export const GUILD_SCOPES = ['message', 'manage'] as const;
export type GuildScope = typeof GUILD_SCOPES[number];

/**
 * Token for the global guild scope (e.g. `guild.message`).
 */
export type GuildGlobalCapability = `guild.${GuildScope}`;

/**
 * Token for a per-guild scope (e.g. `guild:1234.message`).
 */
export type GuildScopedCapability = `guild:${string}.${GuildScope}`;

/**
 * Any token persisted in `admin_role_capabilities`.
 */
export type AdminCapability = GlobalCapability | GuildScopedCapability;

const SCOPED_GUILD_RE = /^guild:([^.:]+)\.(message|manage)$/;

function isGlobalCapability(value: string): value is GlobalCapability {
    return Object.prototype.hasOwnProperty.call(GLOBAL_CAPABILITY_DESCRIPTIONS, value);
}

function parseScopedGuild(value: string): { guildId: string; scope: GuildScope } | null {
    const m = SCOPED_GUILD_RE.exec(value);
    if (!m) return null;
    return { guildId: m[1], scope: m[2] as GuildScope };
}

export function isAdminCapability(value: string): value is AdminCapability {
    return isGlobalCapability(value) || parseScopedGuild(value) !== null;
}

export function makeGuildScopedCapability(guildId: string, scope: GuildScope): GuildScopedCapability {
    return `guild:${guildId}.${scope}`;
}

/**
 * Pure evaluator: does this set of capabilities satisfy the required
 * global token? Used by routes that aren't guild-bound (DM, system,
 * admin management). `admin` always passes.
 */
export function hasAdminCapability(
    granted: Iterable<AdminCapability>,
    required: GlobalCapability
): boolean {
    for (const cap of granted) {
        if (cap === 'admin') return true;
        if (cap === required) return true;
    }
    return false;
}

/**
 * Pure evaluator for guild-bound routes. Satisfied by:
 *   - `admin`
 *   - `guild.<scope>`               (global guild scope)
 *   - `guild:<guildId>.<scope>`     (matching per-guild scope)
 *
 * Note that `manage` does not imply `message` and vice versa — the
 * user's wording explicitly treats them as siblings, so a role with
 * only `manage` cannot post messages in the guild's channels.
 */
export function hasGuildCapability(
    granted: Iterable<AdminCapability>,
    guildId: string,
    scope: GuildScope
): boolean {
    const globalToken: GuildGlobalCapability = `guild.${scope}`;
    const scopedToken = makeGuildScopedCapability(guildId, scope);
    for (const cap of granted) {
        if (cap === 'admin') return true;
        if (cap === globalToken) return true;
        if (cap === scopedToken) return true;
    }
    return false;
}

/**
 * Returns the set of guild ids the user can see, or the literal string
 * `'all'` when their grants include `admin` or any global guild token
 * (in which case the route should pass through every guild without
 * filtering).
 *
 * Surfaces the union of `message` and `manage` scopes — a user who can
 * `manage` a guild but not `message` it should still see the guild in
 * their guild list (they need to reach the management UI).
 */
export function accessibleGuildIds(
    granted: Iterable<AdminCapability>
): 'all' | Set<string> {
    const ids = new Set<string>();
    for (const cap of granted) {
        if (cap === 'admin') return 'all';
        if (cap === 'guild.message' || cap === 'guild.manage') return 'all';
        const parsed = parseScopedGuild(cap);
        if (parsed) ids.add(parsed.guildId);
    }
    return ids;
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
