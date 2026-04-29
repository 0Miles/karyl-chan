/**
 * Admin capability tokens recognized by the backend. Mirrors
 * `src/modules/admin/admin-capabilities.ts` on the server. The server is
 * the authority for validation; this file lets the UI render the
 * catalog and apply local guards without a round-trip for data that
 * never changes at runtime.
 *
 * Descriptions resolve through i18n under `admin.capabilityDesc.<key>`
 * so the UI matches the active locale instead of a hard-coded string.
 */
export const GLOBAL_CAPABILITY_KEYS = [
    'admin',
    'dm.message',
    'guild.message',
    'guild.manage',
    'system.read',
    'behavior.manage'
] as const;

export type GlobalCapability = typeof GLOBAL_CAPABILITY_KEYS[number];

export const GUILD_SCOPES = ['message', 'manage'] as const;
export type GuildScope = typeof GUILD_SCOPES[number];

export type GuildScopedCapability = `guild:${string}.${GuildScope}`;
export type BehaviorScopedCapability = `behavior:${string}.manage`;

/** Anything that can be persisted in the role→capability mapping. */
export type AdminCapability = GlobalCapability | GuildScopedCapability | BehaviorScopedCapability;

const SCOPED_GUILD_RE = /^guild:([^.:]+)\.(message|manage)$/;
const SCOPED_BEHAVIOR_RE = /^behavior:([^.:]+)\.manage$/;

export function makeGuildScopedCapability(guildId: string, scope: GuildScope): GuildScopedCapability {
    return `guild:${guildId}.${scope}`;
}

export function makeBehaviorScopedCapability(targetId: number | string): BehaviorScopedCapability {
    return `behavior:${targetId}.manage`;
}

function parseScopedGuild(value: string): { guildId: string; scope: GuildScope } | null {
    const m = SCOPED_GUILD_RE.exec(value);
    if (!m) return null;
    return { guildId: m[1], scope: m[2] as GuildScope };
}

function parseScopedBehavior(value: string): { targetId: string } | null {
    const m = SCOPED_BEHAVIOR_RE.exec(value);
    if (!m) return null;
    return { targetId: m[1] };
}

/**
 * "Does this user satisfy a global capability?" `admin` always passes.
 * Use for non-guild surfaces (DM, system, admin panel itself).
 */
export function hasAdminCapability(
    granted: Iterable<string>,
    required: GlobalCapability
): boolean {
    for (const cap of granted) {
        if (cap === 'admin') return true;
        if (cap === required) return true;
    }
    return false;
}

/**
 * "Does this user satisfy a guild-scoped capability for this guild?"
 * Satisfied by `admin`, the global guild token (`guild.<scope>`), or
 * the matching per-guild token (`guild:<guildId>.<scope>`).
 *
 * `manage` does NOT imply `message` and vice versa — they're sibling
 * scopes, mirroring the backend's evaluator.
 */
export function hasGuildCapability(
    granted: Iterable<string>,
    guildId: string,
    scope: GuildScope
): boolean {
    const globalToken = `guild.${scope}`;
    const scopedToken = makeGuildScopedCapability(guildId, scope);
    for (const cap of granted) {
        if (cap === 'admin') return true;
        if (cap === globalToken) return true;
        if (cap === scopedToken) return true;
    }
    return false;
}

/**
 * Returns `'all'` if the user has unrestricted guild access (admin /
 * global guild token), otherwise the explicit set of guild ids they
 * carry per-guild grants for. Surfaces the union of `message` +
 * `manage` scopes.
 */
export function accessibleGuildIds(granted: Iterable<string>): 'all' | Set<string> {
    const ids = new Set<string>();
    for (const cap of granted) {
        if (cap === 'admin') return 'all';
        if (cap === 'guild.message' || cap === 'guild.manage') return 'all';
        const parsed = parseScopedGuild(cap);
        if (parsed) ids.add(parsed.guildId);
    }
    return ids;
}

/**
 * "Can the user CRUD behaviors under this target?" — satisfied by
 * `admin`, `behavior.manage`, or the matching per-target token. Mirror
 * of the backend's hasBehaviorCapability.
 */
export function hasBehaviorCapability(
    granted: Iterable<string>,
    targetId: number | string
): boolean {
    const scopedToken = makeBehaviorScopedCapability(targetId);
    for (const cap of granted) {
        if (cap === 'admin') return true;
        if (cap === 'behavior.manage') return true;
        if (cap === scopedToken) return true;
    }
    return false;
}

/**
 * `'all'` when the user can manage every target (admin / behavior.manage),
 * otherwise the explicit set of target ids they hold per-target tokens
 * for. Used to filter the sidebar and gate the page.
 */
export function accessibleBehaviorTargetIds(granted: Iterable<string>): 'all' | Set<string> {
    const ids = new Set<string>();
    for (const cap of granted) {
        if (cap === 'admin') return 'all';
        if (cap === 'behavior.manage') return 'all';
        const parsed = parseScopedBehavior(cap);
        if (parsed) ids.add(parsed.targetId);
    }
    return ids;
}
