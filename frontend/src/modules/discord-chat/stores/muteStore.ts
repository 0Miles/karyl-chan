import { defineStore } from 'pinia';
import { reactive } from 'vue';

/**
 * Per-channel mute level. Three states modelled after Discord:
 *   'all'           — default, no mute (channel not in the map).
 *   'mentions-only' — sidebar fades, unread pill suppressed, but
 *                     @mentions still light it up and notify.
 *   'none'          — completely silent: no unread surface, no
 *                     desktop ping, even on a direct mention.
 *
 * State persists to localStorage as `Record<channelId, MuteLevel>`.
 * `isMuted` returns true for either silenced level so existing
 * callers (sidebar fade, dot suppression) keep working without
 * changes; finer-grained checks call `getLevel` directly.
 */

export type MuteLevel = 'mentions-only' | 'none';

const STORAGE_KEY = 'karyl-mutes-v2';
const PERSIST_DEBOUNCE_MS = 200;

function loadInitial(): Record<string, MuteLevel> {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            const out: Record<string, MuteLevel> = {};
            if (parsed && typeof parsed === 'object') {
                for (const [k, v] of Object.entries(parsed)) {
                    if (v === 'mentions-only' || v === 'none') out[k] = v;
                }
            }
            return out;
        }
        // Migration from v1 (flat string[] of muted ids → level 'none').
        const v1 = localStorage.getItem('karyl-mutes-v1');
        if (v1) {
            const arr = JSON.parse(v1);
            const out: Record<string, MuteLevel> = {};
            if (Array.isArray(arr)) for (const id of arr) {
                if (typeof id === 'string') out[id] = 'none';
            }
            return out;
        }
    } catch { /* ignore */ }
    return {};
}

export const useMuteStore = defineStore('discord-mute', () => {
    const levels = reactive<Record<string, MuteLevel>>(loadInitial());

    let persistTimer: ReturnType<typeof setTimeout> | null = null;
    function schedulePersist() {
        if (persistTimer) return;
        persistTimer = setTimeout(() => {
            persistTimer = null;
            try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(levels));
            } catch { /* ignore */ }
        }, PERSIST_DEBOUNCE_MS);
    }

    function getLevel(channelId: string | null | undefined): MuteLevel | 'all' {
        if (!channelId) return 'all';
        return levels[channelId] ?? 'all';
    }

    function isMuted(channelId: string | null | undefined): boolean {
        return getLevel(channelId) !== 'all';
    }

    /** True when an unread COUNT (live or stale, ignoring mention-ness)
     *  should still surface for this channel. False for both
     *  'mentions-only' (counts hidden, only mentions surface) and
     *  'none' (silenced entirely). */
    function showsCount(channelId: string | null | undefined): boolean {
        return getLevel(channelId) === 'all';
    }

    /** True when an @mention should still highlight / notify. False
     *  only for 'none' (full silence). */
    function showsMention(channelId: string | null | undefined): boolean {
        return getLevel(channelId) !== 'none';
    }

    function setLevel(channelId: string, level: MuteLevel | 'all'): void {
        if (!channelId) return;
        if (level === 'all') {
            if (!(channelId in levels)) return;
            delete levels[channelId];
        } else {
            if (levels[channelId] === level) return;
            levels[channelId] = level;
        }
        schedulePersist();
    }

    /** Cycle through all → mentions-only → none → all. Used by the
     *  conversation header bell toggle so a single tap advances state
     *  predictably without an explicit picker. */
    function cycle(channelId: string): void {
        const current = getLevel(channelId);
        if (current === 'all') setLevel(channelId, 'mentions-only');
        else if (current === 'mentions-only') setLevel(channelId, 'none');
        else setLevel(channelId, 'all');
    }

    function clear(): void {
        for (const k of Object.keys(levels)) delete levels[k];
        try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    }

    return { levels, isMuted, getLevel, showsCount, showsMention, setLevel, cycle, clear };
});
