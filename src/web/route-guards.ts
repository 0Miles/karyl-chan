import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AdminCapability } from './authorized-user.service.js';

/**
 * Per-route capability gate. The global onRequest hook already proved
 * the caller has _some_ capability; this narrows that further to the
 * specific token the route requires. `admin` is a universal token that
 * bypasses every other check, mirroring hasAdminCapability semantics.
 *
 * Returns true on success and lets the route proceed; on failure it
 * sends a 403 and returns false — callers should short-circuit:
 *
 *     if (!requireCapability(request, reply, 'dm.write')) return;
 */
export function requireCapability(
    request: FastifyRequest,
    reply: FastifyReply,
    capability: AdminCapability
): boolean {
    const caps = request.authCapabilities;
    if (caps && (caps.has('admin') || caps.has(capability))) return true;
    reply.code(403).send({ error: `${capability} capability required` });
    return false;
}

/**
 * For routes whose data legitimately serves multiple surfaces (e.g.
 * Discord profile lookup is used by both DM cards and guild member
 * popovers). Pass any acceptable capability; success on the first hit.
 */
export function requireAnyCapability(
    request: FastifyRequest,
    reply: FastifyReply,
    capabilities: readonly AdminCapability[]
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
