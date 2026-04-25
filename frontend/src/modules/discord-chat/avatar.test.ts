import { describe, it, expect } from 'vitest';
import { animatedAvatarUrl, isAnimatedAvatar, isAnimatedBanner } from './avatar';

describe('isAnimatedAvatar', () => {
    it('returns false for null/undefined/empty', () => {
        expect(isAnimatedAvatar(null)).toBe(false);
        expect(isAnimatedAvatar(undefined)).toBe(false);
        expect(isAnimatedAvatar('')).toBe(false);
    });

    it('detects an animated global avatar (a_ hash prefix)', () => {
        expect(isAnimatedAvatar('https://cdn.discordapp.com/avatars/123/a_deadbeef.webp')).toBe(true);
    });

    it('detects an animated guild-specific avatar (extra /<userId>/ segment)', () => {
        expect(
            isAnimatedAvatar('https://cdn.discordapp.com/guilds/9/users/123/avatars/456/a_hash.webp')
        ).toBe(true);
    });

    it('returns false for a non-animated avatar (no a_ prefix)', () => {
        expect(isAnimatedAvatar('https://cdn.discordapp.com/avatars/123/abcdef.webp')).toBe(false);
    });

    it('returns false for a non-avatar URL even with a_ in the path', () => {
        // The `a_` must be the first chars of the hash segment, not arbitrary text.
        expect(isAnimatedAvatar('https://example.com/a_thing.webp')).toBe(false);
    });
});

describe('isAnimatedBanner', () => {
    it('detects an animated banner', () => {
        expect(
            isAnimatedBanner('https://cdn.discordapp.com/banners/123/a_hash.webp')
        ).toBe(true);
    });

    it('returns false for static banners', () => {
        expect(
            isAnimatedBanner('https://cdn.discordapp.com/banners/123/abcdef.webp')
        ).toBe(false);
    });

    it('returns false for null/undefined', () => {
        expect(isAnimatedBanner(null)).toBe(false);
        expect(isAnimatedBanner(undefined)).toBe(false);
    });
});

describe('animatedAvatarUrl', () => {
    it('appends ?animated=true when the URL has no query string', () => {
        expect(animatedAvatarUrl('https://cdn/avatars/1/a_h.webp'))
            .toBe('https://cdn/avatars/1/a_h.webp?animated=true');
    });

    it('appends &animated=true when the URL already has a query string', () => {
        expect(animatedAvatarUrl('https://cdn/avatars/1/a_h.webp?size=128'))
            .toBe('https://cdn/avatars/1/a_h.webp?size=128&animated=true');
    });
});
