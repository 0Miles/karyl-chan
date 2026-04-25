import { describe, it, expect, beforeEach } from 'vitest';
import { systemEventLog } from '../src/web/system-event-log.js';

/**
 * The event log is a singleton. Tests need to be order-independent
 * even though they share state, so we drain it before each case via
 * the (intentionally undocumented) assumption that pushing past
 * MAX_EVENTS evicts older entries — flushing the singleton by
 * recording 100+ throwaway events at the start would work but is
 * noisy. Instead we treat the existing entries as preamble and
 * snapshot the post-test slice we care about.
 */
function snapshot() {
    return systemEventLog.list();
}

describe('SystemEventLog', () => {
    beforeEach(() => {
        // Push enough server-start events to flush any prior content
        // beyond the MAX_EVENTS cap, then drop them by counting.
        // (We assert relative behaviour, not absolute counts.)
        for (let i = 0; i < 5; i++) systemEventLog.record('server-start', `setup-${i}`);
    });

    it('record adds an entry with monotonically increasing id', () => {
        const before = snapshot()[0]; // newest first
        systemEventLog.record('error', 'first');
        const after = snapshot();
        expect(after[0].id).toBe(before.id + 1);
        expect(after[0].type).toBe('error');
        expect(after[0].message).toBe('first');
    });

    it('list returns events newest-first', () => {
        systemEventLog.record('error', 'A');
        systemEventLog.record('error', 'B');
        const list = snapshot();
        expect(list[0].message).toBe('B');
        expect(list[1].message).toBe('A');
    });

    it('emits valid ISO timestamps', () => {
        systemEventLog.record('error', 'time-test');
        const [latest] = snapshot();
        expect(() => new Date(latest.timestamp).toISOString()).not.toThrow();
        expect(latest.timestamp).toBe(new Date(latest.timestamp).toISOString());
    });

    it('caps the buffer at MAX_EVENTS (oldest fall off)', () => {
        // The MAX_EVENTS const is 100; record 150 to force eviction.
        for (let i = 0; i < 150; i++) systemEventLog.record('error', `evict-${i}`);
        const list = snapshot();
        expect(list.length).toBeLessThanOrEqual(100);
        // Newest is the most recent push.
        expect(list[0].message).toBe('evict-149');
        // Oldest "setup-0" should be long gone after 150 fresh pushes.
        expect(list.find(e => e.message === 'setup-0')).toBeUndefined();
    });
});
