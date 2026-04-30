import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'crypto';
import { decryptSecret, encryptSecret } from '../src/utils/crypto.js';

const VALID_KEY = randomBytes(32).toString('hex');
const ORIGINAL_KEY = process.env.ENCRYPTION_KEY;

describe('crypto', () => {
    beforeEach(() => {
        process.env.ENCRYPTION_KEY = VALID_KEY;
    });

    afterEach(() => {
        if (ORIGINAL_KEY === undefined) {
            delete process.env.ENCRYPTION_KEY;
        } else {
            process.env.ENCRYPTION_KEY = ORIGINAL_KEY;
        }
        vi.restoreAllMocks();
    });

    describe('roundtrip', () => {
        it('decrypts what encryptSecret produced', () => {
            const plaintext = 'my-rcon-password-123';
            expect(decryptSecret(encryptSecret(plaintext))).toBe(plaintext);
        });

        it('produces different ciphertext for identical plaintext (random IV)', () => {
            const a = encryptSecret('same');
            const b = encryptSecret('same');
            expect(a).not.toBe(b);
        });

        it('handles unicode plaintext', () => {
            const plaintext = '中文密碼 🔐 special!@#';
            expect(decryptSecret(encryptSecret(plaintext))).toBe(plaintext);
        });

        it('handles empty plaintext', () => {
            expect(decryptSecret(encryptSecret(''))).toBe('');
        });

        it('tags output with v2 version prefix', () => {
            expect(encryptSecret('x').startsWith('v2:')).toBe(true);
        });

        it('output has five colon-delimited segments (version, keyId, iv, tag, ct)', () => {
            expect(encryptSecret('x').split(':')).toHaveLength(5);
        });
    });

    describe('legacy format rejection (post v2-uplift migration)', () => {
        it('throws on v0 plaintext with migration hint', () => {
            expect(() => decryptSecret('legacy-plaintext')).toThrow(
                /unknown encryption format; run migration 20260430030000-encryption-v2-uplift/,
            );
        });

        it('throws on v1 ciphertext with migration hint', () => {
            // Craft a syntactically valid v1 blob (the brute-force path is gone)
            const v1Value = 'v1:aabbcc==:ddeeff==:001122==';
            expect(() => decryptSecret(v1Value)).toThrow(
                /unknown encryption format; run migration 20260430030000-encryption-v2-uplift/,
            );
        });

        it('does not throw on v2 values (no regression)', () => {
            expect(() => decryptSecret(encryptSecret('x'))).not.toThrow();
        });
    });

    describe('malformed input', () => {
        it('rejects v2: values without all 5 segments', () => {
            expect(() => decryptSecret('v2:only-one-part')).toThrow(/Invalid v2 encrypted value format/);
        });

        it('rejects tampered ciphertext (GCM tag mismatch)', () => {
            const ct = encryptSecret('secret');
            const lastChar = ct.slice(-1) === 'A' ? 'B' : 'A';
            const tampered = ct.slice(0, -1) + lastChar;
            expect(() => decryptSecret(tampered)).toThrow();
        });

        it('rejects value encrypted with a different key', () => {
            const ct = encryptSecret('secret');
            process.env.ENCRYPTION_KEY = randomBytes(32).toString('hex');
            expect(() => decryptSecret(ct)).toThrow();
        });
    });

    describe('key validation', () => {
        it('throws when ENCRYPTION_KEY is missing', () => {
            delete process.env.ENCRYPTION_KEY;
            expect(() => encryptSecret('x')).toThrow(/ENCRYPTION_KEY is not set/);
        });

        it('throws when key is not 32 bytes', () => {
            process.env.ENCRYPTION_KEY = 'deadbeef';
            expect(() => encryptSecret('x')).toThrow(/32 bytes/);
        });

        it('throws when key contains non-hex characters', () => {
            process.env.ENCRYPTION_KEY = 'z'.repeat(64);
            expect(() => encryptSecret('x')).toThrow();
        });

        it('decrypt also surfaces missing key', () => {
            const ct = encryptSecret('x');
            delete process.env.ENCRYPTION_KEY;
            expect(() => decryptSecret(ct)).toThrow(/ENCRYPTION_KEY is not set/);
        });
    });
});
