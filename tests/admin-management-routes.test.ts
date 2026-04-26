import { vi, describe, it, expect, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';

vi.hoisted(() => {
    process.env.SQLITE_DB_PATH = ':memory:';
});

import Fastify, { type FastifyInstance } from 'fastify';
import { sequelize } from '../src/models/db.js';
import { registerAdminManagementRoutes } from '../src/web/admin-management-routes.js';
import {
    addAuthorizedUser,
    createAdminRole,
    grantRoleCapability,
    invalidateCapabilityCache,
    seedDefaultRoles,
    type AdminCapability
} from '../src/web/authorized-user.service.js';

const OWNER_ID = '999999999999999999';
const ADMIN_USER_ID = '111111111111111111';
const SECOND_USER_ID = '222222222222222222';

/**
 * Build a fastify instance with the admin routes registered AND a
 * synthetic onRequest hook that plays the part of the global auth
 * hook (server.ts) — this lets us drive the routes directly without
 * standing up the whole server.
 */
async function buildServer(actor: { userId: string; caps: AdminCapability[] }): Promise<FastifyInstance> {
    const fastify = Fastify({ logger: false });
    fastify.addHook('onRequest', async (request) => {
        request.authUserId = actor.userId;
        request.authCapabilities = new Set(actor.caps);
    });
    await registerAdminManagementRoutes(fastify);
    await fastify.ready();
    return fastify;
}

beforeAll(async () => {
    await sequelize.sync({ force: true });
});

beforeEach(async () => {
    await sequelize.sync({ force: true });
    invalidateCapabilityCache();
    process.env.BOT_OWNER_ID = OWNER_ID;
    await seedDefaultRoles();
});

afterEach(() => {
    invalidateCapabilityCache();
});

afterAll(async () => {
    delete process.env.BOT_OWNER_ID;
    await sequelize.close();
});

describe('GET /api/admin/capabilities', () => {
    it('returns the canonical capability catalog', async () => {
        const server = await buildServer({ userId: OWNER_ID, caps: ['admin'] });
        try {
            const r = await server.inject({ method: 'GET', url: '/api/admin/capabilities' });
            expect(r.statusCode).toBe(200);
            const body = r.json() as { capabilities: { key: string; description: string }[] };
            expect(body.capabilities.find(c => c.key === 'admin')).toBeDefined();
            expect(body.capabilities.find(c => c.key === 'dm.message')).toBeDefined();
            expect(body.capabilities.every(c => typeof c.description === 'string' && c.description.length > 0)).toBe(true);
        } finally { await server.close(); }
    });

    it('returns 403 without admin capability', async () => {
        const server = await buildServer({ userId: ADMIN_USER_ID, caps: ['dm.message'] });
        try {
            const r = await server.inject({ method: 'GET', url: '/api/admin/capabilities' });
            expect(r.statusCode).toBe(403);
        } finally { await server.close(); }
    });
});

describe('POST /api/admin/users', () => {
    it('rejects a non-snowflake userId', async () => {
        const server = await buildServer({ userId: OWNER_ID, caps: ['admin'] });
        try {
            const r = await server.inject({
                method: 'POST',
                url: '/api/admin/users',
                payload: { userId: 'not-a-snowflake', role: 'admin' }
            });
            expect(r.statusCode).toBe(400);
            expect(r.json().error).toMatch(/snowflake/);
        } finally { await server.close(); }
    });

    it('rejects when role is missing', async () => {
        const server = await buildServer({ userId: OWNER_ID, caps: ['admin'] });
        try {
            const r = await server.inject({
                method: 'POST',
                url: '/api/admin/users',
                payload: { userId: ADMIN_USER_ID }
            });
            expect(r.statusCode).toBe(400);
        } finally { await server.close(); }
    });

    it('rejects when note exceeds USER_NOTE_MAX', async () => {
        const server = await buildServer({ userId: OWNER_ID, caps: ['admin'] });
        try {
            const r = await server.inject({
                method: 'POST',
                url: '/api/admin/users',
                payload: { userId: ADMIN_USER_ID, role: 'admin', note: 'x'.repeat(501) }
            });
            expect(r.statusCode).toBe(400);
        } finally { await server.close(); }
    });

    it('rejects an unknown role with a generic message (no role echo)', async () => {
        const server = await buildServer({ userId: OWNER_ID, caps: ['admin'] });
        try {
            const r = await server.inject({
                method: 'POST',
                url: '/api/admin/users',
                payload: { userId: ADMIN_USER_ID, role: 'does-not-exist' }
            });
            expect(r.statusCode).toBe(400);
            // M4 generalised error messages — must not echo the input back.
            expect(r.json().error).toBe('unknown role');
        } finally { await server.close(); }
    });

    it('refuses to add the owner to the allow-list', async () => {
        const server = await buildServer({ userId: OWNER_ID, caps: ['admin'] });
        try {
            const r = await server.inject({
                method: 'POST',
                url: '/api/admin/users',
                payload: { userId: OWNER_ID, role: 'admin' }
            });
            expect(r.statusCode).toBe(400);
            // M4: error doesn't reveal that "owner" is the reason.
            expect(r.json().error).not.toMatch(/owner/i);
        } finally { await server.close(); }
    });

    it('refuses to move yourself to a role without the admin capability (self-lockout)', async () => {
        await createAdminRole('mod');
        await grantRoleCapability('mod', 'dm.message');
        await addAuthorizedUser(ADMIN_USER_ID, 'admin');
        const server = await buildServer({ userId: ADMIN_USER_ID, caps: ['admin'] });
        try {
            const r = await server.inject({
                method: 'POST',
                url: '/api/admin/users',
                payload: { userId: ADMIN_USER_ID, role: 'mod' }
            });
            expect(r.statusCode).toBe(400);
            expect(r.json().error).toMatch(/admin capability/);
        } finally { await server.close(); }
    });

    it('allows the owner to add a regular user', async () => {
        const server = await buildServer({ userId: OWNER_ID, caps: ['admin'] });
        try {
            const r = await server.inject({
                method: 'POST',
                url: '/api/admin/users',
                payload: { userId: ADMIN_USER_ID, role: 'admin', note: 'first admin' }
            });
            expect(r.statusCode).toBe(200);
            const body = r.json();
            expect(body.userId).toBe(ADMIN_USER_ID);
            expect(body.role).toBe('admin');
            expect(body.note).toBe('first admin');
        } finally { await server.close(); }
    });
});

describe('DELETE /api/admin/users/:userId', () => {
    it('refuses to remove the owner from the allow-list', async () => {
        // Owner can't be removed because they're never on the list,
        // but they also can't remove themselves via this endpoint.
        const server = await buildServer({ userId: ADMIN_USER_ID, caps: ['admin'] });
        try {
            await addAuthorizedUser(ADMIN_USER_ID, 'admin');
            const r = await server.inject({
                method: 'DELETE',
                url: `/api/admin/users/${ADMIN_USER_ID}`
            });
            expect(r.statusCode).toBe(400);
            expect(r.json().error).toMatch(/yourself/);
        } finally { await server.close(); }
    });

    it('rejects a non-snowflake target', async () => {
        const server = await buildServer({ userId: OWNER_ID, caps: ['admin'] });
        try {
            const r = await server.inject({
                method: 'DELETE',
                url: '/api/admin/users/not-a-snowflake'
            });
            expect(r.statusCode).toBe(400);
        } finally { await server.close(); }
    });

    it('returns 404 when removing a user not on the list', async () => {
        const server = await buildServer({ userId: OWNER_ID, caps: ['admin'] });
        try {
            const r = await server.inject({
                method: 'DELETE',
                url: `/api/admin/users/${SECOND_USER_ID}`
            });
            expect(r.statusCode).toBe(404);
        } finally { await server.close(); }
    });

    it('owner can remove a normal user', async () => {
        await addAuthorizedUser(SECOND_USER_ID, 'admin');
        const server = await buildServer({ userId: OWNER_ID, caps: ['admin'] });
        try {
            const r = await server.inject({
                method: 'DELETE',
                url: `/api/admin/users/${SECOND_USER_ID}`
            });
            expect(r.statusCode).toBe(204);
        } finally { await server.close(); }
    });
});

describe('roles endpoints', () => {
    it('rejects role create with missing name', async () => {
        const server = await buildServer({ userId: OWNER_ID, caps: ['admin'] });
        try {
            const r = await server.inject({
                method: 'POST',
                url: '/api/admin/roles',
                payload: { description: 'no name' }
            });
            expect(r.statusCode).toBe(400);
        } finally { await server.close(); }
    });

    it('rejects role description over the configured max', async () => {
        const server = await buildServer({ userId: OWNER_ID, caps: ['admin'] });
        try {
            const r = await server.inject({
                method: 'POST',
                url: '/api/admin/roles',
                payload: { name: 'big', description: 'x'.repeat(501) }
            });
            expect(r.statusCode).toBe(400);
        } finally { await server.close(); }
    });

    it('PATCH 404s on unknown role (does not silently create)', async () => {
        const server = await buildServer({ userId: OWNER_ID, caps: ['admin'] });
        try {
            const r = await server.inject({
                method: 'PATCH',
                url: '/api/admin/roles/ghost',
                payload: { description: 'never created' }
            });
            expect(r.statusCode).toBe(404);
        } finally { await server.close(); }
    });

    it('DELETE refuses to drop the role you\'re currently using', async () => {
        await addAuthorizedUser(ADMIN_USER_ID, 'admin');
        const server = await buildServer({ userId: ADMIN_USER_ID, caps: ['admin'] });
        try {
            const r = await server.inject({
                method: 'DELETE',
                url: '/api/admin/roles/admin'
            });
            expect(r.statusCode).toBe(400);
            expect(r.json().error).toMatch(/role you are currently using/);
        } finally { await server.close(); }
    });

    it('DELETE 404s on a missing role', async () => {
        const server = await buildServer({ userId: OWNER_ID, caps: ['admin'] });
        try {
            const r = await server.inject({
                method: 'DELETE',
                url: '/api/admin/roles/never-existed'
            });
            expect(r.statusCode).toBe(404);
        } finally { await server.close(); }
    });
});

describe('role capability grants', () => {
    it('rejects an unknown capability token', async () => {
        await createAdminRole('mod');
        const server = await buildServer({ userId: OWNER_ID, caps: ['admin'] });
        try {
            const r = await server.inject({
                method: 'POST',
                url: '/api/admin/roles/mod/capabilities',
                payload: { capability: 'made.up' }
            });
            expect(r.statusCode).toBe(400);
        } finally { await server.close(); }
    });

    it('404s when the role doesn\'t exist', async () => {
        const server = await buildServer({ userId: OWNER_ID, caps: ['admin'] });
        try {
            const r = await server.inject({
                method: 'POST',
                url: '/api/admin/roles/ghost/capabilities',
                payload: { capability: 'dm.message' }
            });
            expect(r.statusCode).toBe(404);
        } finally { await server.close(); }
    });

    it('refuses to revoke "admin" from the role you\'re currently using', async () => {
        await addAuthorizedUser(ADMIN_USER_ID, 'admin');
        const server = await buildServer({ userId: ADMIN_USER_ID, caps: ['admin'] });
        try {
            const r = await server.inject({
                method: 'DELETE',
                url: '/api/admin/roles/admin/capabilities/admin'
            });
            expect(r.statusCode).toBe(400);
            expect(r.json().error).toMatch(/cannot revoke admin/);
        } finally { await server.close(); }
    });

    it('grant then revoke leaves the catalog row gone', async () => {
        await createAdminRole('mod');
        const server = await buildServer({ userId: OWNER_ID, caps: ['admin'] });
        try {
            const grant = await server.inject({
                method: 'POST',
                url: '/api/admin/roles/mod/capabilities',
                payload: { capability: 'dm.message' }
            });
            expect(grant.statusCode).toBe(204);
            const revoke = await server.inject({
                method: 'DELETE',
                url: '/api/admin/roles/mod/capabilities/dm.message'
            });
            expect(revoke.statusCode).toBe(204);
        } finally { await server.close(); }
    });
});

describe('GET /api/admin/audit', () => {
    it('returns entries newest-first with id-cursor pagination', async () => {
        const server = await buildServer({ userId: OWNER_ID, caps: ['admin'] });
        try {
            // Create some audit entries via the user-management endpoint.
            await server.inject({
                method: 'POST',
                url: '/api/admin/users',
                payload: { userId: ADMIN_USER_ID, role: 'admin', note: 'first' }
            });
            await server.inject({
                method: 'POST',
                url: '/api/admin/users',
                payload: { userId: SECOND_USER_ID, role: 'admin', note: 'second' }
            });
            const r = await server.inject({ method: 'GET', url: '/api/admin/audit?limit=10' });
            expect(r.statusCode).toBe(200);
            const entries = r.json().entries as Array<{ id: number; action: string }>;
            // Two user.create entries, newest first.
            expect(entries).toHaveLength(2);
            expect(entries[0].id).toBeGreaterThan(entries[1].id);
            // Page back via the older cursor.
            const older = await server.inject({
                method: 'GET',
                url: `/api/admin/audit?before=${entries[0].id}&limit=10`
            });
            expect(older.json().entries).toHaveLength(1);
            expect((older.json().entries as { id: number }[])[0].id).toBe(entries[1].id);
        } finally { await server.close(); }
    });

    it('refuses without admin capability', async () => {
        const server = await buildServer({ userId: ADMIN_USER_ID, caps: ['dm.message'] });
        try {
            const r = await server.inject({ method: 'GET', url: '/api/admin/audit' });
            expect(r.statusCode).toBe(403);
        } finally { await server.close(); }
    });
});
