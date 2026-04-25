import { describe, it, expect, beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { markerGreater, useUnreadStore } from './unreadStore';
import { useMuteStore } from './muteStore';

beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
});

describe('markerGreater', () => {
    it('compares same-length markers lexicographically', () => {
        expect(markerGreater('100000000000000002', '100000000000000001')).toBe(true);
        expect(markerGreater('100000000000000001', '100000000000000002')).toBe(false);
    });

    it('treats a longer marker as newer', () => {
        // Real Discord snowflakes are fixed length, but ISO timestamps
        // and the legacy v1 format can vary — the comparator is
        // length-aware so we don't accidentally rank a shorter newer
        // string as older.
        expect(markerGreater('1000000000000000000', '999999999999999999')).toBe(true);
    });

    it('returns false on equal markers', () => {
        expect(markerGreater('123', '123')).toBe(false);
    });
});

describe('unreadStore.noteMessage', () => {
    it('increments count and notes scope for a non-current channel', () => {
        const u = useUnreadStore();
        u.noteMessage('c-1', 'dm', false, '600000000000000001');
        expect(u.getChannelCount('c-1')).toBe(1);
        expect(u.scope['c-1']).toBe('dm');
    });

    it('treats a mention separately from the regular count', () => {
        const u = useUnreadStore();
        u.noteMessage('c-1', 'guild-id', true, '600000000000000001');
        expect(u.getChannelCount('c-1')).toBe(1);
        expect(u.getChannelMentionCount('c-1')).toBe(1);
    });

    it('marks the message as read instantly when the channel is current', () => {
        const u = useUnreadStore();
        u.setCurrentChannel('c-1');
        u.noteMessage('c-1', 'dm', false, '600000000000000001');
        // Active channel: lastSeen advances, count stays at 0.
        expect(u.getChannelCount('c-1')).toBe(0);
        expect(u.lastSeen['c-1']).toBe('600000000000000001');
    });
});

describe('unreadStore.noteLatest (stale flag)', () => {
    it('flips stale when a fresh marker outpaces lastSeen', () => {
        const u = useUnreadStore();
        // The user has seen up to id …01 historically.
        u.noteMessage('c-1', 'dm', false, '600000000000000001');
        u.setCurrentChannel('c-1'); // marks read
        u.setCurrentChannel(null);
        // A channel-list refresh reveals a newer message id …02.
        u.noteLatest('c-1', 'dm', '600000000000000002');
        expect(u.stale['c-1']).toBe(true);
    });

    it('does not flip stale when the latest is older than lastSeen', () => {
        const u = useUnreadStore();
        u.noteMessage('c-1', 'dm', false, '600000000000000005');
        u.setCurrentChannel('c-1');
        u.setCurrentChannel(null);
        u.noteLatest('c-1', 'dm', '600000000000000003');
        expect(u.stale['c-1']).toBeFalsy();
    });
});

describe('unreadStore.hasAttention with mute interaction', () => {
    it('lights up on a DM unread', () => {
        const u = useUnreadStore();
        u.noteMessage('c-1', 'dm', false, '600000000000000001');
        expect(u.hasAttention).toBe(true);
    });

    it('skips muted ("none") DM channels', () => {
        const m = useMuteStore();
        const u = useUnreadStore();
        m.setLevel('c-1', 'none');
        u.noteMessage('c-1', 'dm', false, '600000000000000001');
        expect(u.hasAttention).toBe(false);
    });

    it('skips "mentions-only" DMs that arrived without a mention', () => {
        const m = useMuteStore();
        const u = useUnreadStore();
        m.setLevel('c-1', 'mentions-only');
        u.noteMessage('c-1', 'dm', false, '600000000000000001');
        expect(u.hasAttention).toBe(false);
    });

    it('lights up on a guild mention even when the channel is muted "mentions-only"', () => {
        const m = useMuteStore();
        const u = useUnreadStore();
        m.setLevel('c-1', 'mentions-only');
        u.noteMessage('c-1', 'guild-id', /* isMention */ true, '600000000000000001');
        expect(u.hasAttention).toBe(true);
    });

    it('skips a mention when the channel is fully muted ("none")', () => {
        const m = useMuteStore();
        const u = useUnreadStore();
        m.setLevel('c-1', 'none');
        u.noteMessage('c-1', 'guild-id', true, '600000000000000001');
        expect(u.hasAttention).toBe(false);
    });
});

describe('unreadStore divider snapshot', () => {
    it('captures lastSeen at the moment a channel becomes current', () => {
        const u = useUnreadStore();
        u.noteMessage('c-1', 'dm', false, '600000000000000001');
        u.setCurrentChannel('c-1'); // mark-read advances lastSeen to …01
        u.setCurrentChannel(null);
        u.noteMessage('c-1', 'dm', false, '600000000000000002');
        // Re-entering: divider should snapshot the OLD lastSeen
        // (…01) BEFORE markRead bumps it to …02.
        u.setCurrentChannel('c-1');
        expect(u.getDividerMarker('c-1')).toBe('600000000000000001');
    });

    it('returns null divider when the channel was never visited', () => {
        const u = useUnreadStore();
        u.noteMessage('c-1', 'dm', false, '600000000000000001');
        u.setCurrentChannel('c-1');
        expect(u.getDividerMarker('c-1')).toBeNull();
    });
});

describe('unreadStore.markUnreadFrom', () => {
    it('sets lastSeen to the predecessor and stubs a count so the sidebar lights up', () => {
        const u = useUnreadStore();
        u.markUnreadFrom('c-1', '600000000000000004');
        expect(u.lastSeen['c-1']).toBe('600000000000000004');
        expect(u.getChannelCount('c-1')).toBeGreaterThan(0);
    });

    it('null predecessor wipes lastSeen entirely (every message becomes unread)', () => {
        const u = useUnreadStore();
        u.lastSeen['c-1'] = '600000000000000010';
        u.markUnreadFrom('c-1', null);
        expect(u.lastSeen['c-1']).toBeUndefined();
    });

    it('clears currentChannelId so the next entry re-anchors the divider', () => {
        const u = useUnreadStore();
        u.setCurrentChannel('c-1');
        expect(u.currentChannelId).toBe('c-1');
        u.markUnreadFrom('c-1', '600000000000000004');
        expect(u.currentChannelId).toBeNull();
    });
});

describe('unreadStore.clear', () => {
    it('drops every map and removes the persisted blob', () => {
        const u = useUnreadStore();
        u.noteMessage('c-1', 'dm', false, '600000000000000001');
        u.lastSeen['c-2'] = '600000000000000002';
        u.clear();
        expect(u.getChannelCount('c-1')).toBe(0);
        expect(u.lastSeen['c-2']).toBeUndefined();
        // Storage key from the source: 'karyl-unread-state-v2'.
        expect(localStorage.getItem('karyl-unread-state-v2')).toBeNull();
    });
});
