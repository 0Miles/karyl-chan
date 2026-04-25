import { describe, it, expect, beforeEach } from 'vitest';
import {
    loadLastDmChannel,
    loadLastGuildChannel,
    loadLastSurface,
    saveLastDmChannel,
    saveLastGuildChannel,
    saveLastSurface
} from './last-channel';

beforeEach(() => {
    localStorage.clear();
});

describe('DM last channel', () => {
    it('loads what was saved', () => {
        saveLastDmChannel('c-dm-1');
        expect(loadLastDmChannel()).toBe('c-dm-1');
    });

    it('returns null when nothing was ever saved', () => {
        expect(loadLastDmChannel()).toBeNull();
    });

    it('overwrites the previous value', () => {
        saveLastDmChannel('first');
        saveLastDmChannel('second');
        expect(loadLastDmChannel()).toBe('second');
    });
});

describe('guild last channel map', () => {
    it('round-trips per-guild values', () => {
        saveLastGuildChannel('g-1', 'c-1');
        saveLastGuildChannel('g-2', 'c-2');
        expect(loadLastGuildChannel('g-1')).toBe('c-1');
        expect(loadLastGuildChannel('g-2')).toBe('c-2');
    });

    it('returns null for an unrecorded guild', () => {
        expect(loadLastGuildChannel('g-never')).toBeNull();
    });

    it('overwrites the channel for the same guild', () => {
        saveLastGuildChannel('g-1', 'old');
        saveLastGuildChannel('g-1', 'new');
        expect(loadLastGuildChannel('g-1')).toBe('new');
    });

    it('survives a malformed stored blob (returns null)', () => {
        localStorage.setItem('karyl-last-guild-channels', '{not-json');
        expect(loadLastGuildChannel('g-1')).toBeNull();
    });

    it('treats non-object stored values as empty (no crash on saveLastGuildChannel after corruption)', () => {
        localStorage.setItem('karyl-last-guild-channels', '"a string"');
        // Should rebuild a fresh map and persist the new entry.
        saveLastGuildChannel('g-1', 'c-1');
        expect(loadLastGuildChannel('g-1')).toBe('c-1');
    });
});

describe('last surface', () => {
    it('round-trips a {mode, channelId} record', () => {
        saveLastSurface({ mode: 'dm', channelId: 'c-1' });
        expect(loadLastSurface()).toEqual({ mode: 'dm', channelId: 'c-1' });
    });

    it('returns null when nothing is saved', () => {
        expect(loadLastSurface()).toBeNull();
    });

    it('returns null when the stored shape is missing mode', () => {
        localStorage.setItem('karyl-last-surface', JSON.stringify({ channelId: 'c-1' }));
        expect(loadLastSurface()).toBeNull();
    });

    it('returns null when the stored shape is missing channelId', () => {
        localStorage.setItem('karyl-last-surface', JSON.stringify({ mode: 'dm' }));
        expect(loadLastSurface()).toBeNull();
    });

    it('returns null when stored mode/channelId are non-string', () => {
        localStorage.setItem('karyl-last-surface', JSON.stringify({ mode: 1, channelId: 2 }));
        expect(loadLastSurface()).toBeNull();
    });

    it('returns null on malformed JSON', () => {
        localStorage.setItem('karyl-last-surface', '{');
        expect(loadLastSurface()).toBeNull();
    });
});

describe('storage isolation', () => {
    it('DM, guild map, and surface live in independent keys', () => {
        saveLastDmChannel('c-dm');
        saveLastGuildChannel('g-1', 'c-guild');
        saveLastSurface({ mode: 'g-1', channelId: 'c-guild' });
        expect(localStorage.getItem('karyl-last-dm-channel')).toBe('c-dm');
        expect(localStorage.getItem('karyl-last-guild-channels')).toBe(JSON.stringify({ 'g-1': 'c-guild' }));
        expect(JSON.parse(localStorage.getItem('karyl-last-surface')!)).toEqual({ mode: 'g-1', channelId: 'c-guild' });
    });
});
