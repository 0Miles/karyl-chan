import type { CustomEmoji, GuildBucket, GuildSticker, MediaProvider } from '../../libs/messages/types';
import { listEmojis, listStickers, loadStickerLottie } from '../../api/discord';
import { stickerImageUrl } from './sticker-url';
import { animatedAvatarUrl, isAnimatedAvatar } from './avatar';
import { useMediaCacheStore } from './stores/mediaCacheStore';

export interface MediaProviderFetchers {
    listEmojis: () => Promise<GuildBucket<CustomEmoji>[]>;
    listStickers: () => Promise<GuildBucket<GuildSticker>[]>;
    loadLottieSticker: (id: string) => Promise<unknown | null>;
    /** Optional sync peek at cached data (used by MediaPicker to skip the loading flash). */
    cachedEmojis?: () => GuildBucket<CustomEmoji>[] | null;
    cachedStickers?: () => GuildBucket<GuildSticker>[] | null;
}

export function createDiscordMediaProvider(fetchers: MediaProviderFetchers): MediaProvider {
    return {
        listEmojis: fetchers.listEmojis,
        listStickers: fetchers.listStickers,
        loadLottieSticker: fetchers.loadLottieSticker,
        stickerUrl: (sticker, size) => stickerImageUrl(sticker.id, sticker.formatType, size),
        customEmojiUrl: (emoji, size = 64) =>
            `https://cdn.discordapp.com/emojis/${emoji.id}.${emoji.animated ? 'gif' : 'webp'}?size=${size}&quality=lossless`,
        avatarHoverUrl: (url) => (isAnimatedAvatar(url) ? animatedAvatarUrl(url) : null),
        cachedEmojis: fetchers.cachedEmojis,
        cachedStickers: fetchers.cachedStickers
    };
}

/**
 * Default factory wired to `api/discord.ts` — wraps listEmojis/listStickers
 * through the Pinia `mediaCacheStore` so reopening the picker is instant.
 */
export function createDefaultDiscordMediaProvider(): MediaProvider {
    const cache = useMediaCacheStore();
    return createDiscordMediaProvider({
        listEmojis: () => cache.ensureEmojis(() => listEmojis()),
        listStickers: () => cache.ensureStickers(() => listStickers()),
        loadLottieSticker: loadStickerLottie,
        cachedEmojis: () => cache.emojiGuilds,
        cachedStickers: () => cache.stickerGuilds
    });
}
