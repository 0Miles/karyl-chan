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

    describe('legacy plaintext fallback', () => {
        it('returns value unchanged when no v1: prefix', () => {
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
            expect(decryptSecret('legacy-plaintext')).toBe('legacy-plaintext');
            expect(warn).toHaveBeenCalledOnce();
        });

        it('warns only when a legacy value is seen', () => {
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
            decryptSecret(encryptSecret('x'));
            expect(warn).not.toHaveBeenCalled();
        });
    });

    describe('malformed input', () => {
        it('rejects v2: values without all 5 segments', () => {
            expect(() => decryptSecret('v2:only-one-part')).toThrow(/Invalid v2 encrypted value format/);
        });

        it('rejects v1: values without all 4 segments', () => {
            expect(() => decryptSecret('v1:only-one-part')).toThrow(/Invalid v1 encrypted value format/);
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
