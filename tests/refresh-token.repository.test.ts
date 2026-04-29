import { vi, describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';

vi.hoisted(() => {
    process.env.SQLITE_DB_PATH = ':memory:';
});

import { sequelize } from '../src/db.js';
import { RefreshToken } from '../src/modules/web-core/models/refresh-token.model.js';
import { sequelizeRefreshStore } from '../src/modules/web-core/refresh-token.repository.js';

beforeAll(async () => {
    await sequelize.sync({ force: true });
});

beforeEach(async () => {
    await sequelize.sync({ force: true });
});

afterAll(async () => {
    await sequelize.close();
});

describe('sequelizeRefreshStore', () => {
    const future = Date.now() + 7 * 24 * 60 * 60 * 1000;
    const sample = (overrides: Partial<{ hash: string; ownerId: string; expiresAt: number }> = {}) => ({
        hash: 'h-1',
        ownerId: 'owner-a',
        expiresAt: future,
        ...overrides
    });

    it('round-trips a record through put + load', async () => {
        await sequelizeRefreshStore.put(sample());
        const records = await sequelizeRefreshStore.load();
        expect(records).toHaveLength(1);
        expect(records[0].hash).toBe('h-1');
        expect(records[0].ownerId).toBe('owner-a');
        // BIGINT comes back as string from SQLite — the repo coerces
        // back to Number, so the value should be a JS number again.
        expect(records[0].expiresAt).toBe(future);
        expect(typeof records[0].expiresAt).toBe('number');
    });

    it('put is idempotent on the hash primary key (upsert behaviour)', async () => {
        await sequelizeRefreshStore.put(sample({ ownerId: 'owner-a' }));
        // Same hash, different owner — upsert should keep one row but
        // overwrite the field. (In practice we never reuse hashes,
        // but the repo's contract is upsert-on-hash so we pin it.)
        await sequelizeRefreshStore.put(sample({ ownerId: 'owner-b' }));
        const records = await sequelizeRefreshStore.load();
        expect(records).toHaveLength(1);
        expect(records[0].ownerId).toBe('owner-b');
    });

    it('delete removes only the targeted row', async () => {
        await sequelizeRefreshStore.put(sample({ hash: 'h-1' }));
        await sequelizeRefreshStore.put(sample({ hash: 'h-2', ownerId: 'owner-b' }));
        await sequelizeRefreshStore.delete('h-1');
        const records = await sequelizeRefreshStore.load();
        expect(records.map(r => r.hash)).toEqual(['h-2']);
    });

    it('delete on a missing hash is a no-op', async () => {
        await sequelizeRefreshStore.put(sample());
        await sequelizeRefreshStore.delete('does-not-exist');
        const records = await sequelizeRefreshStore.load();
        expect(records).toHaveLength(1);
    });

    it('deleteByOwner removes every row owned by that user — and only those', async () => {
        await sequelizeRefreshStore.put(sample({ hash: 'a-1', ownerId: 'owner-a' }));
        await sequelizeRefreshStore.put(sample({ hash: 'a-2', ownerId: 'owner-a' }));
        await sequelizeRefreshStore.put(sample({ hash: 'b-1', ownerId: 'owner-b' }));
        await sequelizeRefreshStore.deleteByOwner('owner-a');
        const records = await sequelizeRefreshStore.load();
        expect(records).toHaveLength(1);
        expect(records[0].ownerId).toBe('owner-b');
    });

    it('deleteByOwner targets the indexed column (lookup works)', async () => {
        // Smoke test — if the indexed lookup were broken the query
        // would still work but might hit a different column or no
        // rows. Verifies the WHERE clause matches by ownerId, not by
        // some accidental id.
        for (let i = 0; i < 5; i++) {
            await sequelizeRefreshStore.put(sample({
                hash: `h-${i}`,
                ownerId: i % 2 === 0 ? 'even' : 'odd'
            }));
        }
        await sequelizeRefreshStore.deleteByOwner('even');
        const records = await sequelizeRefreshStore.load();
        expect(records).toHaveLength(2);
        expect(records.every(r => r.ownerId === 'odd')).toBe(true);
    });

    it('deleteExpired drops only rows whose expiresAt is at or before `now`', async () => {
        const now = Date.now();
        await sequelizeRefreshStore.put(sample({ hash: 'past', expiresAt: now - 60_000 }));
        await sequelizeRefreshStore.put(sample({ hash: 'present', expiresAt: now }));
        await sequelizeRefreshStore.put(sample({ hash: 'future', expiresAt: now + 60_000 }));
        await sequelizeRefreshStore.deleteExpired(now);
        const records = await sequelizeRefreshStore.load();
        expect(records.map(r => r.hash).sort()).toEqual(['future']);
    });

    it('load returns an empty array when the table is empty', async () => {
        const records = await sequelizeRefreshStore.load();
        expect(records).toEqual([]);
    });

    it('persists timestamps via the model defaults — INSERT does not need them', async () => {
        // The model has timestamps: true (default). If a regression flips it
        // to false, INSERTs against an existing prod DB would blow up on the
        // NOT NULL createdAt / updatedAt columns. Pin the working contract by
        // checking the columns actually exist after sync.
        const description = await RefreshToken.describe();
        expect(Object.keys(description)).toContain('createdAt');
        expect(Object.keys(description)).toContain('updatedAt');
    });
});
