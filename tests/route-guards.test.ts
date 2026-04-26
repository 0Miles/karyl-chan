import { describe, it, expect, vi } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AdminCapability } from '../src/web/authorized-user.service.js';
import { requireAnyCapability, requireCapability } from '../src/web/route-guards.js';

/**
 * Tiny fake reply object — only the surface that route-guards touches
 * (.code, .send) is needed. We assert on the call args of those
 * stubs to confirm the 403 contract.
 */
function fakeReply() {
    const send = vi.fn();
    const code = vi.fn(() => ({ send }));
    return {
        reply: { code } as unknown as FastifyReply,
        send,
        code
    };
}

function fakeRequest(caps: AdminCapability[] | undefined): FastifyRequest {
    // The hook normally populates authCapabilities; here we plug it
    // straight in as a Set, matching what server.ts produces.
    return {
        authCapabilities: caps ? new Set(caps) : undefined
    } as unknown as FastifyRequest;
}

describe('requireCapability', () => {
    it('allows when the user has the exact capability', () => {
        const { reply, code } = fakeReply();
        expect(requireCapability(fakeRequest(['dm.message']), reply, 'dm.message')).toBe(true);
        expect(code).not.toHaveBeenCalled();
    });

    it('allows when the user has the wildcard "admin" capability', () => {
        const { reply, code } = fakeReply();
        // The whole point of the admin token: it bypasses every other
        // check, mirroring hasAdminCapability semantics.
        expect(requireCapability(fakeRequest(['admin']), reply, 'dm.message')).toBe(true);
        expect(code).not.toHaveBeenCalled();
    });

    it('denies and replies 403 when the capability is missing', () => {
        const { reply, code, send } = fakeReply();
        expect(requireCapability(fakeRequest(['dm.message']), reply, 'guild.manage')).toBe(false);
        expect(code).toHaveBeenCalledWith(403);
        expect(send).toHaveBeenCalledWith({ error: 'guild.manage capability required' });
    });

    it('denies when authCapabilities is undefined (the hook never ran)', () => {
        const { reply, code } = fakeReply();
        expect(requireCapability(fakeRequest(undefined), reply, 'dm.message')).toBe(false);
        expect(code).toHaveBeenCalledWith(403);
    });

    it('denies when authCapabilities is empty', () => {
        const { reply, code } = fakeReply();
        expect(requireCapability(fakeRequest([]), reply, 'dm.message')).toBe(false);
        expect(code).toHaveBeenCalledWith(403);
    });

    it('does not leak the user\'s actual capability set in the error message', () => {
        const { reply, send } = fakeReply();
        requireCapability(fakeRequest(['dm.message', 'system.read']), reply, 'guild.manage');
        const errorBody = send.mock.calls[0][0] as { error: string };
        expect(errorBody.error).toBe('guild.manage capability required');
        // No mention of dm.message / system.read; the response only ever
        // names the missing required capability.
        expect(errorBody.error).not.toMatch(/dm\.read|system\.read/);
    });
});

describe('requireAnyCapability', () => {
    it('allows when the user has any of the listed capabilities', () => {
        const { reply, code } = fakeReply();
        expect(
            requireAnyCapability(fakeRequest(['guild.message']), reply, ['dm.message', 'guild.message'])
        ).toBe(true);
        expect(code).not.toHaveBeenCalled();
    });

    it('admin bypasses even when none of the listed capabilities are held literally', () => {
        const { reply, code } = fakeReply();
        expect(
            requireAnyCapability(fakeRequest(['admin']), reply, ['dm.message', 'guild.message'])
        ).toBe(true);
        expect(code).not.toHaveBeenCalled();
    });

    it('denies when none of the listed capabilities are held', () => {
        const { reply, code, send } = fakeReply();
        expect(
            requireAnyCapability(fakeRequest(['system.read']), reply, ['dm.message', 'guild.message'])
        ).toBe(false);
        expect(code).toHaveBeenCalledWith(403);
        expect(send).toHaveBeenCalled();
        const body = send.mock.calls[0][0] as { error: string };
        // Surfaces the full list so the operator learns what would unblock
        // them — only acceptable because the route surface is admin-only.
        expect(body.error).toContain('dm.message');
        expect(body.error).toContain('guild.message');
    });

    it('denies when authCapabilities is undefined', () => {
        const { reply, code } = fakeReply();
        expect(
            requireAnyCapability(fakeRequest(undefined), reply, ['dm.message'])
        ).toBe(false);
        expect(code).toHaveBeenCalledWith(403);
    });

    it('denies when the accepted list is empty (defensive)', () => {
        const { reply, code } = fakeReply();
        // An empty acceptable-list would otherwise admit nobody who
        // isn't `admin`. Ensures we don't accidentally treat that as
        // "anything goes".
        expect(
            requireAnyCapability(fakeRequest(['dm.message']), reply, [])
        ).toBe(false);
        expect(code).toHaveBeenCalledWith(403);
    });
});
