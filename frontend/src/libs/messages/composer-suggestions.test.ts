import { describe, it, expect } from 'vitest';
import { findActiveTrigger } from './composer-suggestions';

describe('findActiveTrigger', () => {
    it('returns null when no triggers are configured', () => {
        expect(findActiveTrigger('@bob', 4, [])).toBeNull();
    });

    it('returns null when the cursor isn\'t inside a trigger', () => {
        expect(findActiveTrigger('hello world', 5, ['@'])).toBeNull();
    });

    it('detects @ at the very start of the line', () => {
        const r = findActiveTrigger('@bob', 4, ['@']);
        expect(r).toEqual({ char: '@', query: 'bob', range: [0, 4] });
    });

    it('detects @ after whitespace', () => {
        // "hi @al" — cursor at end (6), trigger at index 3.
        const r = findActiveTrigger('hi @al', 6, ['@']);
        expect(r).toEqual({ char: '@', query: 'al', range: [3, 6] });
    });

    it('returns null for an in-word @ (e.g. an email address)', () => {
        // Cursor right after the d in "ed" — the @ here is mid-word.
        const r = findActiveTrigger('email@domain', 12, ['@']);
        expect(r).toBeNull();
    });

    it('cancels the trigger when the user types whitespace after it', () => {
        // "@bob " — cursor at end. We hit a space before the @, so
        // the user has finished typing the suggestion query and we
        // should stop showing the menu.
        const r = findActiveTrigger('@bob ', 5, ['@']);
        expect(r).toBeNull();
    });

    it('extracts an empty query right after typing the trigger', () => {
        // Just typed "@" — empty query is meaningful (show ALL options).
        const r = findActiveTrigger('@', 1, ['@']);
        expect(r).toEqual({ char: '@', query: '', range: [0, 1] });
    });

    it('disambiguates between multiple trigger characters', () => {
        const r = findActiveTrigger('hi #gen', 7, ['@', '#']);
        expect(r?.char).toBe('#');
        expect(r?.query).toBe('gen');
    });

    it('takes the closest trigger when multiple are present', () => {
        // "@one #two" cursor at end — the # is closer to the cursor.
        const r = findActiveTrigger('@one #two', 9, ['@', '#']);
        expect(r?.char).toBe('#');
        expect(r?.query).toBe('two');
    });

    it('respects a cursor that is mid-string, not at the end', () => {
        // "@al|ice" — cursor between "al" and "ice".
        const r = findActiveTrigger('@alice', 3, ['@']);
        expect(r).toEqual({ char: '@', query: 'al', range: [0, 3] });
    });
});
