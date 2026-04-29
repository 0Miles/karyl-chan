import { describe, expect, it } from 'vitest';
import { randomBytes } from 'crypto';
import { JwtService, type JwtClaims } from '../src/modules/web-core/jwt.service.js';

const SECRET = randomBytes(64);
const OTHER = randomBytes(64);

const baseClaims: JwtClaims = {
    purpose: 'login',
    userId: 'user-1',
    guildId: 'guild-1',
    channelId: 'channel-1',
    messageId: 'message-1'
};

describe('JwtService', () => {
    it('round-trips claims via sign + verify', () => {
        const svc = new JwtService(SECRET);
        const { token } = svc.sign(baseClaims);
        expect(svc.verify(token)).toEqual(baseClaims);
    });

    it('preserves a null guildId (DM context)', () => {
        const svc = new JwtService(SECRET);
        const { token } = svc.sign({ ...baseClaims, guildId: null });
        expect(svc.verify(token)).toEqual({ ...baseClaims, guildId: null });
    });

    it('defaults to a 5-minute TTL', () => {
        const svc = new JwtService(SECRET);
        const now = Date.now();
        const { expiresAt } = svc.sign(baseClaims, { now });
        expect(expiresAt).toBe(now + 5 * 60 * 1000);
    });

    it('honors a caller-supplied TTL', () => {
        const svc = new JwtService(SECRET);
        const now = Date.now();
        const { token, expiresAt } = svc.sign(baseClaims, { now, ttlMs: 60_000 });
        expect(expiresAt).toBe(now + 60_000);
        expect(svc.verify(token, { now: now + 30_000 })).toEqual(baseClaims);
        expect(svc.verify(token, { now: now + 61_000 })).toBeNull();
    });

    it('rejects tokens past their exp', () => {
        const svc = new JwtService(SECRET);
        const now = Date.now();
        const { token } = svc.sign(baseClaims, { now });
        expect(svc.verify(token, { now: now + 6 * 60 * 1000 })).toBeNull();
    });

    it('rejects tokens signed with a different secret', () => {
        const issuer = new JwtService(SECRET);
        const verifier = new JwtService(OTHER);
        const { token } = issuer.sign(baseClaims);
        expect(verifier.verify(token)).toBeNull();
    });

    it('rejects tokens whose signature has been tampered with', () => {
        const svc = new JwtService(SECRET);
        const { token } = svc.sign(baseClaims);
        // Flip a single base64url char in the signature segment.
        const [h, b, sig] = token.split('.');
        const flipped = sig[0] === 'A' ? 'B' + sig.slice(1) : 'A' + sig.slice(1);
        expect(svc.verify(`${h}.${b}.${flipped}`)).toBeNull();
    });

    it('rejects tokens whose body has been tampered with', () => {
        const svc = new JwtService(SECRET);
        const { token } = svc.sign(baseClaims);
        const [h, , sig] = token.split('.');
        // Substitute a forged body keeping the original signature —
        // signature check should reject because the HMAC won't match.
        const forgedBody = Buffer.from(JSON.stringify({
            ...baseClaims,
            userId: 'attacker',
            iat: 0,
            exp: Math.floor(Date.now() / 1000) + 60
        })).toString('base64')
            .replace(/=+$/g, '').replace(/\+/g, '-').replace(/\//g, '_');
        expect(svc.verify(`${h}.${forgedBody}.${sig}`)).toBeNull();
    });

    it('rejects an `alg: none` confusion attempt', () => {
        const svc = new JwtService(SECRET);
        const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64')
            .replace(/=+$/g, '').replace(/\+/g, '-').replace(/\//g, '_');
        const body = Buffer.from(JSON.stringify({
            ...baseClaims,
            iat: 0,
            exp: Math.floor(Date.now() / 1000) + 60
        })).toString('base64')
            .replace(/=+$/g, '').replace(/\+/g, '-').replace(/\//g, '_');
        // No signature — verify should reject for shape and signature alike.
        expect(svc.verify(`${header}.${body}.`)).toBeNull();
    });

    it('rejects malformed tokens', () => {
        const svc = new JwtService(SECRET);
        expect(svc.verify('')).toBeNull();
        expect(svc.verify('not.a.jwt.shape')).toBeNull();
        expect(svc.verify('only-one-segment')).toBeNull();
        expect(svc.verify('a.b.c')).toBeNull();
    });

    it('refuses to construct with a too-short secret', () => {
        expect(() => new JwtService(Buffer.from('short'))).toThrow();
    });

    describe('purpose', () => {
        it('round-trips the purpose claim', () => {
            const svc = new JwtService(SECRET);
            const { token } = svc.sign({ ...baseClaims, purpose: 'link-account' });
            expect(svc.verify(token)?.purpose).toBe('link-account');
        });

        it('refuses to sign without a purpose', () => {
            const svc = new JwtService(SECRET);
            expect(() => svc.sign({ ...baseClaims, purpose: '' })).toThrow();
        });

        it('verify(purpose) accepts matching tokens', () => {
            const svc = new JwtService(SECRET);
            const { token } = svc.sign(baseClaims);
            expect(svc.verify(token, { purpose: 'login' })).toEqual(baseClaims);
        });

        it('verify(purpose) rejects mismatching tokens', () => {
            const svc = new JwtService(SECRET);
            const { token } = svc.sign({ ...baseClaims, purpose: 'link-account' });
            expect(svc.verify(token, { purpose: 'login' })).toBeNull();
            // No purpose filter still accepts.
            expect(svc.verify(token)).not.toBeNull();
        });
    });
});
