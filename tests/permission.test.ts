import { describe, expect, it } from 'vitest';
import { evaluateCapability } from '../src/permission/permission.service.js';

const guildId = 'G-1';

describe('evaluateCapability', () => {
    describe('owner / administrator bypass', () => {
        it('grants everything to owner/admin, even a deny-default capability', () => {
            expect(evaluateCapability({
                capability: 'rcon.execute',
                memberRoleIds: [],
                guildId,
                isOwnerOrAdmin: true,
                grantedRoleIds: new Set()
            })).toBe(true);
        });

        it('does not require any grants for owner/admin', () => {
            expect(evaluateCapability({
                capability: 'todo.manage',
                memberRoleIds: [],
                guildId,
                isOwnerOrAdmin: true,
                grantedRoleIds: new Set()
            })).toBe(true);
        });
    });

    describe('role-specific grants', () => {
        it('allows when a member role is in the grant set', () => {
            expect(evaluateCapability({
                capability: 'rcon.execute',
                memberRoleIds: ['R1'],
                guildId,
                isOwnerOrAdmin: false,
                grantedRoleIds: new Set(['R1'])
            })).toBe(true);
        });

        it('denies when no member role matches and default is deny', () => {
            expect(evaluateCapability({
                capability: 'rcon.execute',
                memberRoleIds: ['R2'],
                guildId,
                isOwnerOrAdmin: false,
                grantedRoleIds: new Set(['R1'])
            })).toBe(false);
        });

        it('allows if ANY of multiple member roles matches', () => {
            expect(evaluateCapability({
                capability: 'rcon.execute',
                memberRoleIds: ['R2', 'R3', 'R1'],
                guildId,
                isOwnerOrAdmin: false,
                grantedRoleIds: new Set(['R1'])
            })).toBe(true);
        });

        it('allows when exactly one role matches', () => {
            expect(evaluateCapability({
                capability: 'rcon.execute',
                memberRoleIds: ['R5'],
                guildId,
                isOwnerOrAdmin: false,
                grantedRoleIds: new Set(['R1', 'R3', 'R5', 'R9'])
            })).toBe(true);
        });
    });

    describe('@everyone grant', () => {
        it('applies when guildId (the @everyone role id) is granted', () => {
            expect(evaluateCapability({
                capability: 'rcon.execute',
                memberRoleIds: [],
                guildId,
                isOwnerOrAdmin: false,
                grantedRoleIds: new Set([guildId])
            })).toBe(true);
        });

        it('applies to a member with zero other roles', () => {
            expect(evaluateCapability({
                capability: 'rcon.execute',
                memberRoleIds: [guildId],
                guildId,
                isOwnerOrAdmin: false,
                grantedRoleIds: new Set([guildId])
            })).toBe(true);
        });
    });

    describe('fallback defaults (no grants for capability)', () => {
        it('falls back to allow for todo.manage', () => {
            expect(evaluateCapability({
                capability: 'todo.manage',
                memberRoleIds: ['R1'],
                guildId,
                isOwnerOrAdmin: false,
                grantedRoleIds: new Set()
            })).toBe(true);
        });

        it('falls back to allow for picture-only.manage', () => {
            expect(evaluateCapability({
                capability: 'picture-only.manage',
                memberRoleIds: [],
                guildId,
                isOwnerOrAdmin: false,
                grantedRoleIds: new Set()
            })).toBe(true);
        });

        it('falls back to allow for rcon.configure', () => {
            expect(evaluateCapability({
                capability: 'rcon.configure',
                memberRoleIds: [],
                guildId,
                isOwnerOrAdmin: false,
                grantedRoleIds: new Set()
            })).toBe(true);
        });

        it('falls back to allow for role-emoji.manage', () => {
            expect(evaluateCapability({
                capability: 'role-emoji.manage',
                memberRoleIds: [],
                guildId,
                isOwnerOrAdmin: false,
                grantedRoleIds: new Set()
            })).toBe(true);
        });

        it('falls back to deny for rcon.execute', () => {
            expect(evaluateCapability({
                capability: 'rcon.execute',
                memberRoleIds: ['R1', 'R2'],
                guildId,
                isOwnerOrAdmin: false,
                grantedRoleIds: new Set()
            })).toBe(false);
        });
    });

    describe('grant isolation', () => {
        it('grants for one capability do not leak to another', () => {
            // Caller only passes grants for the target capability anyway, but confirm
            // the function does not rely on any other state.
            expect(evaluateCapability({
                capability: 'rcon.execute',
                memberRoleIds: ['R1'],
                guildId,
                isOwnerOrAdmin: false,
                grantedRoleIds: new Set()
            })).toBe(false);
        });
    });

    describe('cross-guild safety', () => {
        it('treats @everyone of a different guild as a normal role (not auto-applied)', () => {
            const otherGuildId = 'G-2';
            expect(evaluateCapability({
                capability: 'rcon.execute',
                memberRoleIds: [],
                guildId,
                isOwnerOrAdmin: false,
                grantedRoleIds: new Set([otherGuildId])
            })).toBe(false);
        });
    });
});
