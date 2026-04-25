import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useTypingStore } from './typingStore';

beforeEach(() => {
    setActivePinia(createPinia());
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
});

describe('typingStore', () => {
    it('records a typer and surfaces them in activeIn', () => {
        const t = useTypingStore();
        t.note('c-1', 'u-1', 'alice');
        const active = t.activeIn('c-1');
        expect(active).toHaveLength(1);
        expect(active[0]).toMatchObject({ userId: 'u-1', userName: 'alice' });
    });

    it('returns empty for an unknown channel', () => {
        const t = useTypingStore();
        expect(t.activeIn('c-empty')).toEqual([]);
    });

    it('multiple typers in the same channel coexist', () => {
        const t = useTypingStore();
        t.note('c-1', 'u-1', 'alice');
        t.note('c-1', 'u-2', 'bob');
        const ids = t.activeIn('c-1').map(e => e.userId).sort();
        expect(ids).toEqual(['u-1', 'u-2']);
    });

    it('re-noting the same user refreshes the timestamp (no duplicate)', () => {
        const t = useTypingStore();
        t.note('c-1', 'u-1', 'alice');
        // Advance partway through the TTL.
        vi.advanceTimersByTime(5_000);
        t.note('c-1', 'u-1', 'alice');
        // Past the original TTL but within the refreshed one.
        vi.advanceTimersByTime(7_000);
        const active = t.activeIn('c-1');
        expect(active).toHaveLength(1);
        expect(active[0].userId).toBe('u-1');
    });

    it('prunes stale typers after 10s', () => {
        const t = useTypingStore();
        t.note('c-1', 'u-1', 'alice');
        vi.advanceTimersByTime(11_000);
        expect(t.activeIn('c-1')).toEqual([]);
    });

    it('keeps fresh typers when only some are stale', () => {
        const t = useTypingStore();
        t.note('c-1', 'u-old', 'old');
        vi.advanceTimersByTime(8_000);
        t.note('c-1', 'u-fresh', 'fresh');
        // Push the older one past 10s but the newer one is still fresh.
        vi.advanceTimersByTime(3_000);
        const active = t.activeIn('c-1');
        expect(active.map(e => e.userId)).toEqual(['u-fresh']);
    });

    it('different channels are isolated', () => {
        const t = useTypingStore();
        t.note('c-1', 'u-1', 'alice');
        t.note('c-2', 'u-2', 'bob');
        expect(t.activeIn('c-1').map(e => e.userId)).toEqual(['u-1']);
        expect(t.activeIn('c-2').map(e => e.userId)).toEqual(['u-2']);
    });

    it('clear wipes every channel', () => {
        const t = useTypingStore();
        t.note('c-1', 'u-1', 'alice');
        t.note('c-2', 'u-2', 'bob');
        t.clear();
        expect(t.activeIn('c-1')).toEqual([]);
        expect(t.activeIn('c-2')).toEqual([]);
    });
});
