import { vi, describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';

// Force the shared sequelize singleton onto an in-memory DB *before*
// db.ts is loaded by any subsequent import. Hoisted so the env var
// is in place when the module graph evaluates.
vi.hoisted(() => {
    process.env.SQLITE_DB_PATH = ':memory:';
});

import { sequelize } from '../src/models/db.js';
import { AdminAuditLog } from '../src/modules/admin/models/admin-audit-log.model.js';
import { recordAudit, listAudit, verifyAuditChain } from '../src/modules/admin/admin-audit.service.js';

beforeAll(async () => {
    // sync (not migrations) — model definition already declares the
    // previousHash / hash columns the chain needs.
    await sequelize.sync({ force: true });
});

beforeEach(async () => {
    // Full re-sync per test rather than truncate: SQLite keeps the
    // autoincrement counter in sqlite_sequence across `truncate`, which
    // would have ids drifting from 1 across the suite — and several
    // tests assert on specific ids returned by the verifier.
    await sequelize.sync({ force: true });
});

afterAll(async () => {
    await sequelize.close();
});

describe('admin audit hash chain', () => {
    describe('recordAudit + verifyAuditChain', () => {
        it('a freshly-empty log verifies clean', async () => {
            const result = await verifyAuditChain();
            expect(result.valid).toBe(true);
            expect(result.rowsChecked).toBe(0);
            expect(result.firstBrokenId).toBeNull();
        });

        it('chains successive rows and verifies clean', async () => {
            await recordAudit('owner1', 'role.create', 'admin', { description: 'full' });
            await recordAudit('owner1', 'user.create', '111111111111111111', { role: 'admin' });
            await recordAudit('owner1', 'user.update', '111111111111111111', { role: 'mod' });

            const result = await verifyAuditChain();
            expect(result.valid).toBe(true);
            expect(result.rowsChecked).toBe(3);
            expect(result.firstBrokenId).toBeNull();
        });

        it('genesis row has previousHash = null', async () => {
            await recordAudit('owner1', 'role.create', 'admin');
            const entries = await listAudit({ limit: 10 });
            // listAudit returns DESC; the genesis is the only / oldest row.
            const genesis = entries[entries.length - 1];
            expect(genesis.previousHash).toBeNull();
            expect(genesis.hash).toMatch(/^[0-9a-f]{64}$/);
        });

        it('subsequent rows reference the previous hash exactly', async () => {
            await recordAudit('owner1', 'a', 't1');
            await recordAudit('owner1', 'b', 't2');
            const entries = await listAudit({ limit: 10 });
            // entries: [b, a] (DESC by id).
            const [second, first] = entries;
            expect(second.previousHash).toBe(first.hash);
        });

        it('null context records as null (not the string "null")', async () => {
            await recordAudit('owner1', 'role.delete', 'admin', null);
            const entries = await listAudit({ limit: 1 });
            expect(entries[0].context).toBeNull();
            // And the chain still verifies — null is the documented input
            // and must round-trip identically.
            expect((await verifyAuditChain()).valid).toBe(true);
        });

        it('listAudit returns DESC by id with hash + previousHash exposed', async () => {
            await recordAudit('owner1', 'a', 't1');
            await recordAudit('owner1', 'b', 't2');
            const entries = await listAudit({ limit: 10 });
            expect(entries.map(e => e.action)).toEqual(['b', 'a']);
            expect(entries[0].hash).toMatch(/^[0-9a-f]{64}$/);
            expect(entries[1].hash).toMatch(/^[0-9a-f]{64}$/);
        });

        it('listAudit honours the `before` cursor for pagination', async () => {
            await recordAudit('owner1', 'a', 't1');
            await recordAudit('owner1', 'b', 't2');
            await recordAudit('owner1', 'c', 't3');
            const all = await listAudit({ limit: 10 });
            // Take the largest id, then page back.
            const before = all[0].id;
            const older = await listAudit({ limit: 10, before });
            expect(older.map(e => e.action)).toEqual(['b', 'a']);
        });
    });

    describe('tamper detection', () => {
        it('detects mutated context on a row', async () => {
            await recordAudit('owner1', 'role.create', 'admin', { description: 'orig' });
            // Direct SQL bypasses recordAudit — simulating an attacker
            // with DB write access trying to forge history.
            await sequelize.query(
                `UPDATE admin_audit_log SET context = ? WHERE id = 1`,
                { replacements: [JSON.stringify({ description: 'forged' })] }
            );
            const result = await verifyAuditChain();
            expect(result.valid).toBe(false);
            expect(result.firstBrokenId).toBe(1);
        });

        it('detects mutated actor', async () => {
            await recordAudit('owner1', 'role.create', 'admin');
            await sequelize.query(
                `UPDATE admin_audit_log SET actorUserId = 'attacker' WHERE id = 1`
            );
            const result = await verifyAuditChain();
            expect(result.valid).toBe(false);
            expect(result.firstBrokenId).toBe(1);
        });

        it('detects mutated action verb', async () => {
            await recordAudit('owner1', 'role.create', 'admin');
            await sequelize.query(
                `UPDATE admin_audit_log SET action = 'role.delete' WHERE id = 1`
            );
            const result = await verifyAuditChain();
            expect(result.valid).toBe(false);
            expect(result.firstBrokenId).toBe(1);
        });

        it('detects an inserted row in the middle', async () => {
            await recordAudit('owner1', 'first', 't1');
            await recordAudit('owner1', 'third', 't3');
            const all = await listAudit({ limit: 10 });
            // all: [third, first] — inject an id between them.
            const firstHash = all[1].hash;
            await sequelize.query(`
                INSERT INTO admin_audit_log
                    (id, actorUserId, action, target, context, previousHash, hash, createdAt)
                VALUES
                    (50, 'forger', 'sneaky', 't2', '"x"', ?, 'made-up-hash', '2026-01-01T00:00:00.000Z')
            `, { replacements: [firstHash] });
            const result = await verifyAuditChain();
            expect(result.valid).toBe(false);
            // Walking ascending — the broken row is the inserted one
            // because its stored `hash` doesn't match the recomputed
            // chainHash for its payload.
            expect(result.firstBrokenId).toBe(50);
        });

        it('detects deletion of a non-tail row (chain becomes discontinuous)', async () => {
            await recordAudit('owner1', 'a', 't1');
            await recordAudit('owner1', 'b', 't2');
            await recordAudit('owner1', 'c', 't3');
            // Snip out the middle row. The third row's previousHash
            // pointer no longer matches the second row's (now-deleted)
            // hash, so verification breaks at id=3.
            await sequelize.query(`DELETE FROM admin_audit_log WHERE id = 2`);
            const result = await verifyAuditChain();
            expect(result.valid).toBe(false);
            expect(result.firstBrokenId).toBe(3);
        });

        it('detects mutated stored hash even when payload is intact', async () => {
            await recordAudit('owner1', 'a', 't1');
            await sequelize.query(
                `UPDATE admin_audit_log SET hash = ? WHERE id = 1`,
                { replacements: ['0'.repeat(64)] }
            );
            const result = await verifyAuditChain();
            expect(result.valid).toBe(false);
            expect(result.firstBrokenId).toBe(1);
        });
    });

    describe('JSON column round-trip', () => {
        it('survives complex nested context (chain stays valid)', async () => {
            await recordAudit('owner1', 'role.update', 'admin', {
                description: 'has 中文 and emoji 😀',
                capabilities: ['admin', 'dm.message'],
                meta: { previous: null, requestedBy: 'self' }
            });
            const result = await verifyAuditChain();
            expect(result.valid).toBe(true);
            const [entry] = await listAudit({ limit: 1 });
            expect(entry.context).toMatchObject({
                description: 'has 中文 and emoji 😀',
                capabilities: ['admin', 'dm.message']
            });
        });
    });
});
