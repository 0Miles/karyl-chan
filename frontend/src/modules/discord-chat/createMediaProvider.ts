import type { CustomEmoji, GuildBucket, GuildSticker, MediaProvider } from '../../libs/messages/types';
import { listEmojis, listStickers, loadStickerLottie } from '../../api/discord';
import { stickerImageUrl } from './sticker-url';
import { animatedAvatarUrl, isAnimatedAvatar } from './avatar';
import { useMediaCacheStore } from './stores/mediaCacheStore';
import { useSettingsStore } from '../../stores/settingsStore';

export interface MediaProviderFetchers {
    listEmojis: () => Promise<GuildBucket<CustomEmoji>[]>;
    listStickers: () => Promise<GuildBucket<GuildSticker>[]>;
    loadLottieSticker: (id: string) => Promise<unknown | null>;
    /** Optional sync peek at cached data (used by MediaPicker to skip the loading flash). */
    cachedEmojis?: () => GuildBucket<CustomEmoji>[] | null;
    cachedStickers?: () => GuildBucket<GuildSticker>[] | null;
}

export function createDiscordMediaProvider(fetchers: MediaProviderFetchers): MediaProvider {
    // Read once at provider construction. The settings store is reactive,
    // so we read at call time inside the lambda below — that way toggling
    // the preference takes effect on the next render without rebuilding
    // the provider. Avoids stale closures.
    const settings = useSettingsStore();
    return {
        listEmojis: fetchers.listEmojis,
        listStickers: fetchers.listStickers,
        loadLottieSticker: fetchers.loadLottieSticker,
        stickerUrl: (sticker, size) => stickerImageUrl(sticker.id, sticker.formatType, size),
        customEmojiUrl: (emoji, size = 64) => {
            // Animated emojis fall back to the static `.webp` frame when
            // the user has autoplay disabled. Discord CDN serves this
            // automatically — no separate render call needed.
            const ext = emoji.animated && settings.animatedEmojiAutoplay ? 'gif' : 'webp';
            return `https://cdn.discordapp.com/emojis/${emoji.id}.${ext}?size=${size}&quality=lossless`;
        },
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
