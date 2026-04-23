import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AuthStore } from '../src/web/auth-store.service.js';

describe('AuthStore', () => {
    let store: AuthStore;
    const OWNER = 'owner-id';

    beforeEach(() => { store = new AuthStore(); });
    afterEach(() => { store.stop(); });

    describe('one-time tokens', () => {
        it('issues a token that consumes once and returns the owner id', () => {
            const { token } = store.createOneTimeToken(OWNER);
            expect(store.consumeOneTimeToken(token)).toBe(OWNER);
            expect(store.consumeOneTimeToken(token)).toBeNull();
        });

        it('rejects unknown tokens', () => {
            expect(store.consumeOneTimeToken('does-not-exist')).toBeNull();
        });

        it('rejects expired tokens', () => {
            const now = Date.now();
            const { token } = store.createOneTimeToken(OWNER, now);
            expect(store.consumeOneTimeToken(token, now + 6 * 60 * 1000)).toBeNull();
        });
    });

    describe('access tokens', () => {
        it('verifies an issued access token and returns the owner id', () => {
            const { accessToken } = store.issueTokens(OWNER);
            expect(store.verifyAccessToken(accessToken)).toBe(OWNER);
        });

        it('rejects expired access tokens', () => {
            const now = Date.now();
            const { accessToken } = store.issueTokens(OWNER, now);
            expect(store.verifyAccessToken(accessToken, now + 16 * 60 * 1000)).toBeNull();
        });

        it('rejects unknown access tokens', () => {
            expect(store.verifyAccessToken('not-real')).toBeNull();
        });
    });

    describe('refresh tokens', () => {
        it('rotation issues new tokens and invalidates the old refresh', () => {
            const initial = store.issueTokens(OWNER);
            const next = store.rotateRefresh(initial.refreshToken);
            expect(next).not.toBeNull();
            expect(next!.refreshToken).not.toBe(initial.refreshToken);
            expect(store.rotateRefresh(initial.refreshToken)).toBeNull();
        });

        it('refuses an expired refresh', () => {
            const now = Date.now();
            const initial = store.issueTokens(OWNER, now);
            expect(store.rotateRefresh(initial.refreshToken, now + 8 * 24 * 60 * 60 * 1000)).toBeNull();
        });

        it('revokeRefresh prevents future rotation', () => {
            const initial = store.issueTokens(OWNER);
            expect(store.revokeRefresh(initial.refreshToken)).toBe(true);
            expect(store.rotateRefresh(initial.refreshToken)).toBeNull();
        });

        it('revokeOwner clears all access + refresh for that owner', () => {
            const issued = store.issueTokens(OWNER);
            const other = store.issueTokens('someone-else');
            store.revokeOwner(OWNER);
            expect(store.verifyAccessToken(issued.accessToken)).toBeNull();
            expect(store.rotateRefresh(issued.refreshToken)).toBeNull();
            expect(store.verifyAccessToken(other.accessToken)).toBe('someone-else');
        });
    });
});
