import { ApiError, authedFetch } from './client';

export interface GuildSummary {
    id: string;
    name: string;
    iconUrl: string | null;
    memberCount: number;
    ownerId: string | null;
    joinedAt: string | null;
}

export interface GuildChannelRef {
    channelId: string;
    channelName: string | null;
}

export interface RconForwardEntry extends GuildChannelRef {
    commandPrefix: string | null;
    triggerPrefix: string | null;
    host: string | null;
    port: number | null;
}

export interface RoleEmojiEntry {
    roleId: string;
    roleName: string | null;
    emojiName: string;
    emojiId: string;
    emojiChar: string;
}

export interface RoleReceiveMessageEntry extends GuildChannelRef {
    messageId: string;
}

export interface CapabilityGrantEntry {
    capability: string;
    roleId: string;
    roleName: string | null;
    roleColor: string | null;
}

export interface GuildDetail {
    guild: GuildSummary & { description: string | null };
    todoChannels: GuildChannelRef[];
    pictureOnlyChannels: GuildChannelRef[];
    rconForwardChannels: RconForwardEntry[];
    roleEmojis: RoleEmojiEntry[];
    roleReceiveMessages: RoleReceiveMessageEntry[];
    capabilityGrants: CapabilityGrantEntry[];
}

async function jsonOrThrow<T>(response: Response): Promise<T> {
    if (!response.ok) throw new ApiError(response.status, `${response.status} ${response.statusText}`);
    return (await response.json()) as T;
}

export async function listGuilds(): Promise<GuildSummary[]> {
    const response = await authedFetch('/api/guilds');
    const body = await jsonOrThrow<{ guilds: GuildSummary[] }>(response);
    return body.guilds;
}

export async function getGuildDetail(guildId: string): Promise<GuildDetail> {
    const response = await authedFetch(`/api/guilds/${encodeURIComponent(guildId)}`);
    return jsonOrThrow<GuildDetail>(response);
}
