import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AdminCapability, GlobalCapability } from './authorized-user.service.js';
import { accessibleGuildIds, hasGuildCapability, type GuildScope } from '../permission/admin-capabilities.js';

/**
 * Per-route global capability gate. The global onRequest hook already
 * proved the caller has _some_ capability; this narrows that further to
 * the specific token the route requires. `admin` is a universal token
 * that bypasses every other check, mirroring hasAdminCapability
 * semantics.
 *
 * Returns true on success and lets the route proceed; on failure it
 * sends a 403 and returns false — callers should short-circuit:
 *
 *     if (!requireCapability(request, reply, 'dm.message')) return;
 */
export function requireCapability(
    request: FastifyRequest,
    reply: FastifyReply,
    capability: GlobalCapability
): boolean {
    const caps = request.authCapabilities;
    if (caps && (caps.has('admin') || caps.has(capability))) return true;
    reply.code(403).send({ error: `${capability} capability required` });
    return false;
}

/**
 * For routes whose data legitimately serves multiple surfaces (e.g.
 * Discord profile lookup is used by both DM cards and guild member
 * popovers). Pass any acceptable global capability; success on the
 * first hit. Per-guild scoped tokens are not considered here — use
 * requireGuildCapability for guild-bound routes.
 */
export function requireAnyCapability(
    request: FastifyRequest,
    reply: FastifyReply,
    capabilities: readonly GlobalCapability[]
): boolean {
    const caps = request.authCapabilities;
    if (caps && caps.has('admin')) return true;
    if (caps) {
        for (const cap of capabilities) {
            if (caps.has(cap)) return true;
        }
    }
    reply.code(403).send({ error: `one of [${capabilities.join(', ')}] capabilities required` });
    return false;
}

/**
 * Per-guild capability gate. Satisfied by `admin`, the global guild
 * token (`guild.<scope>`), or the matching per-guild token
 * (`guild:<guildId>.<scope>`). Use this for any route that operates on
 * a specific guild — every guild-bound endpoint should call it before
 * doing work, even for read-only operations.
 *
 *     if (!requireGuildCapability(request, reply, guildId, 'message')) return;
 */
export function requireGuildCapability(
    request: FastifyRequest,
    reply: FastifyReply,
    guildId: string,
    scope: GuildScope
): boolean {
    const caps = request.authCapabilities as Set<AdminCapability> | undefined;
    if (caps && hasGuildCapability(caps, guildId, scope)) return true;
    reply.code(403).send({
        error: `guild.${scope} (or guild:${guildId}.${scope}) capability required`
    });
    return false;
}

/**
 * Per-guild gate that accepts ANY of the listed scopes — used by
 * read-only entry points (e.g., guild detail) that both `message`-only
 * and `manage`-only users have a legitimate reason to reach.
 */
export function requireAnyGuildCapability(
    request: FastifyRequest,
    reply: FastifyReply,
    guildId: string,
    scopes: readonly GuildScope[]
): boolean {
    const caps = request.authCapabilities as Set<AdminCapability> | undefined;
    if (caps) {
        for (const scope of scopes) {
            if (hasGuildCapability(caps, guildId, scope)) return true;
        }
    }
    reply.code(403).send({
        error: `one of [${scopes.map(s => `guild.${s}`).join(', ')}] capabilities required for guild ${guildId}`
    });
    return false;
}

/**
 * Filter helper for listing endpoints (e.g. GET /api/guilds). Returns a
 * predicate that accepts every guild id when the caller has a global
 * scope, or restricts to the explicit per-guild grants otherwise.
 *
 *     const allow = guildAccessFilter(request);
 *     return guilds.filter(g => allow(g.id));
 */
export function guildAccessFilter(request: FastifyRequest): (guildId: string) => boolean {
    const caps = request.authCapabilities as Set<AdminCapability> | undefined;
    if (!caps) return () => false;
    const access = accessibleGuildIds(caps);
    if (access === 'all') return () => true;
    return (guildId: string) => access.has(guildId);
}
