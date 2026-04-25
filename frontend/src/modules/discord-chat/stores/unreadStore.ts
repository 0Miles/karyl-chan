import { defineStore } from 'pinia';
import { computed, reactive, ref } from 'vue';
import { useMuteStore } from './muteStore';

// Two-layer unread tracking:
//   counts/mentions — live counters incremented by SSE while the app is open.
//   lastSeen        — per-channel marker (timestamp or snowflake) saved when
//                     the user last viewed a channel. Compared against the
//                     latest marker observed (either from a channel-list
//                     load or a new SSE message) to flag "stale" unreads the
//                     user missed while the app was closed. Stale is a
//                     boolean — we don't know the count without fetching —
//                     so it feeds bold/dot indicators only, not the pill.
// `scope` and `lastSeen` persist; `latest` and `stale` are rebuilt in memory
// from whatever noteLatest/noteMessage calls come in after load.

// v2 bumped when marker format switched from ISO timestamps (which don't
// work against Discord's `messages.fetch({ after })` snowflake filter) to
// message-id snowflakes. Old v1 state is discarded — worst case is one
// round of stale=true on channels the user already saw.
const STORAGE_KEY = 'karyl-unread-state-v2';
const PERSIST_DEBOUNCE_MS = 200;

interface PersistedState {
    counts: Record<string, number>;
    mentions: Record<string, number>;
    scope: Record<string, string>;
    lastSeen: Record<string, string>;
}

function loadState(): PersistedState {
    const empty: PersistedState = { counts: {}, mentions: {}, scope: {}, lastSeen: {} };
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return empty;
        const parsed = JSON.parse(raw) as Partial<PersistedState> | null;
        if (!parsed || typeof parsed !== 'object') return empty;
        const counts = parsed.counts && typeof parsed.counts === 'object' ? parsed.counts : {};
        const mentions = parsed.mentions && typeof parsed.mentions === 'object' ? parsed.mentions : {};
        const scope = parsed.scope && typeof parsed.scope === 'object' ? parsed.scope : {};
        const lastSeen = parsed.lastSeen && typeof parsed.lastSeen === 'object' ? parsed.lastSeen : {};
        return { counts, mentions, scope, lastSeen };
    } catch {
        return empty;
    }
}

// ISO timestamps and fixed-length snowflakes both compare correctly as
// plain strings. Different lengths (e.g. two snowflakes of different
// magnitudes) — longer is newer.
function markerGreater(a: string, b: string): boolean {
    if (a.length !== b.length) return a.length > b.length;
    return a > b;
}

export const useUnreadStore = defineStore('discord-unread', () => {
    const initial = loadState();
    const counts = reactive<Record<string, number>>(initial.counts);
    const mentions = reactive<Record<string, number>>(initial.mentions);
    const scope = reactive<Record<string, string>>(initial.scope);
    const lastSeen = reactive<Record<string, string>>(initial.lastSeen);
    const latest = reactive<Record<string, string>>({});
    const stale = reactive<Record<string, boolean>>({});
    const currentChannelId = ref<string | null>(null);

    let persistTimer: ReturnType<typeof setTimeout> | null = null;
    function schedulePersist() {
        if (persistTimer) return;
        persistTimer = setTimeout(() => {
            persistTimer = null;
            try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify({ counts, mentions, scope, lastSeen }));
            } catch {
                /* storage unavailable */
            }
        }, PERSIST_DEBOUNCE_MS);
    }

    function updateLatest(channelId: string, marker: string): void {
        const existing = latest[channelId];
        if (!existing || markerGreater(marker, existing)) latest[channelId] = marker;
    }

    function noteMessage(channelId: string, mode: string, isMention = false, marker?: string): void {
        if (scope[channelId] !== mode) scope[channelId] = mode;
        if (marker) updateLatest(channelId, marker);
        if (currentChannelId.value === channelId) {
            // Actively viewed: treat as read as it arrives.
            if (marker) lastSeen[channelId] = marker;
            schedulePersist();
            return;
        }
        counts[channelId] = (counts[channelId] ?? 0) + 1;
        if (isMention) mentions[channelId] = (mentions[channelId] ?? 0) + 1;
        if (stale[channelId]) delete stale[channelId];
        schedulePersist();
    }

    /** Called when a channel list or summary reveals the latest marker for
     *  a channel — used to detect stale unreads that accumulated while the
     *  app was closed. */
    function noteLatest(channelId: string, mode: string, marker: string | null): void {
        if (scope[channelId] !== mode) scope[channelId] = mode;
        if (!marker) return;
        updateLatest(channelId, marker);
        if (currentChannelId.value === channelId) {
            lastSeen[channelId] = marker;
            schedulePersist();
            return;
        }
        const seen = lastSeen[channelId];
        if (!seen || markerGreater(marker, seen)) {
            if (!stale[channelId]) stale[channelId] = true;
            schedulePersist();
        }
    }

    /** Apply a server-computed unread count. `preSnapshot` is whatever
     *  counts[channelId] was before the caller kicked off the fetch —
     *  the difference (current - preSnapshot) is SSE that arrived during
     *  the round-trip and must be layered on top of the server number
     *  so concurrent live messages aren't lost. */
    function applyHistoricalCount(channelId: string, mode: string, serverCount: number, preSnapshot: number): void {
        if (scope[channelId] !== mode) scope[channelId] = mode;
        if (serverCount <= 0 || currentChannelId.value === channelId) return;
        const current = counts[channelId] ?? 0;
        const liveDelta = Math.max(0, current - preSnapshot);
        const merged = serverCount + liveDelta;
        if (merged > current) counts[channelId] = merged;
        if (stale[channelId]) delete stale[channelId];
        schedulePersist();
    }

    function markRead(channelId: string): void {
        const hadCount = !!counts[channelId];
        const hadMention = !!mentions[channelId];
        const hadStale = !!stale[channelId];
        const marker = latest[channelId];
        const markerChanged = marker && lastSeen[channelId] !== marker;
        if (!hadCount && !hadMention && !hadStale && !markerChanged) return;
        if (hadCount) delete counts[channelId];
        if (hadMention) delete mentions[channelId];
        if (hadStale) delete stale[channelId];
        if (marker) lastSeen[channelId] = marker;
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

    /** Wipe all state. Called on sign-out so the next user doesn't see
     *  the previous account's unreads. */
    function clear(): void {
        for (const k of Object.keys(counts)) delete counts[k];
        for (const k of Object.keys(mentions)) delete mentions[k];
        for (const k of Object.keys(scope)) delete scope[k];
        for (const k of Object.keys(lastSeen)) delete lastSeen[k];
        for (const k of Object.keys(latest)) delete latest[k];
        for (const k of Object.keys(stale)) delete stale[k];
        try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    }

    function getChannelCount(channelId: string): number {
        return counts[channelId] ?? 0;
    }

    function getChannelMentionCount(channelId: string): number {
        return mentions[channelId] ?? 0;
    }

    function hasChannelUnread(channelId: string): boolean {
        return (counts[channelId] ?? 0) > 0 || !!stale[channelId];
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

    // True when there's anything worth surfacing on the global nav:
    // any DM unread (live or stale) or any guild @-mention. DM channels
    // never populate `mentions` (noteMessage is called with isMention=false
    // for DMs), so a positive mention count implies a guild channel.
    // Muted channels (per muteStore) are excluded — that's the whole
    // point of muting them.
    const muteStore = useMuteStore();
    const hasAttention = computed<boolean>(() => {
        for (const cid in counts) {
            if (counts[cid] > 0 && scope[cid] === 'dm' && !muteStore.isMuted(cid)) return true;
        }
        for (const cid in stale) {
            if (stale[cid] && scope[cid] === 'dm' && !muteStore.isMuted(cid)) return true;
        }
        for (const cid in mentions) {
            if (mentions[cid] > 0 && !muteStore.isMuted(cid)) return true;
        }
        return false;
    });

    return {
        counts,
        mentions,
        scope,
        stale,
        lastSeen,
        currentChannelId,
        hasAttention,
        noteMessage,
        noteLatest,
        applyHistoricalCount,
        markRead,
        setCurrentChannel,
        registerScope,
        clear,
        getChannelCount,
        getChannelMentionCount,
        hasChannelUnread,
        getModeCount,
        getModeMentionCount,
    };
});
