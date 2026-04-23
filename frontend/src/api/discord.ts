import { ApiError, authedFetch } from './client';

export interface CustomEmoji {
    id: string;
    name: string;
    animated: boolean;
}

export interface GuildSticker {
    id: string;
    name: string;
    formatType: number;
    description: string | null;
}

export interface GuildBucket<T> {
    guildId: string;
    guildName: string;
    items: T[];
}

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
