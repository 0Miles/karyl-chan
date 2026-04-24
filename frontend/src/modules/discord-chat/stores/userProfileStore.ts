import { defineStore } from 'pinia';
import { ref, shallowRef } from 'vue';
import { authedFetch, ApiError } from '../../../api/client';

export interface DiscordUserProfile {
    id: string;
    username: string;
    globalName: string | null;
    discriminator: string | null;
    avatarUrl: string;
    bannerUrl: string | null;
    accentColor: number | null;
    bot: boolean;
}

export interface DiscordGuildRole {
    id: string;
    name: string;
    color: string | null;
    position: number;
}

export interface DiscordGuildMember {
    nickname: string | null;
    joinedAt: string | null;
    roles: DiscordGuildRole[];
}

export interface DiscordUserView {
    user: DiscordUserProfile;
    member: DiscordGuildMember | null;
}

const TTL_MS = 5 * 60 * 1000;

/**
 * Cache for profile lookups plus a single "which card is open right now"
 * slot for the DiscordUserCardPopover the conversation renders.
 *
 * Cache key is `<userId>@<guildId|->` so the same user viewed in two
 * different guilds doesn't collide — guild roles differ per guild.
 */
export const useUserProfileStore = defineStore('discord-user-profile', () => {
    const cache = shallowRef<Map<string, { value: DiscordUserView; expiresAt: number }>>(new Map());
    const inflight = new Map<string, Promise<DiscordUserView>>();

    function keyFor(userId: string, guildId: string | null): string {
        return `${userId}@${guildId ?? '-'}`;
    }

    function readCached(userId: string, guildId: string | null, now = Date.now()): DiscordUserView | null {
        const entry = cache.value.get(keyFor(userId, guildId));
        if (!entry) return null;
        if (entry.expiresAt <= now) return null;
        return entry.value;
    }

    async function fetchUser(userId: string, guildId: string | null): Promise<DiscordUserView> {
        const now = Date.now();
        const cached = readCached(userId, guildId, now);
        if (cached) return cached;
        const key = keyFor(userId, guildId);
        const pending = inflight.get(key);
        if (pending) return pending;

        const url = guildId
            ? `/api/discord/users/${encodeURIComponent(userId)}?guildId=${encodeURIComponent(guildId)}`
            : `/api/discord/users/${encodeURIComponent(userId)}`;
        const task = (async () => {
            const response = await authedFetch(url);
            if (!response.ok) {
                throw new ApiError(response.status, response.statusText || `HTTP ${response.status}`);
            }
            const body = await response.json() as DiscordUserView;
            const next = new Map(cache.value);
            next.set(key, { value: body, expiresAt: Date.now() + TTL_MS });
            cache.value = next;
            return body;
        })();
        inflight.set(key, task);
        try {
            return await task;
        } finally {
            inflight.delete(key);
        }
    }

    // ── Open-card slot ────────────────────────────────────────────────
    // One card visible at a time. `target` is set by message avatar /
    // username / mention click handlers; DiscordConversation renders
    // the popover off of it.

    const target = ref<{ userId: string; element: HTMLElement; guildId: string | null } | null>(null);

    function openFor(userId: string, element: HTMLElement, guildId: string | null): void {
        target.value = { userId, element, guildId };
    }

    function close(): void {
        target.value = null;
    }

    return {
        target,
        openFor,
        close,
        readCached,
        fetchUser
    };
});
