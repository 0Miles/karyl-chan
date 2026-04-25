import { defineStore } from 'pinia';
import { reactive } from 'vue';

/**
 * Per-channel mute state. A muted channel is excluded from the
 * global "attention" indicator and (in tandem with the desktop
 * notification dispatcher) doesn't ping. Sidebar entries also fade so
 * the user has a visual cue.
 *
 * State is persisted to localStorage as a flat string[] of channel
 * ids. We could store it server-side later (so a phone and a laptop
 * see the same mutes), but a single-device default keeps the surface
 * minimal.
 */

const STORAGE_KEY = 'karyl-mutes-v1';
const PERSIST_DEBOUNCE_MS = 200;

function loadIds(): string[] {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === 'string') : [];
    } catch {
        return [];
    }
}

export const useMuteStore = defineStore('discord-mute', () => {
    // reactive Set isn't a thing in Vue, so we keep a reactive lookup
    // map (channelId → true). Slightly more memory than a Set, but
    // dependency tracking on `muted[channelId]` is tighter than a Set
    // membership check would be.
    const muted = reactive<Record<string, true>>({});
    for (const id of loadIds()) muted[id] = true;

    let persistTimer: ReturnType<typeof setTimeout> | null = null;
    function schedulePersist() {
        if (persistTimer) return;
        persistTimer = setTimeout(() => {
            persistTimer = null;
            try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.keys(muted)));
            } catch {
                /* ignore */
            }
        }, PERSIST_DEBOUNCE_MS);
    }

    function isMuted(channelId: string | null | undefined): boolean {
        if (!channelId) return false;
        return !!muted[channelId];
    }

    function setMuted(channelId: string, value: boolean): void {
        if (!channelId) return;
        if (value) {
            if (muted[channelId]) return;
            muted[channelId] = true;
        } else {
            if (!muted[channelId]) return;
            delete muted[channelId];
        }
        schedulePersist();
    }

    function toggle(channelId: string): void {
        setMuted(channelId, !muted[channelId]);
    }

    /** Wipe on sign-out so the next user doesn't inherit mutes. */
    function clear(): void {
        for (const k of Object.keys(muted)) delete muted[k];
        try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    }

    return { muted, isMuted, setMuted, toggle, clear };
});
