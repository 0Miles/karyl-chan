import { defineStore } from 'pinia';
import { ref, watch } from 'vue';

/**
 * User-tweakable client preferences. Each value is read from
 * localStorage once at boot, exposed as a reactive ref, and written
 * back via a watcher so callers can mutate without thinking about
 * persistence. Keep this store lean — it's loaded into every page,
 * so any heavy state belongs in a feature-specific store.
 *
 * Add new settings by:
 *   1. Choose a stable storage key (`karyl-settings:<feature>`).
 *   2. Add a ref initialised from `readBool`/`readString`.
 *   3. Register a watcher to persist changes.
 *   4. Return the ref from the store factory.
 */

const STORAGE_PREFIX = 'karyl-settings:';

function readBool(key: string, fallback: boolean): boolean {
    try {
        const raw = localStorage.getItem(STORAGE_PREFIX + key);
        if (raw === '1') return true;
        if (raw === '0') return false;
        return fallback;
    } catch {
        return fallback;
    }
}

function writeBool(key: string, value: boolean): void {
    try {
        localStorage.setItem(STORAGE_PREFIX + key, value ? '1' : '0');
    } catch {
        // ignore quota / disabled storage
    }
}

export const useSettingsStore = defineStore('settings', () => {
    // When false, animated custom emojis (and any other "playable"
    // image asset that respects this flag) are forced to a static
    // frame. Discord's CDN serves a `.webp` still version of every
    // animated emoji, so we just rewrite the URL extension.
    const animatedEmojiAutoplay = ref(readBool('animatedEmojiAutoplay', true));
    watch(animatedEmojiAutoplay, v => writeBool('animatedEmojiAutoplay', v));

    // OS desktop notifications for new DMs and guild mentions when the
    // window isn't focused. Off by default — opt-in keeps us off the
    // permission-popup-on-first-load path. The actual permission prompt
    // happens lazily the first time an enabled user receives a ping.
    const desktopNotifications = ref(readBool('desktopNotifications', false));
    watch(desktopNotifications, v => writeBool('desktopNotifications', v));

    return {
        animatedEmojiAutoplay,
        desktopNotifications
    };
});
