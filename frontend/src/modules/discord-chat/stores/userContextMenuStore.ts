import { defineStore } from 'pinia';
import { ref } from 'vue';

export interface VoiceContextOptions {
    /** The voice/stage channel the user is currently connected to. */
    channelId: string;
    /** Current voice-state flags from the cached member row, so the
     *  menu can toggle "Server mute" → "Server un-mute" without an
     *  extra fetch. We don't track these on the bare member row yet,
     *  so they're optional and the menu falls back to a single
     *  "Server mute" / "Server deafen" action that the backend treats
     *  idempotently. */
    serverMuted?: boolean;
    serverDeafened?: boolean;
}

export interface UserContextMenuTarget {
    userId: string;
    /** Used to anchor the user-card popover when the user picks
     *  "Open profile" — anchored beside the click position. */
    anchor: HTMLElement;
    x: number;
    y: number;
    /** Guild context the click happened in. Required for guild-only
     *  actions (mention copy, voice ops); null for DM surfaces. */
    guildId: string | null;
    /** Display name the menu can use for the header / Send DM
     *  fallback when the profile cache hasn't populated yet. */
    displayName: string | null;
    /** Set when the right-click happened on a voice-channel member
     *  row — unlocks the voice-only actions (mute / deafen / move /
     *  disconnect). */
    voice?: VoiceContextOptions;
}

/**
 * Single-slot store for the active user context menu. Mirrors
 * `userProfileStore` so multiple call sites (message rows, mention
 * chips, sidebar voice members) can pop the same menu without
 * coordinating prop drilling.
 */
export const useUserContextMenuStore = defineStore('discord-user-ctx-menu', () => {
    const target = ref<UserContextMenuTarget | null>(null);

    function open(t: UserContextMenuTarget): void {
        target.value = t;
    }

    function close(): void {
        target.value = null;
    }

    return { target, open, close };
});
