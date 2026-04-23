import type { CustomEmoji, GuildBucket, GuildSticker, MediaProvider } from '../../libs/messages/types';
import { listEmojis, listStickers, loadStickerLottie } from '../../api/discord';
import { stickerImageUrl } from './sticker-url';
import { animatedAvatarUrl, isAnimatedAvatar } from './avatar';

export interface MediaProviderFetchers {
    listEmojis: () => Promise<GuildBucket<CustomEmoji>[]>;
    listStickers: () => Promise<GuildBucket<GuildSticker>[]>;
    loadLottieSticker: (id: string) => Promise<unknown | null>;
}

export function createDiscordMediaProvider(fetchers: MediaProviderFetchers): MediaProvider {
    return {
        listEmojis: fetchers.listEmojis,
        listStickers: fetchers.listStickers,
        loadLottieSticker: fetchers.loadLottieSticker,
        stickerUrl: (sticker, size) => stickerImageUrl(sticker.id, sticker.formatType, size),
        customEmojiUrl: (emoji, size = 64) =>
            `https://cdn.discordapp.com/emojis/${emoji.id}.${emoji.animated ? 'gif' : 'webp'}?size=${size}&quality=lossless`,
        avatarHoverUrl: (url) => (isAnimatedAvatar(url) ? animatedAvatarUrl(url) : null)
    };
}

/** Zero-arg factory wired to the default `api/discord.ts` fetchers. */
export function createDefaultDiscordMediaProvider(): MediaProvider {
    return createDiscordMediaProvider({
        listEmojis,
        listStickers,
        loadLottieSticker: loadStickerLottie
    });
}
