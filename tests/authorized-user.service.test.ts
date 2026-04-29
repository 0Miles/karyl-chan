import { vi, describe, it, expect, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';

vi.hoisted(() => {
    process.env.SQLITE_DB_PATH = ':memory:';
});

import { sequelize } from '../src/db.js';
import {
    addAuthorizedUser,
    auditStoredCapabilities,
    createAdminRole,
    deleteAdminRole,
    findAuthorizedUser,
    grantRoleCapability,
    invalidateCapabilityCache,
    listAdminRoles,
    listAuthorizedUsers,
    removeAuthorizedUser,
    resolveLoginRole,
    resolveUserCapabilities,
    revokeRoleCapability,
    seedDefaultRoles,
    type AdminCapability
} from '../src/modules/admin/authorized-user.service.js';
import { AdminRoleCapability } from '../src/modules/admin/models/admin-role-capability.model.js';

const OWNER_ID = '999999999999999999';

beforeAll(async () => {
    await sequelize.sync({ force: true });
});

beforeEach(async () => {
    await sequelize.sync({ force: true });
    invalidateCapabilityCache();
});

afterEach(() => {
    invalidateCapabilityCache();
});

afterAll(async () => {
    await sequelize.close();
});

describe('seedDefaultRoles', () => {
    it('creates the default admin role with the admin capability', async () => {
        await seedDefaultRoles();
        const roles = await listAdminRoles();
        expect(roles).toHaveLength(1);
        expect(roles[0].name).toBe('admin');
        expect(roles[0].capabilities).toContain('admin');
    });

    it('is idempotent — re-running does not duplicate roles or grants', async () => {
        await seedDefaultRoles();
        await seedDefaultRoles();
        const roles = await listAdminRoles();
        expect(roles).toHaveLength(1);
        const grants = await AdminRoleCapability.findAll();
        expect(grants).toHaveLength(1);
    });
});

describe('resolveUserCapabilities', () => {
    it('bypasses for the owner — single `admin` token (which short-circuits every check), no DB hit needed', async () => {
        const caps = await resolveUserCapabilities(OWNER_ID, OWNER_ID);
        // Owner carries just the bypass token. Per-guild scoped tokens
        // can't be enumerated up-front, so listing every global token
        // here would still leave gaps — `admin` is the only honest
        // representation of "passes every check".
        expect(caps.has('admin' as AdminCapability)).toBe(true);
        expect(caps.size).toBe(1);
    });

    it('returns empty for an unknown user', async () => {
        const caps = await resolveUserCapabilities('unknown-id', OWNER_ID);
        expect(caps.size).toBe(0);
    });

    it('resolves a user via their assigned role', async () => {
        await createAdminRole('mod');
        await grantRoleCapability('mod', 'dm.message');
        await addAuthorizedUser('111111111111111111', 'mod');
        const caps = await resolveUserCapabilities('111111111111111111', OWNER_ID);
        expect(caps.has('dm.message' as AdminCapability)).toBe(true);
        expect(caps.has('admin' as AdminCapability)).toBe(false);
    });

    it('user assigned to a role with no capabilities resolves to empty set', async () => {
        await createAdminRole('empty');
        await addAuthorizedUser('222222222222222222', 'empty');
        const caps = await resolveUserCapabilities('222222222222222222', OWNER_ID);
        expect(caps.size).toBe(0);
    });

    it('caches results — second call within TTL does not re-hit the DB', async () => {
        await createAdminRole('mod');
        await grantRoleCapability('mod', 'dm.message');
        await addAuthorizedUser('333333333333333333', 'mod');
        // Warm the cache.
        await resolveUserCapabilities('333333333333333333', OWNER_ID);
        // Mutate the DB *directly* — grantRoleCapability would
        // invalidate the cache internally, which would defeat the
        // point of this test. Bypass via the model.
        await AdminRoleCapability.create({ role: 'mod', capability: 'guild.message' });
        // Second call within the TTL should still report the cached set
        // — proving the cache is what we read from, not the DB.
        const caps = await resolveUserCapabilities('333333333333333333', OWNER_ID);
        expect(caps.has('guild.message' as AdminCapability)).toBe(false);
    });

    it('invalidating the cache forces a re-read', async () => {
        await createAdminRole('mod');
        await grantRoleCapability('mod', 'dm.message');
        await addAuthorizedUser('333333333333333333', 'mod');
        await resolveUserCapabilities('333333333333333333', OWNER_ID);
        await AdminRoleCapability.create({ role: 'mod', capability: 'guild.message' });
        invalidateCapabilityCache('333333333333333333');
        const caps = await resolveUserCapabilities('333333333333333333', OWNER_ID);
        expect(caps.has('guild.message' as AdminCapability)).toBe(true);
    });

    it('global invalidate clears every entry', async () => {
        await createAdminRole('a');
        await grantRoleCapability('a', 'dm.message');
        await addAuthorizedUser('111111111111111111', 'a');
        await addAuthorizedUser('222222222222222222', 'a');
        await resolveUserCapabilities('111111111111111111', OWNER_ID);
        await resolveUserCapabilities('222222222222222222', OWNER_ID);
        await AdminRoleCapability.create({ role: 'a', capability: 'guild.message' });
        invalidateCapabilityCache();
        const a = await resolveUserCapabilities('111111111111111111', OWNER_ID);
        const b = await resolveUserCapabilities('222222222222222222', OWNER_ID);
        expect(a.has('guild.message' as AdminCapability)).toBe(true);
        expect(b.has('guild.message' as AdminCapability)).toBe(true);
    });
});

describe('resolveLoginRole', () => {
    it('returns "owner" for the owner', async () => {
        const role = await resolveLoginRole(OWNER_ID, OWNER_ID);
        expect(role).toBe('owner');
    });

    it('returns the assigned role name when the user has any capability', async () => {
        await createAdminRole('mod');
        await grantRoleCapability('mod', 'dm.message');
        await addAuthorizedUser('111111111111111111', 'mod');
        const role = await resolveLoginRole('111111111111111111', OWNER_ID);
        expect(role).toBe('mod');
    });

    it('returns null for a user whose role has no capabilities (effectively disabled)', async () => {
        await createAdminRole('empty');
        await addAuthorizedUser('222222222222222222', 'empty');
        const role = await resolveLoginRole('222222222222222222', OWNER_ID);
        expect(role).toBeNull();
    });

    it('returns null for an unknown user', async () => {
        const role = await resolveLoginRole('unknown', OWNER_ID);
        expect(role).toBeNull();
    });
});

describe('user CRUD', () => {
    it('addAuthorizedUser is upsert — re-adding overwrites role + note', async () => {
        await createAdminRole('a');
        await createAdminRole('b');
        await addAuthorizedUser('111111111111111111', 'a', 'first note');
        const updated = await addAuthorizedUser('111111111111111111', 'b', 'second note');
        expect(updated.role).toBe('b');
        expect(updated.note).toBe('second note');
        const list = await listAuthorizedUsers();
        expect(list).toHaveLength(1);
    });

    it('addAuthorizedUser invalidates that user\'s cache', async () => {
        await createAdminRole('a');
        await grantRoleCapability('a', 'dm.message');
        await addAuthorizedUser('111111111111111111', 'a');
        await resolveUserCapabilities('111111111111111111', OWNER_ID);
        await createAdminRole('b');
        await grantRoleCapability('b', 'guild.message');
        // Switch role — the cache for this user must be busted by the upsert.
        await addAuthorizedUser('111111111111111111', 'b');
        const caps = await resolveUserCapabilities('111111111111111111', OWNER_ID);
        expect(caps.has('guild.message' as AdminCapability)).toBe(true);
        expect(caps.has('dm.message' as AdminCapability)).toBe(false);
    });

    it('removeAuthorizedUser returns true on hit, false on miss', async () => {
        await createAdminRole('a');
        await addAuthorizedUser('111111111111111111', 'a');
        expect(await removeAuthorizedUser('111111111111111111')).toBe(true);
        expect(await removeAuthorizedUser('111111111111111111')).toBe(false);
    });

    it('findAuthorizedUser returns null for a non-listed id', async () => {
        expect(await findAuthorizedUser('111111111111111111')).toBeNull();
    });

    it('listAuthorizedUsers is sorted by userId ASC for stable rendering', async () => {
        await createAdminRole('a');
        await addAuthorizedUser('333333333333333333', 'a');
        await addAuthorizedUser('111111111111111111', 'a');
        await addAuthorizedUser('222222222222222222', 'a');
        const ids = (await listAuthorizedUsers()).map(u => u.userId);
        expect(ids).toEqual([
            '111111111111111111',
            '222222222222222222',
            '333333333333333333'
        ]);
    });
});

describe('role CRUD', () => {
    it('listAdminRoles aggregates capabilities per role in two queries', async () => {
        await createAdminRole('a');
        await createAdminRole('b');
        await grantRoleCapability('a', 'dm.message');
        await grantRoleCapability('a', 'guild.message');
        await grantRoleCapability('b', 'system.read');
        const roles = await listAdminRoles();
        const aRole = roles.find(r => r.name === 'a');
        const bRole = roles.find(r => r.name === 'b');
        expect(aRole?.capabilities.sort()).toEqual(['dm.message', 'guild.message']);
        expect(bRole?.capabilities).toEqual(['system.read']);
    });

    it('deleteAdminRole removes the role AND its capability rows', async () => {
        await createAdminRole('victim');
        await grantRoleCapability('victim', 'dm.message');
        await grantRoleCapability('victim', 'guild.manage');
        const removed = await deleteAdminRole('victim');
        expect(removed).toBe(true);
        const roles = await listAdminRoles();
        expect(roles.find(r => r.name === 'victim')).toBeUndefined();
        const orphaned = await AdminRoleCapability.findAll({ where: { role: 'victim' } });
        expect(orphaned).toEqual([]);
    });

    it('grantRoleCapability is idempotent — re-granting the same cap is a no-op', async () => {
        await createAdminRole('a');
        await grantRoleCapability('a', 'dm.message');
        await grantRoleCapability('a', 'dm.message');
        const grants = await AdminRoleCapability.findAll({ where: { role: 'a', capability: 'dm.message' } });
        expect(grants).toHaveLength(1);
    });

    it('revokeRoleCapability invalidates every cached user', async () => {
        await createAdminRole('a');
        await grantRoleCapability('a', 'dm.message');
        await grantRoleCapability('a', 'guild.message');
        await addAuthorizedUser('111111111111111111', 'a');
        // Warm the cache.
        const before = await resolveUserCapabilities('111111111111111111', OWNER_ID);
        expect(before.has('guild.message' as AdminCapability)).toBe(true);
        await revokeRoleCapability('a', 'guild.message');
        const after = await resolveUserCapabilities('111111111111111111', OWNER_ID);
        expect(after.has('guild.message' as AdminCapability)).toBe(false);
    });
});

describe('auditStoredCapabilities', () => {
    it('warns about unknown capability tokens hiding in the table', async () => {
        await createAdminRole('a');
        // Insert a bogus row directly (bypassing the validating
        // grantRoleCapability path) — simulating a renamed/removed
        // capability that left a stranded grant behind.
        await AdminRoleCapability.create({ role: 'a', capability: 'mystery.cap' });
        const warn = vi.fn();
        await auditStoredCapabilities({ warn });
        expect(warn).toHaveBeenCalledOnce();
        expect(String(warn.mock.calls[0][0])).toMatch(/mystery\.cap/);
    });

    it('stays quiet when every stored capability is recognised', async () => {
        await createAdminRole('a');
        await grantRoleCapability('a', 'dm.message');
        const warn = vi.fn();
        await auditStoredCapabilities({ warn });
        expect(warn).not.toHaveBeenCalled();
    });
});
