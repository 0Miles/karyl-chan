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

        it('short-circuits before any grant lookup', () => {
            expect(evaluateCapability({
                memberRoleIds: [],
                guildId,
                isOwnerOrAdmin: true,
                grantedRoleIds: new Set(['unrelated']),
                defaultAllow: false
            })).toBe(true);
        });
    });

    describe('role-specific grants', () => {
        it('allows when a member role is in the grant set', () => {
            expect(evaluateCapability({
                memberRoleIds: ['R1'],
                guildId,
                isOwnerOrAdmin: false,
                grantedRoleIds: new Set(['R1']),
                defaultAllow: false
            })).toBe(true);
        });

        it('denies when no member role matches and defaultAllow is false', () => {
            expect(evaluateCapability({
                memberRoleIds: ['R2'],
                guildId,
                isOwnerOrAdmin: false,
                grantedRoleIds: new Set(['R1']),
                defaultAllow: false
            })).toBe(false);
        });

        it('allows if ANY of multiple member roles matches', () => {
            expect(evaluateCapability({
                memberRoleIds: ['R2', 'R3', 'R1'],
                guildId,
                isOwnerOrAdmin: false,
                grantedRoleIds: new Set(['R1']),
                defaultAllow: false
            })).toBe(true);
        });

        it('allows when a single member role matches one of many grants', () => {
            expect(evaluateCapability({
                memberRoleIds: ['R5'],
                guildId,
                isOwnerOrAdmin: false,
                grantedRoleIds: new Set(['R1', 'R3', 'R5', 'R9']),
                defaultAllow: false
            })).toBe(true);
        });
    });

    describe('@everyone grant (roleId === guildId)', () => {
        it('allows when guildId is in the grant set', () => {
            expect(evaluateCapability({
                memberRoleIds: [],
                guildId,
                isOwnerOrAdmin: false,
                grantedRoleIds: new Set([guildId]),
                defaultAllow: false
            })).toBe(true);
        });

        it('applies even to a member with no other roles', () => {
            expect(evaluateCapability({
                memberRoleIds: [guildId],
                guildId,
                isOwnerOrAdmin: false,
                grantedRoleIds: new Set([guildId]),
                defaultAllow: false
            })).toBe(true);
        });
    });

    describe('defaultAllow fallback', () => {
        it('returns true when no grant matches and defaultAllow is true', () => {
            expect(evaluateCapability({
                memberRoleIds: ['R1'],
                guildId,
                isOwnerOrAdmin: false,
                grantedRoleIds: new Set(),
                defaultAllow: true
            })).toBe(true);
        });

        it('returns false when no grant matches and defaultAllow is false', () => {
            expect(evaluateCapability({
                memberRoleIds: ['R1'],
                guildId,
                isOwnerOrAdmin: false,
                grantedRoleIds: new Set(),
                defaultAllow: false
            })).toBe(false);
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
                defaultAllow: false
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

    it('management capabilities default to deny', () => {
        expect(EVERYONE_DEFAULTS['todo.manage']).toBe(false);
        expect(EVERYONE_DEFAULTS['picture-only.manage']).toBe(false);
        expect(EVERYONE_DEFAULTS['rcon.configure']).toBe(false);
        expect(EVERYONE_DEFAULTS['role-emoji.manage']).toBe(false);
    });

    it('rcon.execute defaults to allow (channel post permission is the gate)', () => {
        expect(EVERYONE_DEFAULTS['rcon.execute']).toBe(true);
    });
});
