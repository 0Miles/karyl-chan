import { describe, it, expect, beforeEach } from 'vitest';
import { clearDraft, loadDraft, saveDraft } from './composer-draft';

beforeEach(() => {
    localStorage.clear();
});

describe('composer-draft', () => {
    describe('saveDraft + loadDraft', () => {
        it('round-trips a typed message', () => {
            saveDraft('c-1', 'hello world');
            expect(loadDraft('c-1')).toBe('hello world');
        });

        it('keys by channel id — drafts do not leak across channels', () => {
            saveDraft('c-1', 'note A');
            saveDraft('c-2', 'note B');
            expect(loadDraft('c-1')).toBe('note A');
            expect(loadDraft('c-2')).toBe('note B');
        });

        it('overwrites the previous draft on a second save', () => {
            saveDraft('c-1', 'first');
            saveDraft('c-1', 'second');
            expect(loadDraft('c-1')).toBe('second');
        });

        it('saving an empty / whitespace-only string clears the draft', () => {
            saveDraft('c-1', 'something');
            saveDraft('c-1', '   ');
            // Whitespace-only is treated as cleared so an accidental
            // backspace-to-empty doesn't leave a phantom draft sitting
            // in localStorage forever.
            expect(loadDraft('c-1')).toBe('');
        });

        it('truncates pathological inputs to MAX_LEN (8000)', () => {
            const huge = 'x'.repeat(20_000);
            saveDraft('c-1', huge);
            const restored = loadDraft('c-1');
            expect(restored.length).toBe(8000);
        });

        it('null / undefined channelId is a no-op', () => {
            saveDraft(null, 'no anchor');
            saveDraft(undefined, 'still no anchor');
            // Nothing should land in localStorage under any key.
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                expect(key).not.toMatch(/karyl-composer-draft/);
            }
        });
    });

    describe('loadDraft', () => {
        it('returns empty string when no draft exists', () => {
            expect(loadDraft('c-missing')).toBe('');
        });

        it('returns empty string for null / undefined channelId', () => {
            expect(loadDraft(null)).toBe('');
            expect(loadDraft(undefined)).toBe('');
        });
    });

    describe('clearDraft', () => {
        it('removes a saved draft', () => {
            saveDraft('c-1', 'hi');
            clearDraft('c-1');
            expect(loadDraft('c-1')).toBe('');
        });

        it('is a no-op for null / undefined', () => {
            saveDraft('c-1', 'hi');
            clearDraft(null);
            clearDraft(undefined);
            expect(loadDraft('c-1')).toBe('hi');
        });

        it('does not throw when clearing a non-existent draft', () => {
            expect(() => clearDraft('c-never')).not.toThrow();
        });
    });

    describe('localStorage failure modes', () => {
        it('saveDraft swallows quota errors silently', () => {
            const original = Storage.prototype.setItem;
            Storage.prototype.setItem = () => { throw new DOMException('Quota', 'QuotaExceededError'); };
            try {
                expect(() => saveDraft('c-1', 'overflow')).not.toThrow();
            } finally {
                Storage.prototype.setItem = original;
            }
        });

        it('loadDraft swallows getItem errors silently (returns empty)', () => {
            const original = Storage.prototype.getItem;
            Storage.prototype.getItem = () => { throw new Error('access denied'); };
            try {
                expect(loadDraft('c-1')).toBe('');
            } finally {
                Storage.prototype.getItem = original;
            }
        });
    });
});
