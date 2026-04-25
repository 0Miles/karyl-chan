import { describe, it, expect, beforeEach } from 'vitest';
import { nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { useSettingsStore } from './settingsStore';

beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
});

describe('settingsStore', () => {
    describe('defaults', () => {
        it('animatedEmojiAutoplay defaults to true', () => {
            const s = useSettingsStore();
            expect(s.animatedEmojiAutoplay).toBe(true);
        });

        it('desktopNotifications defaults to false (opt-in)', () => {
            // Off by default keeps the OS permission popup off the
            // first-paint critical path until the user explicitly asks.
            const s = useSettingsStore();
            expect(s.desktopNotifications).toBe(false);
        });
    });

    describe('persistence', () => {
        it('writes "0"/"1" tokens to localStorage when toggled', async () => {
            const s = useSettingsStore();
            s.animatedEmojiAutoplay = false;
            s.desktopNotifications = true;
            // The watcher fires post-flush, not synchronously — wait
            // a microtask before peeking at localStorage.
            await nextTick();
            expect(localStorage.getItem('karyl-settings:animatedEmojiAutoplay')).toBe('0');
            expect(localStorage.getItem('karyl-settings:desktopNotifications')).toBe('1');
        });

        it('hydrates from localStorage on store creation', () => {
            localStorage.setItem('karyl-settings:animatedEmojiAutoplay', '0');
            localStorage.setItem('karyl-settings:desktopNotifications', '1');
            setActivePinia(createPinia());
            const s = useSettingsStore();
            expect(s.animatedEmojiAutoplay).toBe(false);
            expect(s.desktopNotifications).toBe(true);
        });

        it('falls back to default when stored value is malformed', () => {
            localStorage.setItem('karyl-settings:animatedEmojiAutoplay', 'maybe');
            setActivePinia(createPinia());
            const s = useSettingsStore();
            expect(s.animatedEmojiAutoplay).toBe(true);
        });

        it('round-trips boolean values across store instances', async () => {
            const first = useSettingsStore();
            first.animatedEmojiAutoplay = false;
            await nextTick();
            // Simulate a fresh page load.
            setActivePinia(createPinia());
            const reloaded = useSettingsStore();
            expect(reloaded.animatedEmojiAutoplay).toBe(false);
        });
    });
});
