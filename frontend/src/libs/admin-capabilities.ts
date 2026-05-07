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

/**
 * Typed audience key — matches the three formats used by v2 behavior audience:
 *   'all' | 'user:<userId>' | 'group:<groupName>'
 * group names may contain Unicode / punctuation, so the behavior scoped token
 * regex must not exclude colons or dots from the audience segment.
 */
export type AudienceKey =
    | { kind: 'all' }
    | { kind: 'user'; userId: string }
    | { kind: 'group'; groupName: string };

const SCOPED_GUILD_RE = /^guild:([^.:]+)\.(message|manage)$/;
/** Allow any character in the audience segment (user IDs, group names with Unicode/punctuation). */
const SCOPED_BEHAVIOR_RE = /^behavior:(.+)\.manage$/;

export function makeGuildScopedCapability(guildId: string, scope: GuildScope): GuildScopedCapability {
    return `guild:${guildId}.${scope}`;
}

/**
 * Encode an audience key into a behavior-scoped capability token.
 * Accepts either the legacy `number | string` form (plain targetId) OR
 * a typed AudienceKey object.
 *
 * v2 canonical form: `behavior:all.manage` / `behavior:user:123.manage` / `behavior:group:VIP.manage`
 */
export function makeBehaviorScopedCapability(
    target: number | string | AudienceKey
): BehaviorScopedCapability {
    if (typeof target === 'object') {
        if (target.kind === 'all') return 'behavior:all.manage';
        if (target.kind === 'user') return `behavior:user:${target.userId}.manage`;
        return `behavior:group:${target.groupName}.manage`;
    }
    return `behavior:${target}.manage`;
}

/**
 * Decode a behavior-scoped capability token back to a typed AudienceKey,
 * or return null if the token does not match the expected format.
 */
export function parseBehaviorCapabilityToken(token: string): AudienceKey | null {
    const m = SCOPED_BEHAVIOR_RE.exec(token);
    if (!m) return null;
    const segment = m[1];
    if (segment === 'all') return { kind: 'all' };
    if (segment.startsWith('user:')) return { kind: 'user', userId: segment.slice(5) };
    if (segment.startsWith('group:')) return { kind: 'group', groupName: segment.slice(6) };
    // Legacy numeric / plain-string target id — treat as opaque user id
    return { kind: 'user', userId: segment };
}

function parseScopedGuild(value: string): { guildId: string; scope: GuildScope } | null {
    const m = SCOPED_GUILD_RE.exec(value);
    if (!m) return null;
    return { guildId: m[1], scope: m[2] as GuildScope };
}

function parseScopedBehavior(value: string): { audienceKey: string } | null {
    const m = SCOPED_BEHAVIOR_RE.exec(value);
    if (!m) return null;
    return { audienceKey: m[1] };
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
        if (parsed) ids.add(parsed.audienceKey);
    }
    return ids;
}
