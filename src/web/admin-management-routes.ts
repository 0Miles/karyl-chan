import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Client } from 'discordx';
import {
    addAuthorizedUser,
    createAdminRole,
    deleteAdminRole,
    findAuthorizedUser,
    grantRoleCapability,
    isAdminCapability,
    listAdminRoles,
    listAuthorizedUsers,
    removeAuthorizedUser,
    revokeRoleCapability,
    type AuthorizedUserRecord,
    type AdminCapability
} from './authorized-user.service.js';
import { avatarUrlFor } from './message-mapper.js';

export interface AdminManagementRoutesOptions {
    bot?: Client;
}

interface UserProfile {
    username: string;
    globalName: string | null;
    avatarUrl: string;
}

interface AdminUserView extends AuthorizedUserRecord {
    isOwner: boolean;
    profile: UserProfile | null;
}

async function fetchProfile(bot: Client | undefined, userId: string): Promise<UserProfile | null> {
    if (!bot) return null;
    try {
        const user = await bot.users.fetch(userId);
        return {
            username: user.username,
            globalName: user.globalName ?? null,
            avatarUrl: avatarUrlFor(user.id, user.avatar)
        };
    } catch {
        // Unknown / deleted / not cacheable — let the client render a fallback.
        return null;
    }
}

/**
 * Per-route capability gate. `admin` is a universal token that bypasses
 * every other check, mirroring hasAdminCapability in the permission
 * module. Use this helper for every capability-scoped route so the
 * semantics stay consistent across the admin surface.
 */
function requireCapability(cap: AdminCapability) {
    return (request: FastifyRequest, reply: FastifyReply): boolean => {
        const caps = request.authCapabilities;
        if (caps && (caps.has('admin') || caps.has(cap))) return true;
        reply.code(403).send({ error: `${cap} capability required` });
        return false;
    };
}

const requireAdmin = requireCapability('admin');

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
export async function registerAdminManagementRoutes(
    server: FastifyInstance,
    options: AdminManagementRoutesOptions = {}
): Promise<void> {
    const { bot } = options;
    // Current session's identity + computed capability set. Used by the
    // frontend to render the avatar button, the profile page, and to gate
    // capability-aware UI elements without re-walking authorized_users on
    // every call.
    server.get('/api/admin/me', async (request, reply) => {
        // This route is authenticated by the onRequest hook; if we're here
        // the caller already has at least one capability. authUserId is set
        // by that hook.
        if (!request.authUserId) {
            reply.code(401).send({ error: 'Unauthorized' });
            return;
        }
        const ownerId = readOwnerId();
        const isOwner = ownerId !== null && request.authUserId === ownerId;
        const row = isOwner ? null : await findAuthorizedUser(request.authUserId);
        const profile = await fetchProfile(bot, request.authUserId);
        return {
            userId: request.authUserId,
            isOwner,
            role: isOwner ? 'owner' : (row?.role ?? null),
            note: row?.note ?? null,
            profile,
            capabilities: [...(request.authCapabilities ?? new Set())]
        };
    });

    // ── Users ────────────────────────────────────────────────────────────
    //
    // Returns the bot owner as a pinned, synthetic entry (role: 'owner',
    // isOwner: true) followed by the actual authorized_users rows in the
    // order the service produced them. Every entry is hydrated with the
    // Discord profile (avatar + display name) when the client is available;
    // profile is null if the fetch failed or the bot client is absent.
    server.get('/api/admin/users', async (request, reply) => {
        if (!requireAdmin(request, reply)) return;
        const rows = await listAuthorizedUsers();
        const ownerId = readOwnerId();

        const hydrated: AdminUserView[] = [];
        if (ownerId) {
            hydrated.push({
                userId: ownerId,
                role: 'owner',
                note: null,
                isOwner: true,
                profile: await fetchProfile(bot, ownerId)
            });
        }
        // Parallelize profile fetches — usually just a handful of users.
        const others = await Promise.all(rows.map(async (row) => {
            // Defensive: if an owner somehow lives in authorized_users, fold
            // it into the owner entry rather than surfacing a duplicate.
            if (ownerId && row.userId === ownerId) return null;
            return {
                ...row,
                isOwner: false,
                profile: await fetchProfile(bot, row.userId)
            } satisfies AdminUserView;
        }));
        for (const entry of others) if (entry) hydrated.push(entry);

        return { ownerId, users: hydrated };
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
            const targetRole = roles.find(r => r.name === body.role);
            if (!targetRole) {
                reply.code(400).send({ error: `unknown role "${body.role}"` });
                return;
            }
            // Self-lockout guard: moving yourself to a role without the
            // `admin` capability would make this the last request you could
            // make. Owner is exempt via the BOT_OWNER_ID bypass.
            if (
                request.authUserId
                && body.userId === request.authUserId
                && request.authUserId !== ownerId
                && !targetRole.capabilities.includes('admin')
            ) {
                reply.code(400).send({ error: 'cannot move yourself to a role without the admin capability' });
                return;
            }
            const note = isNonEmptyString(body.note) ? body.note : null;
            const record = await addAuthorizedUser(body.userId, body.role, note);
            return record;
        }
    );

    server.delete<{ Params: { userId: string } }>('/api/admin/users/:userId', async (request, reply) => {
        if (!requireAdmin(request, reply)) return;
        const ownerId = readOwnerId();
        // Self-lockout guard: deleting your own allow-list row severs access
        // the moment the capability cache expires. Owner is exempt.
        if (
            request.authUserId === request.params.userId
            && request.authUserId !== ownerId
        ) {
            reply.code(400).send({ error: 'cannot remove yourself from the allow list' });
            return;
        }
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
            // PATCH on a non-existent role should 404 — the old handler
            // happily created one via the upsert shortcut, which made the
            // verb misleading.
            const existing = await listAdminRoles();
            if (!existing.some(r => r.name === request.params.name)) {
                reply.code(404).send({ error: 'role not found' });
                return;
            }
            const body = request.body ?? {};
            const description = isNonEmptyString(body.description) ? body.description : null;
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
