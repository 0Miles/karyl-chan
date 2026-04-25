import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useMessageCacheStore, type ListMessagesFn } from './messageCacheStore';
import type { Message } from '../../../libs/messages';

function msg(id: string, overrides: Partial<Message> = {}): Message {
    return {
        id,
        channelId: 'c-1',
        author: { id: 'u-1', username: 'alice', avatarUrl: null },
        content: `m-${id}`,
        createdAt: '2026-04-25T00:00:00Z',
        ...overrides
    };
}

function makeListFn(byCall: Array<{ messages: Message[]; hasMore: boolean }>): ListMessagesFn {
    let i = 0;
    return vi.fn(async () => byCall[i++]) as unknown as ListMessagesFn;
}

beforeEach(() => {
    setActivePinia(createPinia());
});

describe('get / isLoaded', () => {
    it('returns null/false for an unknown channel', () => {
        const store = useMessageCacheStore();
        expect(store.get('nope')).toBeNull();
        expect(store.isLoaded('nope')).toBe(false);
    });

    it('returns null when channelId is null/undefined', () => {
        const store = useMessageCacheStore();
        expect(store.get(null)).toBeNull();
        expect(store.isLoaded(undefined)).toBe(false);
    });
});

describe('ensureLoaded', () => {
    it('loads the initial page once', async () => {
        const store = useMessageCacheStore();
        const listFn = makeListFn([{ messages: [msg('1'), msg('2')], hasMore: true }]);
        await store.ensureLoaded('c-1', listFn);
        expect(store.get('c-1')?.messages.map(m => m.id)).toEqual(['1', '2']);
        expect(store.get('c-1')?.hasMore).toBe(true);
        expect(store.isLoaded('c-1')).toBe(true);
        expect(listFn).toHaveBeenCalledTimes(1);
    });

    it('is idempotent — second call is a no-op', async () => {
        const store = useMessageCacheStore();
        const listFn = makeListFn([{ messages: [msg('1')], hasMore: false }]);
        await store.ensureLoaded('c-1', listFn);
        await store.ensureLoaded('c-1', listFn);
        expect(listFn).toHaveBeenCalledTimes(1);
    });

    it('coalesces concurrent calls to a single fetch', async () => {
        const store = useMessageCacheStore();
        const listFn = vi.fn(() => new Promise<{ messages: Message[]; hasMore: boolean }>(resolve =>
            setTimeout(() => resolve({ messages: [msg('1')], hasMore: false }), 0)
        )) as unknown as ListMessagesFn;
        await Promise.all([
            store.ensureLoaded('c-1', listFn),
            store.ensureLoaded('c-1', listFn)
        ]);
        // Second caller saw `loadingInitial` true and bailed out.
        expect(listFn).toHaveBeenCalledTimes(1);
    });
});

describe('loadOlder', () => {
    it('prepends older messages and updates hasMore', async () => {
        const store = useMessageCacheStore();
        await store.ensureLoaded('c-1', makeListFn([
            { messages: [msg('5'), msg('6')], hasMore: true }
        ]));
        await store.loadOlder('c-1', makeListFn([
            { messages: [msg('3'), msg('4')], hasMore: false }
        ]));
        expect(store.get('c-1')?.messages.map(m => m.id)).toEqual(['3', '4', '5', '6']);
        expect(store.get('c-1')?.hasMore).toBe(false);
    });

    it('is a no-op when hasMore is false', async () => {
        const store = useMessageCacheStore();
        await store.ensureLoaded('c-1', makeListFn([
            { messages: [msg('1')], hasMore: false }
        ]));
        const listFn = vi.fn() as unknown as ListMessagesFn;
        await store.loadOlder('c-1', listFn);
        expect(listFn).not.toHaveBeenCalled();
    });

    it('flips hasMore false when the older page returns nothing', async () => {
        const store = useMessageCacheStore();
        await store.ensureLoaded('c-1', makeListFn([
            { messages: [msg('1')], hasMore: true }
        ]));
        await store.loadOlder('c-1', makeListFn([{ messages: [], hasMore: false }]));
        expect(store.get('c-1')?.hasMore).toBe(false);
    });

    it('is a no-op before the channel is loaded', async () => {
        const store = useMessageCacheStore();
        const listFn = vi.fn() as unknown as ListMessagesFn;
        await store.loadOlder('c-1', listFn);
        expect(listFn).not.toHaveBeenCalled();
    });
});

describe('loadAround', () => {
    it('replaces the cached batch with an around-window centred on the target', async () => {
        const store = useMessageCacheStore();
        await store.ensureLoaded('c-1', makeListFn([
            { messages: [msg('99'), msg('100')], hasMore: true }
        ]));
        await store.loadAround('c-1', '50', makeListFn([{
            messages: Array.from({ length: 32 }, (_, i) => msg(String(40 + i))),
            hasMore: true
        }]));
        expect(store.get('c-1')?.messages[0].id).toBe('40');
        // Full-window fetch → conservatively flag "may be older".
        expect(store.get('c-1')?.hasMore).toBe(true);
    });

    it('skips the fetch when the anchor is already in cache', async () => {
        const store = useMessageCacheStore();
        await store.ensureLoaded('c-1', makeListFn([
            { messages: [msg('1'), msg('2'), msg('3')], hasMore: true }
        ]));
        const listFn = vi.fn() as unknown as ListMessagesFn;
        await store.loadAround('c-1', '2', listFn);
        expect(listFn).not.toHaveBeenCalled();
    });
});

describe('applyEvent', () => {
    it('appends a new message on message-created', async () => {
        const store = useMessageCacheStore();
        await store.ensureLoaded('c-1', makeListFn([
            { messages: [msg('1')], hasMore: false }
        ]));
        store.applyEvent({ type: 'message-created', channelId: 'c-1', message: msg('2') });
        expect(store.get('c-1')?.messages.map(m => m.id)).toEqual(['1', '2']);
    });

    it('does not double-insert the same id', async () => {
        const store = useMessageCacheStore();
        await store.ensureLoaded('c-1', makeListFn([
            { messages: [msg('1')], hasMore: false }
        ]));
        store.applyEvent({ type: 'message-created', channelId: 'c-1', message: msg('1') });
        expect(store.get('c-1')?.messages).toHaveLength(1);
    });

    it('replaces an existing message on message-updated', async () => {
        const store = useMessageCacheStore();
        await store.ensureLoaded('c-1', makeListFn([
            { messages: [msg('1', { content: 'old' })], hasMore: false }
        ]));
        store.applyEvent({
            type: 'message-updated',
            channelId: 'c-1',
            message: msg('1', { content: 'new' })
        });
        expect(store.get('c-1')?.messages[0].content).toBe('new');
    });

    it('removes a message on message-deleted', async () => {
        const store = useMessageCacheStore();
        await store.ensureLoaded('c-1', makeListFn([
            { messages: [msg('1'), msg('2')], hasMore: false }
        ]));
        store.applyEvent({ type: 'message-deleted', channelId: 'c-1', messageId: '1' });
        expect(store.get('c-1')?.messages.map(m => m.id)).toEqual(['2']);
    });

    it('ignores events for an unloaded channel', () => {
        const store = useMessageCacheStore();
        store.applyEvent({ type: 'message-created', channelId: 'unloaded', message: msg('1') });
        expect(store.get('unloaded')).toBeNull();
    });
});

describe('applyReactionDelta', () => {
    it('adds a fresh reaction with count 1, me=true', async () => {
        const store = useMessageCacheStore();
        await store.ensureLoaded('c-1', makeListFn([
            { messages: [msg('1')], hasMore: false }
        ]));
        store.applyReactionDelta('c-1', '1', { id: null, name: '👍' }, 1);
        const r = store.get('c-1')!.messages[0].reactions!;
        expect(r).toEqual([{ emoji: { id: null, name: '👍' }, count: 1, me: true }]);
    });

    it('drops a reaction whose count goes to zero', async () => {
        const store = useMessageCacheStore();
        await store.ensureLoaded('c-1', makeListFn([
            { messages: [msg('1', { reactions: [{ emoji: { id: null, name: '👍' }, count: 1, me: true }] })], hasMore: false }
        ]));
        store.applyReactionDelta('c-1', '1', { id: null, name: '👍' }, -1);
        expect(store.get('c-1')!.messages[0].reactions).toEqual([]);
    });

    it('matches custom emoji by id when present', async () => {
        const store = useMessageCacheStore();
        await store.ensureLoaded('c-1', makeListFn([
            { messages: [msg('1', { reactions: [{ emoji: { id: 'e-1', name: 'wave' }, count: 1, me: false }] })], hasMore: false }
        ]));
        // Same id but different name — should still match the entry.
        store.applyReactionDelta('c-1', '1', { id: 'e-1', name: 'different' }, 1);
        const r = store.get('c-1')!.messages[0].reactions!;
        expect(r).toHaveLength(1);
        expect(r[0].count).toBe(2);
    });

    it('does not match a unicode emoji against a custom emoji of same name', async () => {
        const store = useMessageCacheStore();
        await store.ensureLoaded('c-1', makeListFn([
            { messages: [msg('1', { reactions: [{ emoji: { id: 'e-1', name: 'thumbs' }, count: 1, me: false }] })], hasMore: false }
        ]));
        store.applyReactionDelta('c-1', '1', { id: null, name: 'thumbs' }, 1);
        // Two distinct entries — id-vs-no-id rules out a match.
        expect(store.get('c-1')!.messages[0].reactions).toHaveLength(2);
    });

    it('is a no-op for an unknown channel', () => {
        const store = useMessageCacheStore();
        store.applyReactionDelta('nope', '1', { id: null, name: '👍' }, 1);
        // No throw, no entry created.
        expect(store.get('nope')).toBeNull();
    });
});

describe('scroll position', () => {
    it('saves and reads back a position', () => {
        const store = useMessageCacheStore();
        store.saveScrollPosition('c-1', { messageId: 'm-5', offset: 12 });
        expect(store.getScrollPosition('c-1')).toEqual({ messageId: 'm-5', offset: 12 });
    });

    it('returns null when nothing was saved', () => {
        const store = useMessageCacheStore();
        expect(store.getScrollPosition('c-1')).toBeNull();
    });

    it('clears a saved position when given null', () => {
        const store = useMessageCacheStore();
        store.saveScrollPosition('c-1', { messageId: 'm-5', offset: 12 });
        store.saveScrollPosition('c-1', null);
        expect(store.getScrollPosition('c-1')).toBeNull();
    });

    it('evicts the oldest anchor when the cap is reached', () => {
        const store = useMessageCacheStore();
        // Cap is 100; insert 101 distinct channels and verify the first was dropped.
        for (let i = 0; i < 101; i++) {
            store.saveScrollPosition(`c-${i}`, { messageId: 'm', offset: i });
        }
        expect(store.getScrollPosition('c-0')).toBeNull();
        expect(store.getScrollPosition('c-100')).not.toBeNull();
    });
});
