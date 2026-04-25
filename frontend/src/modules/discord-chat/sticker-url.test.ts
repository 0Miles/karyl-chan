import { describe, it, expect } from 'vitest';
import { stickerImageUrl } from './sticker-url';

describe('stickerImageUrl', () => {
    it('uses cdn.discordapp.com + .png for PNG (format 1)', () => {
        expect(stickerImageUrl('111', 1)).toBe('https://cdn.discordapp.com/stickers/111.png?size=160');
    });

    it('uses cdn.discordapp.com + .png for APNG (format 2)', () => {
        expect(stickerImageUrl('222', 2)).toBe('https://cdn.discordapp.com/stickers/222.png?size=160');
    });

    it('uses cdn.discordapp.com + .png for LOTTIE (format 3)', () => {
        // LOTTIE thumbnails live on the cdn host even though the actual
        // animation data comes from a separate JSON endpoint.
        expect(stickerImageUrl('333', 3)).toBe('https://cdn.discordapp.com/stickers/333.png?size=160');
    });

    it('uses media.discordapp.net + .gif for GIF (format 4)', () => {
        // Only the media host serves the gif variant — cdn returns 404.
        expect(stickerImageUrl('444', 4)).toBe('https://media.discordapp.net/stickers/444.gif?size=160');
    });

    it('honours a custom size on the cdn variant', () => {
        expect(stickerImageUrl('111', 1, 80)).toBe('https://cdn.discordapp.com/stickers/111.png?size=80');
    });

    it('honours a custom size on the media variant', () => {
        expect(stickerImageUrl('444', 4, 320)).toBe('https://media.discordapp.net/stickers/444.gif?size=320');
    });

    it('falls back to cdn for unknown format types', () => {
        // Defensive: a future format we don't recognise still gets a
        // sensible URL rather than throwing.
        expect(stickerImageUrl('999', 99)).toBe('https://cdn.discordapp.com/stickers/999.png?size=160');
    });
});
