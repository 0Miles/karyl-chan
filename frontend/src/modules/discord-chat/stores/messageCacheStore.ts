import { defineStore } from 'pinia';
import { reactive } from 'vue';
import type { Message, MessageEmoji } from '../../../libs/messages';

// Shared event type: used by both DM and guild SSE handlers.
export type ChannelMessageEvent =
    | { type: 'message-created'; channelId: string; message: Message }
    | { type: 'message-updated'; channelId: string; message: Message }
    | { type: 'message-deleted'; channelId: string; messageId: string };

export type ListMessagesFn = (
    channelId: string,
    opts: { limit?: number; before?: string; around?: string }
) => Promise<{ messages: Message[]; hasMore: boolean }>;

const PAGE_SIZE = 16;

export interface ChannelEntry {
    messages: Message[];
    hasMore: boolean;
    loaded: boolean;
    loadingInitial: boolean;
    loadingOlder: boolean;
}

export interface ScrollPosition {
    /** Topmost-visible message id when the user left the channel. */
    messageId: string;
    /** Pixel offset from the container top to the anchor's top edge. */
    offset: number;
}

function emojiMatches(a: MessageEmoji, b: MessageEmoji): boolean {
    if (a.id || b.id) return a.id === b.id;
    return a.name === b.name;
}

const MAX_SCROLL_ANCHORS = 100;

export const useMessageCacheStore = defineStore('discord-message-cache', () => {
    const entries = reactive<Record<string, ChannelEntry>>({});

    /**
     * Per-channel scroll position. Records the topmost visible message and
     * its pixel offset from the container top so returning to the channel
     * can restore the exact view. Absence means "scroll to bottom" on return.
     */
    const scrollPositions = reactive<Record<string, ScrollPosition>>({});

    function saveScrollPosition(channelId: string, pos: ScrollPosition | null): void {
        if (pos === null) {
            delete scrollPositions[channelId];
            return;
        }
        if (!(channelId in scrollPositions) && Object.keys(scrollPositions).length >= MAX_SCROLL_ANCHORS) {
            delete scrollPositions[Object.keys(scrollPositions)[0]];
        }
        scrollPositions[channelId] = pos;
    }

    function getScrollPosition(channelId: string): ScrollPosition | null {
        return scrollPositions[channelId] ?? null;
    }

    function getOrCreate(channelId: string): ChannelEntry {
        if (!entries[channelId]) {
            entries[channelId] = {
                messages: [],
                hasMore: false,
                loaded: false,
                loadingInitial: false,
                loadingOlder: false
            };
        }
        return entries[channelId];
    }

    function get(channelId: string | null | undefined): ChannelEntry | null {
        if (!channelId) return null;
        return entries[channelId] ?? null;
    }

    function isLoaded(channelId: string | null | undefined): boolean {
        return channelId ? (entries[channelId]?.loaded ?? false) : false;
    }

    async function ensureLoaded(channelId: string, listFn: ListMessagesFn): Promise<void> {
        const entry = getOrCreate(channelId);
        if (entry.loaded || entry.loadingInitial) return;
        entry.loadingInitial = true;
        try {
            const result = await listFn(channelId, { limit: PAGE_SIZE });
            entry.messages = result.messages;
            entry.hasMore = result.hasMore;
            entry.loaded = true;
        } finally {
            entry.loadingInitial = false;
        }
    }

    async function loadOlder(channelId: string, listFn: ListMessagesFn): Promise<void> {
        const entry = entries[channelId];
        if (!entry?.loaded || entry.loadingOlder || !entry.hasMore || entry.messages.length === 0) return;
        entry.loadingOlder = true;
        try {
            const result = await listFn(channelId, { limit: PAGE_SIZE, before: entry.messages[0].id });
            if (result.messages.length === 0) { entry.hasMore = false; return; }
            entry.messages = [...result.messages, ...entry.messages];
            entry.hasMore = result.hasMore;
        } finally {
            entry.loadingOlder = false;
        }
    }

    /**
     * Fetch a window of messages centred on `messageId` and replace the
     * channel's cached batch so a UI jump can land on the anchor. Used
     * by message-link clicks where the target is typically older than
     * anything the default PAGE_SIZE load would have fetched. Skips if
     * the anchor is already in the cache to avoid throwing away context.
     */
    async function loadAround(channelId: string, messageId: string, listFn: ListMessagesFn): Promise<void> {
        const entry = getOrCreate(channelId);
        if (entry.loadingInitial || entry.loadingOlder) return;
        if (entry.loaded && entry.messages.some(m => m.id === messageId)) return;
        entry.loadingInitial = true;
        try {
            const result = await listFn(channelId, { limit: PAGE_SIZE * 2, around: messageId });
            entry.messages = result.messages;
            // `around` windows have older content on both sides but the
            // backend doesn't tell us whether more remain below the
            // anchor; we conservatively flag there may be older (so
            // `loadOlder` stays usable) and leave newer-side gap for a
            // future enhancement.
            entry.hasMore = result.messages.length === PAGE_SIZE * 2;
            entry.loaded = true;
        } finally {
            entry.loadingInitial = false;
        }
    }

    function applyEvent(event: ChannelMessageEvent): void {
        const entry = entries[event.channelId];
        if (!entry?.loaded) return;
        if (event.type === 'message-created') {
            if (entry.messages.some(m => m.id === event.message.id)) return;
            entry.messages = [...entry.messages, event.message];
        } else if (event.type === 'message-updated') {
            entry.messages = entry.messages.map(m =>
                m.id === event.message.id ? event.message : m
            );
        } else if (event.type === 'message-deleted') {
            entry.messages = entry.messages.filter(m => m.id !== event.messageId);
        }
    }

    function applyReactionDelta(channelId: string, messageId: string, emoji: MessageEmoji, delta: 1 | -1): void {
        const entry = entries[channelId];
        if (!entry) return;
        entry.messages = entry.messages.map(m => {
            if (m.id !== messageId) return m;
            const existing = m.reactions ?? [];
            let found = false;
            const updated = existing.map(r => {
                if (!emojiMatches(r.emoji, emoji)) return r;
                found = true;
                return { ...r, count: Math.max(0, r.count + delta), me: delta > 0 };
            }).filter(r => r.count > 0);
            if (!found && delta > 0) updated.push({ emoji, count: 1, me: true });
            return { ...m, reactions: updated };
        });
    }

    return {
        entries,
        get,
        isLoaded,
        ensureLoaded,
        loadOlder,
        loadAround,
        applyEvent,
        applyReactionDelta,
        saveScrollPosition,
        getScrollPosition
    };
});
