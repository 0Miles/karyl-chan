import { describe, it, expect, beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useLightboxStore, type LightboxImage } from './lightboxStore';

const img = (i: number): LightboxImage => ({
    url: `https://example.test/${i}.png`,
    filename: `img-${i}.png`,
    width: 100 + i,
    height: 200 + i
});

beforeEach(() => {
    setActivePinia(createPinia());
});

describe('lightboxStore', () => {
    describe('open', () => {
        it('seeds the image list and starts at index 0 by default', () => {
            const lb = useLightboxStore();
            lb.open([img(1), img(2), img(3)]);
            expect(lb.images).toHaveLength(3);
            expect(lb.index).toBe(0);
        });

        it('honours a startIndex within bounds', () => {
            const lb = useLightboxStore();
            lb.open([img(1), img(2), img(3)], 2);
            expect(lb.index).toBe(2);
        });

        it('clamps startIndex below 0 to 0', () => {
            const lb = useLightboxStore();
            lb.open([img(1), img(2)], -5);
            expect(lb.index).toBe(0);
        });

        it('clamps startIndex past the end to length - 1', () => {
            const lb = useLightboxStore();
            lb.open([img(1), img(2)], 99);
            expect(lb.index).toBe(1);
        });

        it('an empty list is a no-op (lightbox stays closed)', () => {
            const lb = useLightboxStore();
            lb.open([]);
            expect(lb.images).toHaveLength(0);
        });
    });

    describe('navigation', () => {
        it('next advances by one', () => {
            const lb = useLightboxStore();
            lb.open([img(1), img(2), img(3)]);
            lb.next();
            expect(lb.index).toBe(1);
            lb.next();
            expect(lb.index).toBe(2);
        });

        it('next wraps from the last to the first', () => {
            const lb = useLightboxStore();
            lb.open([img(1), img(2)], 1);
            lb.next();
            expect(lb.index).toBe(0);
        });

        it('prev decrements by one', () => {
            const lb = useLightboxStore();
            lb.open([img(1), img(2), img(3)], 2);
            lb.prev();
            expect(lb.index).toBe(1);
        });

        it('prev wraps from the first to the last', () => {
            const lb = useLightboxStore();
            lb.open([img(1), img(2), img(3)]);
            lb.prev();
            expect(lb.index).toBe(2);
        });

        it('next/prev are no-ops when no images are queued', () => {
            const lb = useLightboxStore();
            // Start clean (open() with [] should leave us at index 0).
            lb.open([]);
            lb.next();
            lb.prev();
            expect(lb.index).toBe(0);
        });
    });

    describe('close', () => {
        it('drops the image list and resets the index', () => {
            const lb = useLightboxStore();
            lb.open([img(1), img(2)], 1);
            lb.close();
            expect(lb.images).toHaveLength(0);
            expect(lb.index).toBe(0);
        });
    });
});
