import { defineStore } from 'pinia';
import { shallowRef } from 'vue';
import type { CustomEmoji, GuildBucket, GuildSticker } from '../../../libs/messages/types';

/**
 * Process-wide cache for Discord emoji / sticker listings so reopening the
 * MediaPicker doesn't re-hit the API. In-flight promises are also deduped so
 * concurrent openers share a single fetch.
 */
export const useMediaCacheStore = defineStore('discord-media-cache', () => {
    const emojiGuilds = shallowRef<GuildBucket<CustomEmoji>[] | null>(null);
    const stickerGuilds = shallowRef<GuildBucket<GuildSticker>[] | null>(null);

    let emojiPromise: Promise<GuildBucket<CustomEmoji>[]> | null = null;
    let stickerPromise: Promise<GuildBucket<GuildSticker>[]> | null = null;

    async function ensureEmojis(
        fetchFn: () => Promise<GuildBucket<CustomEmoji>[]>
    ): Promise<GuildBucket<CustomEmoji>[]> {
        if (emojiGuilds.value) return emojiGuilds.value;
        if (!emojiPromise) {
            emojiPromise = (async () => {
                try {
                    const value = await fetchFn();
                    emojiGuilds.value = value;
                    return value;
                } catch (err) {
                    emojiPromise = null;
                    throw err;
                }
            })();
        }
        return emojiPromise;
    }

    async function ensureStickers(
        fetchFn: () => Promise<GuildBucket<GuildSticker>[]>
    ): Promise<GuildBucket<GuildSticker>[]> {
        if (stickerGuilds.value) return stickerGuilds.value;
        if (!stickerPromise) {
            stickerPromise = (async () => {
                try {
                    const value = await fetchFn();
                    stickerGuilds.value = value;
                    return value;
                } catch (err) {
                    stickerPromise = null;
                    throw err;
                }
            })();
        }
        return stickerPromise;
    }

    function invalidate(): void {
        emojiGuilds.value = null;
        stickerGuilds.value = null;
        emojiPromise = null;
        stickerPromise = null;
    }

    return {
        emojiGuilds,
        stickerGuilds,
        ensureEmojis,
        ensureStickers,
        invalidate
    };
});
