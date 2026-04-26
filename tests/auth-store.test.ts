import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthStore, type RefreshStoreAdapter } from '../src/web/auth-store.service.js';

describe('AuthStore', () => {
    let store: AuthStore;
    const OWNER = 'owner-id';

    beforeEach(() => { store = new AuthStore(); });
    afterEach(() => { store.stop(); });

    describe('access tokens', () => {
        it('verifies an issued access token and returns the owner id', async () => {
            const { accessToken } = await store.issueTokens(OWNER);
            expect(store.verifyAccessToken(accessToken)).toBe(OWNER);
        });

        it('rejects expired access tokens', async () => {
            const now = Date.now();
            const { accessToken } = await store.issueTokens(OWNER, now);
            expect(store.verifyAccessToken(accessToken, now + 16 * 60 * 1000)).toBeNull();
        });

        it('rejects unknown access tokens', () => {
            expect(store.verifyAccessToken('not-real')).toBeNull();
        });
    });

    describe('refresh tokens', () => {
        it('rotation issues new tokens and invalidates the old refresh', async () => {
            const initial = await store.issueTokens(OWNER);
            const next = await store.rotateRefresh(initial.refreshToken);
            expect(next).not.toBeNull();
            expect(next!.refreshToken).not.toBe(initial.refreshToken);
            expect(await store.rotateRefresh(initial.refreshToken)).toBeNull();
        });

        it('refuses an expired refresh', async () => {
            const now = Date.now();
            const initial = await store.issueTokens(OWNER, now);
            expect(await store.rotateRefresh(initial.refreshToken, now + 8 * 24 * 60 * 60 * 1000)).toBeNull();
        });

        it('revokeRefresh prevents future rotation', async () => {
            const initial = await store.issueTokens(OWNER);
            expect(await store.revokeRefresh(initial.refreshToken)).toBe(true);
            expect(await store.rotateRefresh(initial.refreshToken)).toBeNull();
        });

        it('revokeOwner clears all access + refresh for that owner', async () => {
            const issued = await store.issueTokens(OWNER);
            const other = await store.issueTokens('someone-else');
            await store.revokeOwner(OWNER);
            expect(store.verifyAccessToken(issued.accessToken)).toBeNull();
            expect(await store.rotateRefresh(issued.refreshToken)).toBeNull();
            expect(store.verifyAccessToken(other.accessToken)).toBe('someone-else');
        });
    });

    describe('persistence via RefreshStoreAdapter', () => {
        function makeAdapter(): RefreshStoreAdapter & { records: Map<string, { ownerId: string; expiresAt: number }> } {
            const records = new Map<string, { ownerId: string; expiresAt: number }>();
            return {
                records,
                load: vi.fn(async () => [...records.entries()].map(([hash, r]) => ({ hash, ...r }))),
                put: vi.fn(async ({ hash, ownerId, expiresAt }) => { records.set(hash, { ownerId, expiresAt }); }),
                delete: vi.fn(async (hash: string) => { records.delete(hash); }),
                deleteByOwner: vi.fn(async (ownerId: string) => {
                    for (const [k, v] of records) if (v.ownerId === ownerId) records.delete(k);
                }),
                deleteExpired: vi.fn(async (now: number) => {
                    for (const [k, v] of records) if (v.expiresAt <= now) records.delete(k);
                })
            };
        }

        it('issueTokens writes the refresh token through the adapter', async () => {
            const adapter = makeAdapter();
            const persisted = new AuthStore({ refreshStore: adapter });
            const issued = await persisted.issueTokens(OWNER);
            expect(adapter.put).toHaveBeenCalledTimes(1);
            expect(adapter.records.size).toBe(1);
            expect([...adapter.records.values()][0].ownerId).toBe(OWNER);
            expect([...adapter.records.values()][0].expiresAt).toBe(issued.refreshExpiresAt);
            persisted.stop();
        });

        it('init reloads refresh tokens from the adapter so a restart keeps sessions alive', async () => {
            const adapter = makeAdapter();
            const first = new AuthStore({ refreshStore: adapter });
            const issued = await first.issueTokens(OWNER);
            first.stop();

            const second = new AuthStore({ refreshStore: adapter });
            await second.init();
            const rotated = await second.rotateRefresh(issued.refreshToken);
            expect(rotated).not.toBeNull();
            expect(rotated!.refreshToken).not.toBe(issued.refreshToken);
            second.stop();
        });

        it('init drops refresh records that have already expired', async () => {
            const adapter = makeAdapter();
            adapter.records.set('expired-hash', { ownerId: OWNER, expiresAt: Date.now() - 1000 });
            const reloaded = new AuthStore({ refreshStore: adapter });
            await reloaded.init();
            expect(adapter.delete).toHaveBeenCalledWith('expired-hash');
            reloaded.stop();
        });

        it('rotateRefresh removes the old hash from the adapter', async () => {
            const adapter = makeAdapter();
            const persisted = new AuthStore({ refreshStore: adapter });
            const issued = await persisted.issueTokens(OWNER);
            await persisted.rotateRefresh(issued.refreshToken);
            // Old hash gone, new hash present.
            expect(adapter.records.size).toBe(1);
            persisted.stop();
        });

        it('revokeRefresh removes via the adapter', async () => {
            const adapter = makeAdapter();
            const persisted = new AuthStore({ refreshStore: adapter });
            const issued = await persisted.issueTokens(OWNER);
            await persisted.revokeRefresh(issued.refreshToken);
            expect(adapter.records.size).toBe(0);
            persisted.stop();
        });

        it('revokeOwner clears every hash for that owner via the adapter', async () => {
            const adapter = makeAdapter();
            const persisted = new AuthStore({ refreshStore: adapter });
            await persisted.issueTokens(OWNER);
            await persisted.issueTokens(OWNER);
            await persisted.issueTokens('someone-else');
            await persisted.revokeOwner(OWNER);
            expect(adapter.deleteByOwner).toHaveBeenCalledWith(OWNER);
            expect([...adapter.records.values()].every(r => r.ownerId === 'someone-else')).toBe(true);
            persisted.stop();
        });
    });
});
