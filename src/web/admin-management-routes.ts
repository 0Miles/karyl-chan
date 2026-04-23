import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
    ADMIN_CAPABILITIES,
    ADMIN_CAPABILITY_KEYS,
    addAuthorizedUser,
    createAdminRole,
    deleteAdminRole,
    grantRoleCapability,
    isAdminCapability,
    listAdminRoles,
    listAuthorizedUsers,
    removeAuthorizedUser,
    revokeRoleCapability,
    type AdminCapability
} from './authorized-user.service.js';

function requireAdmin(request: FastifyRequest, reply: FastifyReply): boolean {
    if (request.authCapabilities?.has('admin')) return true;
    reply.code(403).send({ error: 'admin capability required' });
    return false;
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}

function readOwnerId(): string | null {
    return process.env.BOT_OWNER_ID?.trim() || null;
}

/**
 * Admin-only management surface for non-owner access: CRUD on the
 * authorized_users allow-list, admin_roles definitions, and the
 * role→capability mapping. Every route is gated behind the `admin`
 * capability so only a user whose role carries it (or the bot owner)
 * can reach them.
 */
export async function registerAdminManagementRoutes(server: FastifyInstance): Promise<void> {
    // Catalog of capability tokens the app understands. Clients pull this
    // to render the "grant capability" dropdown so adding a new token in
    // code immediately surfaces in the UI.
    server.get('/api/admin/capabilities', async (request, reply) => {
        if (!requireAdmin(request, reply)) return;
        return {
            capabilities: ADMIN_CAPABILITY_KEYS.map(key => ({
                key,
                description: ADMIN_CAPABILITIES[key]
            }))
        };
    });

    // ── Users ────────────────────────────────────────────────────────────
    server.get('/api/admin/users', async (request, reply) => {
        if (!requireAdmin(request, reply)) return;
        const users = await listAuthorizedUsers();
        return {
            ownerId: readOwnerId(),
            users
        };
    });

    server.post<{ Body: { userId?: unknown; role?: unknown; note?: unknown } }>(
        '/api/admin/users',
        async (request, reply) => {
            if (!requireAdmin(request, reply)) return;
            const body = request.body ?? {};
            if (!isNonEmptyString(body.userId) || !isNonEmptyString(body.role)) {
                reply.code(400).send({ error: 'userId and role are required' });
                return;
            }
            // Block setting an allow-list row for the owner itself — owner
            // is always implicitly admin, and a stale row would mislead.
            const ownerId = readOwnerId();
            if (ownerId && body.userId === ownerId) {
                reply.code(400).send({ error: 'owner is implicitly admin and cannot be listed' });
                return;
            }
            const roles = await listAdminRoles();
            if (!roles.some(r => r.name === body.role)) {
                reply.code(400).send({ error: `unknown role "${body.role}"` });
                return;
            }
            const note = isNonEmptyString(body.note) ? body.note : null;
            const record = await addAuthorizedUser(body.userId, body.role, note);
            return record;
        }
    );

    server.delete<{ Params: { userId: string } }>('/api/admin/users/:userId', async (request, reply) => {
        if (!requireAdmin(request, reply)) return;
        const removed = await removeAuthorizedUser(request.params.userId);
        if (!removed) {
            reply.code(404).send({ error: 'user not in allow list' });
            return;
        }
        reply.code(204).send();
    });

    // ── Roles ────────────────────────────────────────────────────────────
    server.get('/api/admin/roles', async (request, reply) => {
        if (!requireAdmin(request, reply)) return;
        const roles = await listAdminRoles();
        return { roles };
    });

    server.post<{ Body: { name?: unknown; description?: unknown } }>(
        '/api/admin/roles',
        async (request, reply) => {
            if (!requireAdmin(request, reply)) return;
            const body = request.body ?? {};
            if (!isNonEmptyString(body.name)) {
                reply.code(400).send({ error: 'name is required' });
                return;
            }
            const description = isNonEmptyString(body.description) ? body.description : null;
            const record = await createAdminRole(body.name, description);
            return record;
        }
    );

    server.patch<{ Params: { name: string }; Body: { description?: unknown } }>(
        '/api/admin/roles/:name',
        async (request, reply) => {
            if (!requireAdmin(request, reply)) return;
            const body = request.body ?? {};
            const description = isNonEmptyString(body.description)
                ? body.description
                : body.description === null
                    ? null
                    : null;
            // createAdminRole doubles as an upsert so PATCH reuses it.
            const record = await createAdminRole(request.params.name, description);
            return record;
        }
    );

    server.delete<{ Params: { name: string } }>('/api/admin/roles/:name', async (request, reply) => {
        if (!requireAdmin(request, reply)) return;
        // Block nuking the only admin-capable role the caller is actually
        // using — otherwise the request that just deleted it will be the
        // last one they can make. Owner is exempt since they retain access
        // via BOT_OWNER_ID bypass.
        const ownerId = readOwnerId();
        if (request.authUserId && request.authUserId !== ownerId) {
            const allUsers = await listAuthorizedUsers();
            const self = allUsers.find(u => u.userId === request.authUserId);
            if (self && self.role === request.params.name) {
                reply.code(400).send({ error: 'cannot delete the role you are currently using' });
                return;
            }
        }
        const removed = await deleteAdminRole(request.params.name);
        if (!removed) {
            reply.code(404).send({ error: 'role not found' });
            return;
        }
        reply.code(204).send();
    });

    // ── Role capabilities ────────────────────────────────────────────────
    server.post<{ Params: { name: string }; Body: { capability?: unknown } }>(
        '/api/admin/roles/:name/capabilities',
        async (request, reply) => {
            if (!requireAdmin(request, reply)) return;
            const cap = request.body?.capability;
            if (!isNonEmptyString(cap) || !isAdminCapability(cap)) {
                reply.code(400).send({ error: 'unknown capability token' });
                return;
            }
            const roles = await listAdminRoles();
            if (!roles.some(r => r.name === request.params.name)) {
                reply.code(404).send({ error: 'role not found' });
                return;
            }
            await grantRoleCapability(request.params.name, cap as AdminCapability);
            reply.code(204).send();
        }
    );

    server.delete<{ Params: { name: string; capability: string } }>(
        '/api/admin/roles/:name/capabilities/:capability',
        async (request, reply) => {
            if (!requireAdmin(request, reply)) return;
            if (!isAdminCapability(request.params.capability)) {
                reply.code(400).send({ error: 'unknown capability token' });
                return;
            }
            // Mirror of the "don't nuke your own role" guard — revoking the
            // `admin` token from your own role is instant self-lockout.
            const ownerId = readOwnerId();
            if (
                request.params.capability === 'admin'
                && request.authUserId
                && request.authUserId !== ownerId
            ) {
                const allUsers = await listAuthorizedUsers();
                const self = allUsers.find(u => u.userId === request.authUserId);
                if (self && self.role === request.params.name) {
                    reply.code(400).send({ error: 'cannot revoke admin from the role you are currently using' });
                    return;
                }
            }
            await revokeRoleCapability(request.params.name, request.params.capability as AdminCapability);
            reply.code(204).send();
        }
    );
}
