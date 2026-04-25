import { ApiError, authedFetch, openTicketedSse } from './client';
import type { Message, MessageEmoji } from '../libs/messages';

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

// ── Guild text-channel messaging ───────────────────────────────────────────

export interface GuildTextChannel {
    id: string;
    name: string;
    lastMessageId: string | null;
}

export interface GuildChannelCategory {
    id: string | null;
    name: string | null;
    channels: GuildTextChannel[];
}

export type GuildChannelEvent =
    | { type: 'guild-message-created'; guildId: string; channelId: string; message: Message }
    | { type: 'guild-message-updated'; guildId: string; channelId: string; message: Message }
    | { type: 'guild-message-deleted'; guildId: string; channelId: string; messageId: string };

export interface VoiceChannelMember {
    id: string;
    username: string;
    globalName: string | null;
    nickname: string | null;
    avatarUrl: string | null;
}

export interface GuildVoiceChannel {
    id: string;
    name: string;
    type: 'voice' | 'stage';
    members: VoiceChannelMember[];
}

export interface GuildVoiceCategory {
    id: string | null;
    name: string | null;
    channels: GuildVoiceChannel[];
}

export async function listGuildVoiceChannels(guildId: string): Promise<GuildVoiceCategory[]> {
    const url = `/api/guilds/${encodeURIComponent(guildId)}/voice-channels`;
    const response = await authedFetch(url);
    const body = await jsonOrThrow<{ categories: GuildVoiceCategory[] }>(response);
    return body.categories;
}

export async function listGuildTextChannels(guildId: string): Promise<GuildChannelCategory[]> {
    const response = await authedFetch(`/api/guilds/${encodeURIComponent(guildId)}/text-channels`);
    const body = await jsonOrThrow<{ categories: GuildChannelCategory[] }>(response);
    return body.categories;
}

export interface GuildRoleSummary {
    id: string;
    name: string;
    color: string | null;
    position: number;
    mentionable: boolean;
}

export interface GuildChannelMember {
    id: string;
    username: string;
    globalName: string | null;
    nickname: string | null;
    avatarUrl: string | null;
    /** Hex string of the member's highest coloured role, or null if none. */
    color: string | null;
    bot: boolean;
}

export async function listGuildRoles(guildId: string): Promise<GuildRoleSummary[]> {
    const response = await authedFetch(`/api/guilds/${encodeURIComponent(guildId)}/roles`);
    const body = await jsonOrThrow<{ roles: GuildRoleSummary[] }>(response);
    return body.roles;
}

export async function listGuildChannelMembers(guildId: string, channelId: string): Promise<GuildChannelMember[]> {
    const response = await authedFetch(`/api/guilds/${encodeURIComponent(guildId)}/text-channels/${encodeURIComponent(channelId)}/members`);
    const body = await jsonOrThrow<{ members: GuildChannelMember[] }>(response);
    return body.members;
}

export interface GuildReactionUser {
    id: string;
    username: string;
    globalName: string | null;
    avatarUrl: string;
}

export async function getGuildReactionUsers(
    guildId: string,
    channelId: string,
    messageId: string,
    emoji: { id: string | null; name: string }
): Promise<GuildReactionUser[]> {
    const params = new URLSearchParams();
    if (emoji.id) params.set('emojiId', emoji.id);
    else params.set('emojiName', emoji.name);
    const url = `/api/guilds/${encodeURIComponent(guildId)}/text-channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}/reactions/users?${params}`;
    const response = await authedFetch(url);
    const body = await jsonOrThrow<{ users: GuildReactionUser[] }>(response);
    return body.users;
}

export interface GuildInvite {
    code: string;
    url: string;
    channelId: string | null;
    channelName: string | null;
    inviterId: string | null;
    inviterName: string | null;
    uses: number;
    maxUses: number;
    maxAge: number;
    temporary: boolean;
    expiresAt: string | null;
    createdAt: string | null;
}

export async function listGuildInvites(guildId: string): Promise<GuildInvite[]> {
    const url = `/api/guilds/${encodeURIComponent(guildId)}/invites`;
    const response = await authedFetch(url);
    const body = await jsonOrThrow<{ invites: GuildInvite[] }>(response);
    return body.invites;
}

export async function createGuildInvite(
    guildId: string,
    options: { channelId?: string; maxAge?: number; maxUses?: number; temporary?: boolean } = {}
): Promise<{ code: string; url: string; expiresAt: string | null }> {
    const url = `/api/guilds/${encodeURIComponent(guildId)}/invites`;
    const response = await authedFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(options)
    });
    return jsonOrThrow<{ code: string; url: string; expiresAt: string | null }>(response);
}

export async function getGuildPins(guildId: string, channelId: string): Promise<Message[]> {
    const url = `/api/guilds/${encodeURIComponent(guildId)}/text-channels/${encodeURIComponent(channelId)}/pins`;
    const response = await authedFetch(url);
    const body = await jsonOrThrow<{ messages: Message[] }>(response);
    return body.messages;
}

export async function getGuildMessages(
    guildId: string,
    channelId: string,
    opts: { limit?: number; before?: string; around?: string } = {}
): Promise<{ messages: Message[]; hasMore: boolean }> {
    const params = new URLSearchParams();
    if (opts.limit) params.set('limit', String(opts.limit));
    if (opts.before) params.set('before', opts.before);
    if (opts.around) params.set('around', opts.around);
    const query = params.toString();
    const url = `/api/guilds/${encodeURIComponent(guildId)}/text-channels/${encodeURIComponent(channelId)}/messages${query ? `?${query}` : ''}`;
    const response = await authedFetch(url);
    return jsonOrThrow<{ messages: Message[]; hasMore: boolean }>(response);
}

export async function sendGuildMessage(
    guildId: string,
    channelId: string,
    content: string,
    files: File[] = [],
    stickerIds: string[] = [],
    replyToMessageId?: string,
    replyPingAuthor?: boolean
): Promise<Message> {
    const url = `/api/guilds/${encodeURIComponent(guildId)}/text-channels/${encodeURIComponent(channelId)}/messages`;
    let response: Response;
    if (files.length > 0) {
        const form = new FormData();
        if (content) form.set('content', content);
        if (replyToMessageId) form.set('replyToMessageId', replyToMessageId);
        if (replyPingAuthor !== undefined) form.set('replyPingAuthor', replyPingAuthor ? '1' : '0');
        stickerIds.forEach(id => form.append('stickerIds', id));
        files.forEach(file => form.append('files', file, file.name));
        response = await authedFetch(url, { method: 'POST', body: form });
    } else {
        response = await authedFetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                content,
                replyToMessageId,
                replyPingAuthor,
                stickerIds: stickerIds.length ? stickerIds : undefined
            })
        });
    }
    const body = await jsonOrThrow<{ message: Message }>(response);
    return body.message;
}

export async function editGuildMessage(
    guildId: string,
    channelId: string,
    messageId: string,
    content: string
): Promise<Message> {
    const url = `/api/guilds/${encodeURIComponent(guildId)}/text-channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}`;
    const response = await authedFetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content })
    });
    const body = await jsonOrThrow<{ message: Message }>(response);
    return body.message;
}

export async function deleteGuildMessage(
    guildId: string,
    channelId: string,
    messageId: string
): Promise<void> {
    const url = `/api/guilds/${encodeURIComponent(guildId)}/text-channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}`;
    const response = await authedFetch(url, { method: 'DELETE' });
    if (!response.ok && response.status !== 204) throw new ApiError(response.status, 'Failed to delete message');
}

export async function addGuildReaction(
    guildId: string,
    channelId: string,
    messageId: string,
    emoji: MessageEmoji
): Promise<void> {
    const url = `/api/guilds/${encodeURIComponent(guildId)}/text-channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}/reactions`;
    const response = await authedFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emoji })
    });
    if (!response.ok) throw new ApiError(response.status, 'Failed to add reaction');
}

export async function removeGuildReaction(
    guildId: string,
    channelId: string,
    messageId: string,
    emoji: MessageEmoji
): Promise<void> {
    const url = `/api/guilds/${encodeURIComponent(guildId)}/text-channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}/reactions`;
    const response = await authedFetch(url, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emoji })
    });
    if (!response.ok) throw new ApiError(response.status, 'Failed to remove reaction');
}

export interface GuildEventStreamHandlers {
    onEvent: (event: GuildChannelEvent) => void;
    onError?: (event: Event) => void;
}

export function subscribeGuildEvents(handlers: GuildEventStreamHandlers): () => void {
    const dispatch = (raw: MessageEvent) => {
        try {
            const data = JSON.parse(raw.data) as GuildChannelEvent;
            handlers.onEvent(data);
        } catch {
            // ignore malformed events
        }
    };
    return openTicketedSse('/api/guilds/events', {
        onEvent: dispatch,
        onError: handlers.onError,
        bindEventListeners(source) {
            source.addEventListener('guild-message-created', dispatch as EventListener);
            source.addEventListener('guild-message-updated', dispatch as EventListener);
            source.addEventListener('guild-message-deleted', dispatch as EventListener);
        }
    });
}
