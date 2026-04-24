import { defineStore } from 'pinia';
import { computed, reactive, ref } from 'vue';

// "Unread" here means "an SSE event arrived while the app was open and
// this channel wasn't being viewed" — we don't reconstruct history the
// user missed while the app was closed. `scope` is persisted alongside
// counts so ModeSelect can still light up a guild's dot on reload
// before the user has mounted that guild's workspace (the scope map
// would otherwise be empty until its useUnreadSync re-registers).
//
// `mentions` is a separate counter for @-mentions of the bot so guild
// surfaces can show the Discord-style "attention-worthy" count while
// still tracking every unread message for the bold-channel highlight.

const STORAGE_KEY = 'karyl-unread-state';
const PERSIST_DEBOUNCE_MS = 200;

interface PersistedState {
    counts: Record<string, number>;
    mentions: Record<string, number>;
    scope: Record<string, string>;
}

function loadState(): PersistedState {
    const empty: PersistedState = { counts: {}, mentions: {}, scope: {} };
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return empty;
        const parsed = JSON.parse(raw) as Partial<PersistedState> | null;
        if (!parsed || typeof parsed !== 'object') return empty;
        const counts = parsed.counts && typeof parsed.counts === 'object' ? parsed.counts : {};
        const mentions = parsed.mentions && typeof parsed.mentions === 'object' ? parsed.mentions : {};
        const scope = parsed.scope && typeof parsed.scope === 'object' ? parsed.scope : {};
        return { counts, mentions, scope };
    } catch {
        return empty;
    }
}

export const useUnreadStore = defineStore('discord-unread', () => {
    const initial = loadState();
    const counts = reactive<Record<string, number>>(initial.counts);
    const mentions = reactive<Record<string, number>>(initial.mentions);
    const scope = reactive<Record<string, string>>(initial.scope);
    const currentChannelId = ref<string | null>(null);

    let persistTimer: ReturnType<typeof setTimeout> | null = null;
    function schedulePersist() {
        if (persistTimer) return;
        persistTimer = setTimeout(() => {
            persistTimer = null;
            try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify({ counts, mentions, scope }));
            } catch {
                /* storage unavailable */
            }
        }, PERSIST_DEBOUNCE_MS);
    }

    function noteMessage(channelId: string, mode: string, isMention = false): void {
        if (scope[channelId] !== mode) scope[channelId] = mode;
        if (currentChannelId.value === channelId) return;
        counts[channelId] = (counts[channelId] ?? 0) + 1;
        if (isMention) mentions[channelId] = (mentions[channelId] ?? 0) + 1;
        schedulePersist();
    }

    function markRead(channelId: string): void {
        const hadCount = !!counts[channelId];
        const hadMention = !!mentions[channelId];
        if (!hadCount && !hadMention) return;
        if (hadCount) delete counts[channelId];
        if (hadMention) delete mentions[channelId];
        schedulePersist();
    }

    function setCurrentChannel(channelId: string | null): void {
        currentChannelId.value = channelId;
        if (channelId) markRead(channelId);
    }

    function registerScope(channelId: string, mode: string): void {
        if (scope[channelId] === mode) return;
        scope[channelId] = mode;
        schedulePersist();
    }

    function getChannelCount(channelId: string): number {
        return counts[channelId] ?? 0;
    }

    function getChannelMentionCount(channelId: string): number {
        return mentions[channelId] ?? 0;
    }

    function sumForMode(map: Record<string, number>, mode: string): number {
        let total = 0;
        for (const [cid, cnt] of Object.entries(map)) {
            if (cnt > 0 && scope[cid] === mode) total += cnt;
        }
        return total;
    }

    function getModeCount(mode: string): number {
        return sumForMode(counts, mode);
    }

    function getModeMentionCount(mode: string): number {
        return sumForMode(mentions, mode);
    }

    const modesWithUnread = computed<Set<string>>(() => {
        const set = new Set<string>();
        for (const [cid, cnt] of Object.entries(counts)) {
            if (cnt <= 0) continue;
            const mode = scope[cid];
            if (mode) set.add(mode);
        }
        return set;
    });

    // True when there's anything worth surfacing on the global nav:
    // any DM unread or any guild @-mention. DM channels never populate
    // `mentions` (noteMessage is called with isMention=false for DMs),
    // so a positive mention count implies a guild channel.
    const hasAttention = computed<boolean>(() => {
        for (const cid in counts) {
            if (counts[cid] > 0 && scope[cid] === 'dm') return true;
        }
        for (const cid in mentions) {
            if (mentions[cid] > 0) return true;
        }
        return false;
    });

    return {
        counts,
        mentions,
        scope,
        currentChannelId,
        modesWithUnread,
        hasAttention,
        noteMessage,
        markRead,
        setCurrentChannel,
        registerScope,
        getChannelCount,
        getChannelMentionCount,
        getModeCount,
        getModeMentionCount,
    };
});
