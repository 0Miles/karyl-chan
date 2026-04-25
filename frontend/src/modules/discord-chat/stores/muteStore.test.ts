import { describe, it, expect, beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useMuteStore } from './muteStore';

beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
});

describe('muteStore', () => {
    describe('default state', () => {
        it('returns "all" for any unmuted channel', () => {
            const m = useMuteStore();
            expect(m.getLevel('c-1')).toBe('all');
            expect(m.isMuted('c-1')).toBe(false);
            expect(m.showsCount('c-1')).toBe(true);
            expect(m.showsMention('c-1')).toBe(true);
        });

        it('treats null/undefined channelId as "all"', () => {
            const m = useMuteStore();
            expect(m.getLevel(null)).toBe('all');
            expect(m.getLevel(undefined)).toBe('all');
            expect(m.isMuted(null)).toBe(false);
        });
    });

    describe('setLevel', () => {
        it('sets a level and reflects via getLevel', () => {
            const m = useMuteStore();
            m.setLevel('c-1', 'mentions-only');
            expect(m.getLevel('c-1')).toBe('mentions-only');
            m.setLevel('c-1', 'none');
            expect(m.getLevel('c-1')).toBe('none');
        });

        it('setting "all" removes the entry (back to default)', () => {
            const m = useMuteStore();
            m.setLevel('c-1', 'none');
            m.setLevel('c-1', 'all');
            expect(m.isMuted('c-1')).toBe(false);
            expect(m.levels['c-1']).toBeUndefined();
        });
    });

    describe('semantics flags', () => {
        it('mentions-only: counts hidden, mentions still shown', () => {
            const m = useMuteStore();
            m.setLevel('c-1', 'mentions-only');
            expect(m.showsCount('c-1')).toBe(false);
            expect(m.showsMention('c-1')).toBe(true);
            expect(m.isMuted('c-1')).toBe(true);
        });

        it('none: nothing shown — counts AND mentions hidden', () => {
            const m = useMuteStore();
            m.setLevel('c-1', 'none');
            expect(m.showsCount('c-1')).toBe(false);
            expect(m.showsMention('c-1')).toBe(false);
            expect(m.isMuted('c-1')).toBe(true);
        });
    });

    describe('cycle', () => {
        it('advances all → mentions-only → none → all', () => {
            const m = useMuteStore();
            m.cycle('c-1');
            expect(m.getLevel('c-1')).toBe('mentions-only');
            m.cycle('c-1');
            expect(m.getLevel('c-1')).toBe('none');
            m.cycle('c-1');
            expect(m.getLevel('c-1')).toBe('all');
        });
    });

    describe('persistence', () => {
        it('writes the v2 record to localStorage', async () => {
            const m = useMuteStore();
            m.setLevel('c-1', 'none');
            m.setLevel('c-2', 'mentions-only');
            // Persist is debounced 200ms; wait a tick past that.
            await new Promise(resolve => setTimeout(resolve, 250));
            const raw = localStorage.getItem('karyl-mutes-v2');
            expect(raw).not.toBeNull();
            const parsed = JSON.parse(raw!);
            expect(parsed['c-1']).toBe('none');
            expect(parsed['c-2']).toBe('mentions-only');
        });

        it('hydrates from v2 on store creation', () => {
            localStorage.setItem('karyl-mutes-v2', JSON.stringify({ 'c-1': 'none' }));
            // Fresh pinia → fresh store instance.
            setActivePinia(createPinia());
            const m = useMuteStore();
            expect(m.getLevel('c-1')).toBe('none');
        });

        it('migrates v1 (string[] of muted ids → level "none")', () => {
            localStorage.setItem('karyl-mutes-v1', JSON.stringify(['c-old', 'c-also-old']));
            setActivePinia(createPinia());
            const m = useMuteStore();
            expect(m.getLevel('c-old')).toBe('none');
            expect(m.getLevel('c-also-old')).toBe('none');
        });

        it('ignores garbage in localStorage', () => {
            localStorage.setItem('karyl-mutes-v2', '{not-json');
            setActivePinia(createPinia());
            const m = useMuteStore();
            expect(m.isMuted('anything')).toBe(false);
        });
    });

    describe('clear', () => {
        it('drops every level and wipes localStorage', () => {
            const m = useMuteStore();
            m.setLevel('c-1', 'none');
            m.setLevel('c-2', 'mentions-only');
            m.clear();
            expect(m.isMuted('c-1')).toBe(false);
            expect(m.isMuted('c-2')).toBe(false);
            expect(localStorage.getItem('karyl-mutes-v2')).toBeNull();
        });
    });
});
