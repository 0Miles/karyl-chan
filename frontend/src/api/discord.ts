import { ApiError, authedFetch } from './client';
import type { CustomEmoji, GuildBucket, GuildSticker } from '../libs/messages/types';

export type { CustomEmoji, GuildBucket, GuildSticker };

async function jsonOrThrow<T>(response: Response): Promise<T> {
    if (!response.ok) {
        throw new ApiError(response.status, `${response.status} ${response.statusText}`);
    }
    return (await response.json()) as T;
}

export async function listEmojis(): Promise<GuildBucket<CustomEmoji>[]> {
    const response = await authedFetch('/api/discord/emojis');
    const body = await jsonOrThrow<{ guilds: GuildBucket<CustomEmoji>[] }>(response);
    return body.guilds;
}

export async function listStickers(): Promise<GuildBucket<GuildSticker>[]> {
    const response = await authedFetch('/api/discord/stickers');
    const body = await jsonOrThrow<{ guilds: GuildBucket<GuildSticker>[] }>(response);
    return body.guilds;
}

export async function loadStickerLottie(stickerId: string): Promise<unknown | null> {
    const response = await authedFetch(`/api/dm/stickers/${encodeURIComponent(stickerId)}`);
    if (!response.ok) return null;
    return await response.json();
}
