import { describe, it, expect } from 'vitest';
import { twemojiUrl } from './twemoji';

describe('twemojiUrl', () => {
    it('returns a CDN URL for a basic unicode emoji', () => {
        const url = twemojiUrl('👍');
        expect(url).not.toBeNull();
        expect(url).toMatch(/cdn\.jsdelivr\.net/);
        expect(url).toMatch(/\.svg$/);
    });

    it('uses .svg by default', () => {
        const url = twemojiUrl('👍');
        expect(url).toMatch(/\.svg$/);
    });

    it('honours an explicit png override', () => {
        const url = twemojiUrl('👍', 'png');
        expect(url).toMatch(/\.png$/);
        // PNGs ship at 72×72 in the twemoji CDN layout we use.
        expect(url).toMatch(/72x72/);
    });

    it('returns null for an empty string', () => {
        expect(twemojiUrl('')).toBeNull();
    });

    it('returns null for plain text without any emoji', () => {
        expect(twemojiUrl('hello')).toBeNull();
    });

    it('encodes the codepoint into the URL path', () => {
        const url = twemojiUrl('🚀');
        // U+1F680 → codepoint 1f680 in the twemoji CDN naming scheme.
        expect(url).toMatch(/1f680/);
    });

    it('handles a multi-codepoint flag emoji', () => {
        const url = twemojiUrl('🇹🇼');
        expect(url).not.toBeNull();
        // Regional indicators T + W → 1f1f9-1f1fc.
        expect(url).toMatch(/1f1f9-1f1fc/);
    });
});
