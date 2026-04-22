import { describe, expect, it } from 'vitest';
import { evaluateCapability } from '../src/permission/permission.service.js';
import { CAPABILITY_KEYS, EVERYONE_DEFAULTS } from '../src/permission/capabilities.js';

const guildId = 'G-1';

describe('evaluateCapability', () => {
    describe('owner / administrator bypass', () => {
        it('always allows, even when defaultAllow is false and no grants exist', () => {
            expect(evaluateCapability({
                memberRoleIds: [],
                guildId,
                isOwnerOrAdmin: true,
                grantedRoleIds: new Set(),
                defaultAllow: false
            })).toBe(true);
        });

        it('allows even when grants exist and member is not in any granted role', () => {
            expect(evaluateCapability({
                memberRoleIds: ['unrelated'],
                guildId,
                isOwnerOrAdmin: true,
                grantedRoleIds: new Set(['ops']),
                defaultAllow: false
            })).toBe(true);
        });
    });

    describe('no grants: fallback to defaultAllow', () => {
        it('allows when defaultAllow is true and grants are empty', () => {
            expect(evaluateCapability({
                memberRoleIds: ['R1', 'R2'],
                guildId,
                isOwnerOrAdmin: false,
                grantedRoleIds: new Set(),
                defaultAllow: true
            })).toBe(true);
        });

        it('denies when defaultAllow is false and grants are empty', () => {
            expect(evaluateCapability({
                memberRoleIds: ['R1', 'R2'],
                guildId,
                isOwnerOrAdmin: false,
                grantedRoleIds: new Set(),
                defaultAllow: false
            })).toBe(false);
        });

        it('allows a member with zero roles when defaultAllow is true', () => {
            expect(evaluateCapability({
                memberRoleIds: [],
                guildId,
                isOwnerOrAdmin: false,
                grantedRoleIds: new Set(),
                defaultAllow: true
            })).toBe(true);
        });
    });

    describe('whitelist mode (grants present)', () => {
        it('allows when a member role matches a grant', () => {
            expect(evaluateCapability({
                memberRoleIds: ['ops'],
                guildId,
                isOwnerOrAdmin: false,
                grantedRoleIds: new Set(['ops']),
                defaultAllow: true
            })).toBe(true);
        });

        it('denies a non-granted member even though defaultAllow is true', () => {
            // This is the key "tightening" behavior: admin has added ANY grant,
            // so defaultAllow no longer applies to non-granted members.
            expect(evaluateCapability({
                memberRoleIds: ['other'],
                guildId,
                isOwnerOrAdmin: false,
                grantedRoleIds: new Set(['ops']),
                defaultAllow: true
            })).toBe(false);
        });

        it('allows if ANY of multiple member roles matches', () => {
            expect(evaluateCapability({
                memberRoleIds: ['member', 'ops', 'vip'],
                guildId,
                isOwnerOrAdmin: false,
                grantedRoleIds: new Set(['ops']),
                defaultAllow: true
            })).toBe(true);
        });

        it('allows when a single member role matches one of many granted roles', () => {
            expect(evaluateCapability({
                memberRoleIds: ['mods'],
                guildId,
                isOwnerOrAdmin: false,
                grantedRoleIds: new Set(['ops', 'mods', 'admins']),
                defaultAllow: true
            })).toBe(true);
        });

        it('denies a member with zero roles when grants exist', () => {
            expect(evaluateCapability({
                memberRoleIds: [],
                guildId,
                isOwnerOrAdmin: false,
                grantedRoleIds: new Set(['ops']),
                defaultAllow: true
            })).toBe(false);
        });
    });

    describe('@everyone grant (roleId === guildId)', () => {
        it('allows everyone in the guild when @everyone is granted', () => {
            expect(evaluateCapability({
                memberRoleIds: [],
                guildId,
                isOwnerOrAdmin: false,
                grantedRoleIds: new Set([guildId]),
                defaultAllow: false
            })).toBe(true);
        });

        it('cancels out whitelist tightening when combined with other grants', () => {
            // @everyone + ops → everyone passes (via @everyone); ops is redundant
            expect(evaluateCapability({
                memberRoleIds: ['other'],
                guildId,
                isOwnerOrAdmin: false,
                grantedRoleIds: new Set([guildId, 'ops']),
                defaultAllow: false
            })).toBe(true);
        });
    });

    describe('cross-guild safety', () => {
        it('a different guild id in the grant set is not treated as @everyone', () => {
            const otherGuildId = 'G-2';
            expect(evaluateCapability({
                memberRoleIds: [],
                guildId,
                isOwnerOrAdmin: false,
                grantedRoleIds: new Set([otherGuildId]),
                defaultAllow: true
            })).toBe(false);
        });
    });
});

describe('EVERYONE_DEFAULTS', () => {
    it('defines a default for every capability', () => {
        for (const cap of CAPABILITY_KEYS) {
            expect(EVERYONE_DEFAULTS).toHaveProperty(cap);
            expect(typeof EVERYONE_DEFAULTS[cap]).toBe('boolean');
        }
    });

    it('all capabilities default to allow (Discord filter is the first gate)', () => {
        for (const cap of CAPABILITY_KEYS) {
            expect(EVERYONE_DEFAULTS[cap]).toBe(true);
        }
    });
});
