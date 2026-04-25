import { defineStore } from 'pinia';
import { reactive } from 'vue';

/**
 * Live "X is typing…" registry. Discord's gateway emits a typingStart
 * event but never explicitly cancels — typing indicators expire on
 * their own after ~10 seconds. We mirror that here by stamping the
 * arrival time and lazily filtering out stale entries on every read,
 * so the store doesn't grow unbounded if a user starts typing then
 * disconnects without sending.
 */

const TYPING_TTL_MS = 10_000;

interface TypingEntry {
    userId: string;
    userName: string;
    /** Wall-clock receipt time on this client. We don't trust the
     *  Discord-supplied `startedAt` because clock skew between the
     *  bot's host and the browser could mark a fresh event "stale". */
    receivedAt: number;
}

export const useTypingStore = defineStore('discord-typing', () => {
    // channelId → userId → entry. Nested so we can prune one channel's
    // typers without scanning the whole flat list.
    const byChannel = reactive<Record<string, Record<string, TypingEntry>>>({});

    function note(channelId: string, userId: string, userName: string): void {
        if (!byChannel[channelId]) byChannel[channelId] = {};
        byChannel[channelId][userId] = { userId, userName, receivedAt: Date.now() };
    }

    function activeIn(channelId: string): TypingEntry[] {
        const entries = byChannel[channelId];
        if (!entries) return [];
        const now = Date.now();
        const fresh: TypingEntry[] = [];
        for (const id of Object.keys(entries)) {
            const entry = entries[id];
            if (now - entry.receivedAt > TYPING_TTL_MS) {
                delete entries[id];
                continue;
            }
            fresh.push(entry);
        }
        return fresh;
    }

    function clear(): void {
        for (const k of Object.keys(byChannel)) delete byChannel[k];
    }

    return { byChannel, note, activeIn, clear };
});
