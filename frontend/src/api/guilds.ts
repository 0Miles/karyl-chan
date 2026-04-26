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

export interface RoleEmojiGroupEntry {
    id: number;
    name: string;
}

export interface RoleEmojiEntry {
    groupId: number;
    roleId: string;
    roleName: string | null;
    emojiName: string;
    emojiId: string;
    emojiChar: string;
}

export interface RoleReceiveMessageEntry extends GuildChannelRef {
    messageId: string;
    /** The single emoji group bound to this watched message. */
    groupId: number;
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
    roleEmojiGroups: RoleEmojiGroupEntry[];
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

export type GuildChannelKind = 'text' | 'voice' | 'stage' | 'forum';

export interface GuildTextChannel {
    id: string;
    name: string;
    /** Discriminator: `text` is a regular text channel, `voice`/`stage` are
     *  voice channels (with an embedded text chat — same id), `forum` opens
     *  the forum-post browser instead of a chat panel. */
    kind: GuildChannelKind;
    lastMessageId: string | null;
    /** Populated only for `voice`/`stage` — the connected participants. */
    voiceMembers?: VoiceChannelMember[];
}

export interface GuildChannelCategory {
    id: string | null;
    name: string | null;
    channels: GuildTextChannel[];
}

export type GuildChannelEvent =
    | { type: 'guild-message-created'; guildId: string; channelId: string; message: Message }
    | { type: 'guild-message-updated'; guildId: string; channelId: string; message: Message }
    | { type: 'guild-message-deleted'; guildId: string; channelId: string; messageId: string }
    | { type: 'guild-typing-start'; guildId: string; channelId: string; userId: string; userName: string; startedAt: number }
    | { type: 'guild-voice-state-updated'; guildId: string; channels: Array<{ channelId: string; members: VoiceChannelMember[] }> };

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

export interface GuildActiveThread {
    id: string;
    name: string;
    parentId: string | null;
    archived: boolean;
    locked: boolean;
    memberCount: number;
    messageCount: number;
    lastMessageId: string | null;
}

export interface GuildForumPost {
    id: string;
    name: string;
    messageCount: number;
    archived: boolean;
}

export interface GuildForum {
    id: string;
    name: string;
    posts: GuildForumPost[];
}

export async function listGuildForums(guildId: string): Promise<GuildForum[]> {
    const url = `/api/guilds/${encodeURIComponent(guildId)}/forums`;
    const response = await authedFetch(url);
    const body = await jsonOrThrow<{ forums: GuildForum[] }>(response);
    return body.forums;
}

export async function listGuildActiveThreads(guildId: string): Promise<GuildActiveThread[]> {
    const url = `/api/guilds/${encodeURIComponent(guildId)}/active-threads`;
    const response = await authedFetch(url);
    const body = await jsonOrThrow<{ threads: GuildActiveThread[] }>(response);
    return body.threads;
}

/** Active OR archived threads belonging to a single channel. Used by
 *  the header thread browser, which lets the user see threads that
 *  aren't surfaced in the sidebar (archived ones, plus all active). */
export async function listChannelThreads(
    guildId: string,
    channelId: string,
    opts: { archived?: boolean } = {}
): Promise<GuildActiveThread[]> {
    const params = new URLSearchParams();
    if (opts.archived) params.set('archived', 'true');
    const query = params.toString();
    const url = `/api/guilds/${encodeURIComponent(guildId)}/text-channels/${encodeURIComponent(channelId)}/threads${query ? `?${query}` : ''}`;
    const response = await authedFetch(url);
    const body = await jsonOrThrow<{ threads: GuildActiveThread[] }>(response);
    return body.threads;
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
    memberCount?: number;
    hoist?: boolean;
    managed?: boolean;
    /** Discord permission bitfield as a base-10 string (always present
     *  from the new /api/guilds/:id/roles payload — older callers may
     *  see it missing). */
    permissions?: string;
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
    options: {
        channelId?: string;
        maxAge?: number;
        maxUses?: number;
        temporary?: boolean;
        /** When false, Discord may reuse an equivalent existing invite
         *  rather than minting a fresh code. Defaults to true server-side. */
        unique?: boolean;
        reason?: string;
    } = {}
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

// ── Role CRUD ─────────────────────────────────────────────────────────

export interface RoleEditPayload {
    name?: string;
    /** "#RRGGBB" or a 24-bit integer. */
    color?: string | number;
    hoist?: boolean;
    mentionable?: boolean;
    /** Bitfield as decimal string — Discord permissions are 64-bit so we
     *  stringify them on the wire to avoid JSON precision loss. */
    permissions?: string;
    reason?: string;
}

export async function createGuildRole(guildId: string, payload: RoleEditPayload): Promise<{ id: string }> {
    const url = `/api/guilds/${encodeURIComponent(guildId)}/roles`;
    const response = await authedFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    return jsonOrThrow<{ id: string }>(response);
}

export async function editGuildRole(guildId: string, roleId: string, payload: RoleEditPayload): Promise<void> {
    const url = `/api/guilds/${encodeURIComponent(guildId)}/roles/${encodeURIComponent(roleId)}`;
    const response = await authedFetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    if (!response.ok && response.status !== 204) throw new ApiError(response.status, 'Failed to edit role');
}

export async function deleteGuildRole(guildId: string, roleId: string, reason?: string): Promise<void> {
    const url = `/api/guilds/${encodeURIComponent(guildId)}/roles/${encodeURIComponent(roleId)}`;
    const response = await authedFetch(url, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason })
    });
    if (!response.ok && response.status !== 204) throw new ApiError(response.status, 'Failed to delete role');
}

// ── Invite revocation ─────────────────────────────────────────────────

export async function deleteGuildInvite(guildId: string, code: string, reason?: string): Promise<void> {
    const url = `/api/guilds/${encodeURIComponent(guildId)}/invites/${encodeURIComponent(code)}`;
    const response = await authedFetch(url, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason })
    });
    if (!response.ok && response.status !== 204) throw new ApiError(response.status, 'Failed to delete invite');
}

// ── Emoji + sticker management ────────────────────────────────────────

export interface GuildEmojiRow {
    id: string;
    name: string | null;
    animated: boolean;
    url: string;
}

export async function listGuildEmojis(guildId: string): Promise<GuildEmojiRow[]> {
    const url = `/api/guilds/${encodeURIComponent(guildId)}/emojis`;
    const response = await authedFetch(url);
    const body = await jsonOrThrow<{ emojis: GuildEmojiRow[] }>(response);
    return body.emojis;
}

export async function createGuildEmoji(guildId: string, name: string, file: File): Promise<{ id: string }> {
    const url = `/api/guilds/${encodeURIComponent(guildId)}/emojis`;
    const form = new FormData();
    form.set('name', name);
    form.append('file', file, file.name);
    const response = await authedFetch(url, { method: 'POST', body: form });
    return jsonOrThrow<{ id: string }>(response);
}

export async function renameGuildEmoji(guildId: string, emojiId: string, name: string, reason?: string): Promise<void> {
    const url = `/api/guilds/${encodeURIComponent(guildId)}/emojis/${encodeURIComponent(emojiId)}`;
    const response = await authedFetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, reason })
    });
    if (!response.ok && response.status !== 204) throw new ApiError(response.status, 'Failed to rename emoji');
}

export async function deleteGuildEmoji(guildId: string, emojiId: string, reason?: string): Promise<void> {
    const url = `/api/guilds/${encodeURIComponent(guildId)}/emojis/${encodeURIComponent(emojiId)}`;
    const response = await authedFetch(url, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason })
    });
    if (!response.ok && response.status !== 204) throw new ApiError(response.status, 'Failed to delete emoji');
}

export interface GuildStickerRow {
    id: string;
    name: string;
    description: string | null;
    tags: string;
    format: number;
    url: string;
}

export async function listGuildStickers(guildId: string): Promise<GuildStickerRow[]> {
    const url = `/api/guilds/${encodeURIComponent(guildId)}/stickers`;
    const response = await authedFetch(url);
    const body = await jsonOrThrow<{ stickers: GuildStickerRow[] }>(response);
    return body.stickers;
}

export async function createGuildSticker(
    guildId: string,
    payload: { name: string; tags: string; description: string; file: File }
): Promise<{ id: string }> {
    const url = `/api/guilds/${encodeURIComponent(guildId)}/stickers`;
    const form = new FormData();
    form.set('name', payload.name);
    form.set('tags', payload.tags);
    form.set('description', payload.description);
    form.append('file', payload.file, payload.file.name);
    const response = await authedFetch(url, { method: 'POST', body: form });
    return jsonOrThrow<{ id: string }>(response);
}

export async function editGuildSticker(
    guildId: string,
    stickerId: string,
    edit: { name?: string; tags?: string; description?: string; reason?: string }
): Promise<void> {
    const url = `/api/guilds/${encodeURIComponent(guildId)}/stickers/${encodeURIComponent(stickerId)}`;
    const response = await authedFetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(edit)
    });
    if (!response.ok && response.status !== 204) throw new ApiError(response.status, 'Failed to edit sticker');
}

export async function deleteGuildSticker(guildId: string, stickerId: string, reason?: string): Promise<void> {
    const url = `/api/guilds/${encodeURIComponent(guildId)}/stickers/${encodeURIComponent(stickerId)}`;
    const response = await authedFetch(url, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason })
    });
    if (!response.ok && response.status !== 204) throw new ApiError(response.status, 'Failed to delete sticker');
}

// ── Channel CRUD ──────────────────────────────────────────────────────

export type CreatableChannelKind = 'text' | 'voice' | 'category' | 'announcement' | 'forum';

export async function createGuildChannel(
    guildId: string,
    opts: {
        name: string;
        type: CreatableChannelKind;
        parentId?: string;
        topic?: string;
        rateLimitPerUser?: number;
        nsfw?: boolean;
        reason?: string;
    }
): Promise<{ id: string }> {
    const url = `/api/guilds/${encodeURIComponent(guildId)}/channels`;
    const response = await authedFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(opts)
    });
    return jsonOrThrow<{ id: string }>(response);
}

export async function deleteGuildChannel(guildId: string, channelId: string, reason?: string): Promise<void> {
    const url = `/api/guilds/${encodeURIComponent(guildId)}/channels/${encodeURIComponent(channelId)}`;
    const response = await authedFetch(url, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason })
    });
    if (!response.ok && response.status !== 204) throw new ApiError(response.status, 'Failed to delete channel');
}

export async function editGuildChannel(
    guildId: string,
    channelId: string,
    edit: {
        name?: string;
        topic?: string;
        parentId?: string | null;
        rateLimitPerUser?: number;
        nsfw?: boolean;
        archived?: boolean;
        locked?: boolean;
        autoArchiveDuration?: 60 | 1440 | 4320 | 10080;
        reason?: string;
    }
): Promise<void> {
    const url = `/api/guilds/${encodeURIComponent(guildId)}/channels/${encodeURIComponent(channelId)}`;
    const response = await authedFetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(edit)
    });
    if (!response.ok && response.status !== 204) throw new ApiError(response.status, 'Failed to edit channel');
}

export interface ThreadMemberRow {
    userId: string;
    joinedAt: string | null;
}

export async function listThreadMembers(guildId: string, threadId: string): Promise<ThreadMemberRow[]> {
    const url = `/api/guilds/${encodeURIComponent(guildId)}/threads/${encodeURIComponent(threadId)}/members`;
    const response = await authedFetch(url);
    const body = await jsonOrThrow<{ members: ThreadMemberRow[] }>(response);
    return body.members;
}

export async function addThreadMember(guildId: string, threadId: string, userId: string): Promise<void> {
    const url = `/api/guilds/${encodeURIComponent(guildId)}/threads/${encodeURIComponent(threadId)}/members/${encodeURIComponent(userId)}`;
    const response = await authedFetch(url, { method: 'POST' });
    if (!response.ok && response.status !== 204) throw new ApiError(response.status, 'Failed to add thread member');
}

export async function removeThreadMember(guildId: string, threadId: string, userId: string): Promise<void> {
    const url = `/api/guilds/${encodeURIComponent(guildId)}/threads/${encodeURIComponent(threadId)}/members/${encodeURIComponent(userId)}`;
    const response = await authedFetch(url, { method: 'DELETE' });
    if (!response.ok && response.status !== 204) throw new ApiError(response.status, 'Failed to remove thread member');
}

// ── Member moderation ──────────────────────────────────────────────────

export async function kickGuildMember(guildId: string, userId: string, reason?: string): Promise<void> {
    const url = `/api/guilds/${encodeURIComponent(guildId)}/members/${encodeURIComponent(userId)}/kick`;
    const response = await authedFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason })
    });
    if (!response.ok && response.status !== 204) throw new ApiError(response.status, 'Failed to kick member');
}

export async function banGuildMember(
    guildId: string,
    userId: string,
    opts: { reason?: string; deleteMessageSeconds?: number } = {}
): Promise<void> {
    const url = `/api/guilds/${encodeURIComponent(guildId)}/members/${encodeURIComponent(userId)}/ban`;
    const response = await authedFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(opts)
    });
    if (!response.ok && response.status !== 204) throw new ApiError(response.status, 'Failed to ban member');
}

export async function unbanGuildUser(guildId: string, userId: string, reason?: string): Promise<void> {
    const url = `/api/guilds/${encodeURIComponent(guildId)}/bans/${encodeURIComponent(userId)}`;
    const response = await authedFetch(url, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason })
    });
    if (!response.ok && response.status !== 204) throw new ApiError(response.status, 'Failed to unban user');
}

export interface GuildBanEntry {
    userId: string;
    username: string;
    globalName: string | null;
    avatarUrl: string;
    reason: string | null;
}

export async function listGuildBans(guildId: string): Promise<GuildBanEntry[]> {
    const url = `/api/guilds/${encodeURIComponent(guildId)}/bans`;
    const response = await authedFetch(url);
    const body = await jsonOrThrow<{ bans: GuildBanEntry[] }>(response);
    return body.bans;
}

export interface GuildMemberRow {
    id: string;
    username: string;
    globalName: string | null;
    nickname: string | null;
    avatarUrl: string;
    color: string | null;
    bot: boolean;
    joinedAt: string | null;
    pending: boolean;
    roles: string[];
    timeoutUntil: string | null;
}

export async function listGuildMembers(
    guildId: string,
    opts: { limit?: number; query?: string } = {}
): Promise<GuildMemberRow[]> {
    const params = new URLSearchParams();
    if (opts.limit) params.set('limit', String(opts.limit));
    if (opts.query) params.set('query', opts.query);
    const query = params.toString();
    const url = `/api/guilds/${encodeURIComponent(guildId)}/members${query ? `?${query}` : ''}`;
    const response = await authedFetch(url);
    const body = await jsonOrThrow<{ members: GuildMemberRow[] }>(response);
    return body.members;
}

// ── Guild settings (general / moderation / system) ────────────────────

export interface GuildSystemChannelFlagsPayload {
    suppressJoinNotifications: boolean;
    suppressPremiumSubscriptions: boolean;
    suppressGuildReminderNotifications: boolean;
    suppressJoinNotificationReplies: boolean;
}

export interface GuildSettings {
    id: string;
    name: string;
    description: string | null;
    iconUrl: string | null;
    bannerUrl: string | null;
    ownerId: string | null;
    afkChannelId: string | null;
    afkTimeout: number;
    systemChannelId: string | null;
    systemChannelFlags: GuildSystemChannelFlagsPayload;
    verificationLevel: number;
    explicitContentFilter: number;
    defaultMessageNotifications: number;
    mfaLevel: number;
    rulesChannelId: string | null;
    publicUpdatesChannelId: string | null;
    premiumTier: number;
    premiumSubscriptionCount: number;
    premiumProgressBarEnabled: boolean;
    features: string[];
}

export type GuildSettingsPatch = Partial<{
    name: string;
    description: string | null;
    afkChannelId: string | null;
    afkTimeout: number;
    systemChannelId: string | null;
    systemChannelFlags: Partial<GuildSystemChannelFlagsPayload>;
    verificationLevel: number;
    explicitContentFilter: number;
    defaultMessageNotifications: number;
    rulesChannelId: string | null;
    publicUpdatesChannelId: string | null;
    premiumProgressBarEnabled: boolean;
    reason: string;
}>;

export async function getGuildSettings(guildId: string): Promise<GuildSettings> {
    const url = `/api/guilds/${encodeURIComponent(guildId)}/settings`;
    const response = await authedFetch(url);
    const body = await jsonOrThrow<{ settings: GuildSettings }>(response);
    return body.settings;
}

export async function patchGuildSettings(guildId: string, patch: GuildSettingsPatch): Promise<GuildSettings> {
    const url = `/api/guilds/${encodeURIComponent(guildId)}/settings`;
    const response = await authedFetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch)
    });
    const body = await jsonOrThrow<{ settings: GuildSettings }>(response);
    return body.settings;
}

/** Owner-only — surfaces a 502 from non-owner bots. */
export async function setGuildMfaLevel(guildId: string, level: 0 | 1): Promise<void> {
    const url = `/api/guilds/${encodeURIComponent(guildId)}/settings/mfa-level`;
    const response = await authedFetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ level })
    });
    if (!response.ok && response.status !== 204) throw new ApiError(response.status, 'Failed to set MFA level');
}

// ── Audit log ─────────────────────────────────────────────────────────

export interface AuditLogChange {
    key: string;
    oldValue: unknown;
    newValue: unknown;
}

export interface AuditLogExecutor {
    id: string;
    username: string;
    globalName: string | null;
    avatarUrl: string;
}

export interface AuditLogEntry {
    id: string;
    actionType: number;
    actionTypeName: string;
    targetId: string | null;
    executor: AuditLogExecutor | null;
    reason: string | null;
    createdAt: string;
    changes: AuditLogChange[];
}

export async function listGuildAuditLogs(
    guildId: string,
    opts: { limit?: number; before?: string; type?: number; user?: string } = {}
): Promise<AuditLogEntry[]> {
    const params = new URLSearchParams();
    if (opts.limit) params.set('limit', String(opts.limit));
    if (opts.before) params.set('before', opts.before);
    if (opts.type !== undefined) params.set('type', String(opts.type));
    if (opts.user) params.set('user', opts.user);
    const query = params.toString();
    const url = `/api/guilds/${encodeURIComponent(guildId)}/audit-logs${query ? `?${query}` : ''}`;
    const response = await authedFetch(url);
    const body = await jsonOrThrow<{ entries: AuditLogEntry[] }>(response);
    return body.entries;
}

// ── AutoMod rules ─────────────────────────────────────────────────────

export interface AutoModTriggerMetadata {
    keywordFilter?: string[];
    regexPatterns?: string[];
    presets?: number[];
    allowList?: string[];
    mentionTotalLimit?: number | null;
    mentionRaidProtectionEnabled?: boolean | null;
}

export interface AutoModAction {
    type: number;          // 1=BlockMessage, 2=SendAlertMessage, 3=Timeout
    metadata?: { channelId?: string; durationSeconds?: number; customMessage?: string } | null;
}

export interface AutoModRule {
    id: string;
    name: string;
    enabled: boolean;
    eventType: number;     // 1=MessageSend, 2=MemberUpdate
    triggerType: number;   // 1=Keyword, 3=Spam, 4=KeywordPreset, 5=MentionSpam, 6=MemberProfile
    triggerMetadata: AutoModTriggerMetadata;
    actions: AutoModAction[];
    exemptRoles: string[];
    exemptChannels: string[];
    creatorId: string | null;
}

export interface AutoModRulePayload {
    name?: string;
    enabled?: boolean;
    eventType?: number;
    triggerType?: number;
    triggerMetadata?: AutoModTriggerMetadata;
    actions?: AutoModAction[];
    exemptRoles?: string[];
    exemptChannels?: string[];
    reason?: string;
}

export async function listAutoModRules(guildId: string): Promise<AutoModRule[]> {
    const url = `/api/guilds/${encodeURIComponent(guildId)}/automod/rules`;
    const response = await authedFetch(url);
    const body = await jsonOrThrow<{ rules: AutoModRule[] }>(response);
    return body.rules;
}

export async function createAutoModRule(guildId: string, payload: AutoModRulePayload): Promise<AutoModRule> {
    const url = `/api/guilds/${encodeURIComponent(guildId)}/automod/rules`;
    const response = await authedFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    const body = await jsonOrThrow<{ rule: AutoModRule }>(response);
    return body.rule;
}

export async function editAutoModRule(guildId: string, ruleId: string, payload: AutoModRulePayload): Promise<AutoModRule> {
    const url = `/api/guilds/${encodeURIComponent(guildId)}/automod/rules/${encodeURIComponent(ruleId)}`;
    const response = await authedFetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    const body = await jsonOrThrow<{ rule: AutoModRule }>(response);
    return body.rule;
}

export async function deleteAutoModRule(guildId: string, ruleId: string, reason?: string): Promise<void> {
    const url = `/api/guilds/${encodeURIComponent(guildId)}/automod/rules/${encodeURIComponent(ruleId)}`;
    const response = await authedFetch(url, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason })
    });
    if (!response.ok && response.status !== 204) throw new ApiError(response.status, 'Failed to delete AutoMod rule');
}

// ── Bot-feature CRUD ───────────────────────────────────────────────────
//
// Mirrors the slash commands; lets the admin panel manage the same
// per-guild settings without dropping into Discord. All endpoints write
// to local SQL state — Discord.js is only used for cosmetic name
// lookups in the GET /api/guilds/:id detail call.

export async function addTodoChannel(guildId: string, channelId: string): Promise<void> {
    const response = await authedFetch(`/api/guilds/${encodeURIComponent(guildId)}/feature/todo-channels`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelId })
    });
    if (!response.ok && response.status !== 204) throw new ApiError(response.status, 'Failed to add todo channel');
}
export async function removeTodoChannel(guildId: string, channelId: string): Promise<void> {
    const response = await authedFetch(`/api/guilds/${encodeURIComponent(guildId)}/feature/todo-channels/${encodeURIComponent(channelId)}`, { method: 'DELETE' });
    if (!response.ok && response.status !== 204) throw new ApiError(response.status, 'Failed to remove todo channel');
}

export async function addPictureOnlyChannel(guildId: string, channelId: string): Promise<void> {
    const response = await authedFetch(`/api/guilds/${encodeURIComponent(guildId)}/feature/picture-only-channels`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelId })
    });
    if (!response.ok && response.status !== 204) throw new ApiError(response.status, 'Failed to add picture-only channel');
}
export async function removePictureOnlyChannel(guildId: string, channelId: string): Promise<void> {
    const response = await authedFetch(`/api/guilds/${encodeURIComponent(guildId)}/feature/picture-only-channels/${encodeURIComponent(channelId)}`, { method: 'DELETE' });
    if (!response.ok && response.status !== 204) throw new ApiError(response.status, 'Failed to remove picture-only channel');
}

export interface RconForwardPayload {
    channelId: string;
    host?: string | null;
    port?: number | null;
    password?: string | null;
    commandPrefix?: string | null;
    triggerPrefix?: string | null;
}
export async function upsertRconForward(guildId: string, payload: RconForwardPayload): Promise<void> {
    const response = await authedFetch(`/api/guilds/${encodeURIComponent(guildId)}/feature/rcon-channels`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    if (!response.ok && response.status !== 204) throw new ApiError(response.status, 'Failed to save rcon channel');
}
export async function removeRconForward(guildId: string, channelId: string): Promise<void> {
    const response = await authedFetch(`/api/guilds/${encodeURIComponent(guildId)}/feature/rcon-channels/${encodeURIComponent(channelId)}`, { method: 'DELETE' });
    if (!response.ok && response.status !== 204) throw new ApiError(response.status, 'Failed to remove rcon channel');
}

export async function addRoleEmojiGroup(guildId: string, name: string): Promise<RoleEmojiGroupEntry> {
    const response = await authedFetch(`/api/guilds/${encodeURIComponent(guildId)}/feature/role-emoji-groups`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
    });
    if (!response.ok) throw new ApiError(response.status, 'Failed to add emoji group');
    return (await response.json()) as RoleEmojiGroupEntry;
}
export async function removeRoleEmojiGroup(guildId: string, groupId: number): Promise<void> {
    const url = `/api/guilds/${encodeURIComponent(guildId)}/feature/role-emoji-groups/${encodeURIComponent(String(groupId))}`;
    const response = await authedFetch(url, { method: 'DELETE' });
    if (!response.ok && response.status !== 204) throw new ApiError(response.status, 'Failed to remove emoji group');
}

export async function addRoleEmoji(guildId: string, groupId: number, roleId: string, emoji: string): Promise<void> {
    const response = await authedFetch(`/api/guilds/${encodeURIComponent(guildId)}/feature/role-emoji`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupId, roleId, emoji })
    });
    if (!response.ok && response.status !== 204) throw new ApiError(response.status, 'Failed to add role-emoji');
}
export async function removeRoleEmoji(
    guildId: string,
    opts: { groupId: number; emojiChar?: string; emojiId?: string }
): Promise<void> {
    const params = new URLSearchParams();
    params.set('groupId', String(opts.groupId));
    if (opts.emojiChar) params.set('emojiChar', opts.emojiChar);
    if (opts.emojiId) params.set('emojiId', opts.emojiId);
    const response = await authedFetch(`/api/guilds/${encodeURIComponent(guildId)}/feature/role-emoji?${params.toString()}`, { method: 'DELETE' });
    if (!response.ok && response.status !== 204) throw new ApiError(response.status, 'Failed to remove role-emoji');
}

export async function addRoleReceiveMessage(
    guildId: string,
    channelId: string,
    messageId: string,
    groupId: number
): Promise<void> {
    const response = await authedFetch(`/api/guilds/${encodeURIComponent(guildId)}/feature/role-receive-messages`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelId, messageId, groupId })
    });
    if (!response.ok && response.status !== 204) throw new ApiError(response.status, 'Failed to add role-receive message');
}
export async function setRoleReceiveMessageGroup(
    guildId: string,
    channelId: string,
    messageId: string,
    groupId: number
): Promise<void> {
    const url = `/api/guilds/${encodeURIComponent(guildId)}/feature/role-receive-messages/${encodeURIComponent(channelId)}/${encodeURIComponent(messageId)}/group`;
    const response = await authedFetch(url, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupId })
    });
    if (!response.ok && response.status !== 204) throw new ApiError(response.status, 'Failed to update message group');
}
export async function removeRoleReceiveMessage(guildId: string, channelId: string, messageId: string): Promise<void> {
    const url = `/api/guilds/${encodeURIComponent(guildId)}/feature/role-receive-messages/${encodeURIComponent(channelId)}/${encodeURIComponent(messageId)}`;
    const response = await authedFetch(url, { method: 'DELETE' });
    if (!response.ok && response.status !== 204) throw new ApiError(response.status, 'Failed to remove role-receive message');
}

export async function addCapabilityGrant(guildId: string, capability: string, roleId: string): Promise<void> {
    const response = await authedFetch(`/api/guilds/${encodeURIComponent(guildId)}/feature/capability-grants`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ capability, roleId })
    });
    if (!response.ok && response.status !== 204) throw new ApiError(response.status, 'Failed to add capability grant');
}
export async function removeCapabilityGrant(guildId: string, capability: string, roleId: string): Promise<void> {
    const url = `/api/guilds/${encodeURIComponent(guildId)}/feature/capability-grants/${encodeURIComponent(capability)}/${encodeURIComponent(roleId)}`;
    const response = await authedFetch(url, { method: 'DELETE' });
    if (!response.ok && response.status !== 204) throw new ApiError(response.status, 'Failed to remove capability grant');
}

/** Pass `null` to clear an existing timeout, or an ISO string ≤28 days
 *  in the future to apply one. */
export async function timeoutGuildMember(
    guildId: string,
    userId: string,
    until: string | null,
    reason?: string
): Promise<void> {
    const url = `/api/guilds/${encodeURIComponent(guildId)}/members/${encodeURIComponent(userId)}/timeout`;
    const response = await authedFetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ until, reason })
    });
    if (!response.ok && response.status !== 204) throw new ApiError(response.status, 'Failed to set timeout');
}

export async function setGuildMemberNickname(
    guildId: string,
    userId: string,
    nickname: string | null,
    reason?: string
): Promise<void> {
    const url = `/api/guilds/${encodeURIComponent(guildId)}/members/${encodeURIComponent(userId)}/nickname`;
    const response = await authedFetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname, reason })
    });
    if (!response.ok && response.status !== 204) throw new ApiError(response.status, 'Failed to set nickname');
}

export async function addGuildMemberRole(
    guildId: string,
    userId: string,
    roleId: string,
    reason?: string
): Promise<void> {
    const url = `/api/guilds/${encodeURIComponent(guildId)}/members/${encodeURIComponent(userId)}/roles/${encodeURIComponent(roleId)}`;
    const response = await authedFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason })
    });
    if (!response.ok && response.status !== 204) throw new ApiError(response.status, 'Failed to add role');
}

export async function removeGuildMemberRole(
    guildId: string,
    userId: string,
    roleId: string,
    reason?: string
): Promise<void> {
    const url = `/api/guilds/${encodeURIComponent(guildId)}/members/${encodeURIComponent(userId)}/roles/${encodeURIComponent(roleId)}`;
    const response = await authedFetch(url, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason })
    });
    if (!response.ok && response.status !== 204) throw new ApiError(response.status, 'Failed to remove role');
}

// ── Message moderation ────────────────────────────────────────────────

export async function pinGuildMessage(guildId: string, channelId: string, messageId: string): Promise<void> {
    const url = `/api/guilds/${encodeURIComponent(guildId)}/text-channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}/pin`;
    const response = await authedFetch(url, { method: 'POST' });
    if (!response.ok && response.status !== 204) throw new ApiError(response.status, 'Failed to pin message');
}

export async function unpinGuildMessage(guildId: string, channelId: string, messageId: string): Promise<void> {
    const url = `/api/guilds/${encodeURIComponent(guildId)}/text-channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}/pin`;
    const response = await authedFetch(url, { method: 'DELETE' });
    if (!response.ok && response.status !== 204) throw new ApiError(response.status, 'Failed to unpin message');
}

export async function crosspostGuildMessage(guildId: string, channelId: string, messageId: string): Promise<void> {
    const url = `/api/guilds/${encodeURIComponent(guildId)}/text-channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}/crosspost`;
    const response = await authedFetch(url, { method: 'POST' });
    if (!response.ok && response.status !== 204) throw new ApiError(response.status, 'Failed to crosspost message');
}

export async function bulkDeleteGuildMessages(guildId: string, channelId: string, messageIds: string[]): Promise<number> {
    const url = `/api/guilds/${encodeURIComponent(guildId)}/text-channels/${encodeURIComponent(channelId)}/messages/bulk-delete`;
    const response = await authedFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageIds })
    });
    const body = await jsonOrThrow<{ deletedCount: number }>(response);
    return body.deletedCount;
}

export async function setGuildVoiceMemberMute(guildId: string, userId: string, mute: boolean): Promise<void> {
    const url = `/api/guilds/${encodeURIComponent(guildId)}/voice-members/${encodeURIComponent(userId)}/mute`;
    const response = await authedFetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mute })
    });
    if (!response.ok && response.status !== 204) throw new ApiError(response.status, 'Failed to set mute');
}

export async function setGuildVoiceMemberDeafen(guildId: string, userId: string, deaf: boolean): Promise<void> {
    const url = `/api/guilds/${encodeURIComponent(guildId)}/voice-members/${encodeURIComponent(userId)}/deafen`;
    const response = await authedFetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deaf })
    });
    if (!response.ok && response.status !== 204) throw new ApiError(response.status, 'Failed to set deafen');
}

/** Pass `null` to disconnect the user from voice; a channel id moves them. */
export async function moveGuildVoiceMember(guildId: string, userId: string, channelId: string | null): Promise<void> {
    const url = `/api/guilds/${encodeURIComponent(guildId)}/voice-members/${encodeURIComponent(userId)}/move`;
    const response = await authedFetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelId })
    });
    if (!response.ok && response.status !== 204) throw new ApiError(response.status, 'Failed to move voice member');
}

/** Forward an existing message to any text-based channel — guild text /
 *  voice / thread or DM — that the bot has access to. Backend gates on
 *  the destination's surface (guild.write or dm.write). */
export async function forwardMessage(
    sourceChannelId: string,
    sourceMessageId: string,
    targetChannelId: string
): Promise<Message> {
    const url = `/api/discord/messages/forward`;
    const response = await authedFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceChannelId, sourceMessageId, targetChannelId })
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
            source.addEventListener('guild-typing-start', dispatch as EventListener);
            source.addEventListener('guild-voice-state-updated', dispatch as EventListener);
        }
    });
}
