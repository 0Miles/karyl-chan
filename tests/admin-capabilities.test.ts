import { describe, expect, it } from 'vitest';
import {
    accessibleGuildIds,
    hasAdminCapability,
    hasGuildCapability,
    isAdminCapability,
    GLOBAL_CAPABILITY_KEYS,
    makeGuildScopedCapability
} from '../src/modules/admin/admin-capabilities.js';

describe('admin capabilities', () => {
    describe('isAdminCapability', () => {
        it('returns true for global tokens', () => {
            for (const key of GLOBAL_CAPABILITY_KEYS) {
                expect(isAdminCapability(key)).toBe(true);
            }
        });

        it('returns true for per-guild scoped tokens', () => {
            expect(isAdminCapability('guild:1234.message')).toBe(true);
            expect(isAdminCapability('guild:1234.manage')).toBe(true);
        });

        it('returns false for unknown / malformed tokens', () => {
            expect(isAdminCapability('')).toBe(false);
            expect(isAdminCapability('not-a-real-capability')).toBe(false);
            expect(isAdminCapability('guild:1234.delete')).toBe(false);
            expect(isAdminCapability('guild:.message')).toBe(false);
            expect(isAdminCapability('dm.read')).toBe(false); // legacy token, retired
        });
    });

    describe('hasAdminCapability', () => {
        it('grants everything when the user has the admin token', () => {
            expect(hasAdminCapability(['admin'], 'system.read')).toBe(true);
            expect(hasAdminCapability(['admin'], 'guild.message')).toBe(true);
        });

        it('returns true when the required token is directly granted', () => {
            expect(hasAdminCapability(['system.read'], 'system.read')).toBe(true);
            expect(hasAdminCapability(['dm.message'], 'dm.message')).toBe(true);
        });

        it('returns false when neither admin nor the required token is present', () => {
            expect(hasAdminCapability([] as never, 'system.read')).toBe(false);
            expect(hasAdminCapability(['dm.message'], 'system.read')).toBe(false);
        });

        it('accepts a Set as input', () => {
            expect(hasAdminCapability(new Set(['admin']), 'guild.manage')).toBe(true);
        });
    });

    describe('hasGuildCapability', () => {
        const GUILD = 'guild-123';

        it('admin token satisfies any guild scope', () => {
            expect(hasGuildCapability(['admin'], GUILD, 'message')).toBe(true);
            expect(hasGuildCapability(['admin'], GUILD, 'manage')).toBe(true);
        });

        it('global guild token satisfies its scope across all guilds', () => {
            expect(hasGuildCapability(['guild.message'], GUILD, 'message')).toBe(true);
            expect(hasGuildCapability(['guild.message'], 'other-guild', 'message')).toBe(true);
            // Doesn't satisfy the other scope.
            expect(hasGuildCapability(['guild.message'], GUILD, 'manage')).toBe(false);
        });

        it('per-guild scoped token satisfies only that guild + scope', () => {
            const tok = makeGuildScopedCapability(GUILD, 'manage');
            expect(hasGuildCapability([tok], GUILD, 'manage')).toBe(true);
            expect(hasGuildCapability([tok], GUILD, 'message')).toBe(false);
            expect(hasGuildCapability([tok], 'other-guild', 'manage')).toBe(false);
        });

        it('returns false when no relevant token is granted', () => {
            expect(hasGuildCapability(['system.read'], GUILD, 'message')).toBe(false);
            expect(hasGuildCapability([], GUILD, 'manage')).toBe(false);
        });
    });

    describe('accessibleGuildIds', () => {
        it('returns "all" for admin', () => {
            expect(accessibleGuildIds(['admin'])).toBe('all');
        });

        it('returns "all" for any global guild token', () => {
            expect(accessibleGuildIds(['guild.message'])).toBe('all');
            expect(accessibleGuildIds(['guild.manage'])).toBe('all');
        });

        it('returns the explicit set of guild ids for per-guild grants', () => {
            const result = accessibleGuildIds([
                makeGuildScopedCapability('1', 'message'),
                makeGuildScopedCapability('2', 'manage'),
                'system.read'
            ]);
            expect(result).toEqual(new Set(['1', '2']));
        });

        it('returns an empty set for callers with no guild grants', () => {
            const result = accessibleGuildIds(['system.read', 'dm.message']);
            expect(result).toEqual(new Set());
        });
    });
});
