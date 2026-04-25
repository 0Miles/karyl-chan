import { defineStore } from 'pinia';
import { reactive } from 'vue';
import {
    addGuildReaction as apiAddReaction,
    deleteGuildMessage as apiDeleteMessage,
    editGuildMessage as apiEditMessage,
    getGuildMessages as apiGetMessages,
    listGuildChannelMembers as apiListChannelMembers,
    listGuildRoles as apiListRoles,
    listGuildTextChannels as apiListChannels,
    removeGuildReaction as apiRemoveReaction,
    sendGuildMessage as apiSendMessage,
    subscribeGuildEvents,
    type GuildChannelCategory,
    type GuildChannelMember,
    type GuildRoleSummary,
} from '../../../api/guilds';
import type { MessageEmoji } from '../../../libs/messages';
import { useMessageCacheStore } from './messageCacheStore';
import { useBotStore } from './botStore';
import { useUnreadStore } from './unreadStore';
import { maybeNotify } from '../notifications';

interface GuildEntry {
    categories: GuildChannelCategory[];
    loading: boolean;
    loaded: boolean;
    error: string | null;
    roles: GuildRoleSummary[] | null;
    rolesPending: Promise<GuildRoleSummary[]> | null;
    channelMembers: Record<string, GuildChannelMember[]>;
    channelMembersPending: Record<string, Promise<GuildChannelMember[]>>;
}

export const useGuildChannelStore = defineStore('discord-guild-channel', () => {
    const guilds = reactive<Record<string, GuildEntry>>({});

    let stopSSE: (() => void) | null = null;

    function getOrCreate(guildId: string): GuildEntry {
        if (!guilds[guildId]) {
            guilds[guildId] = {
                categories: [],
                loading: false,
                loaded: false,
                error: null,
                roles: null,
                rolesPending: null,
                channelMembers: {},
                channelMembersPending: {}
            };
        }
        return guilds[guildId];
    }

    function getCategories(guildId: string): GuildChannelCategory[] {
        return guilds[guildId]?.categories ?? [];
    }

    function isLoading(guildId: string): boolean {
        return guilds[guildId]?.loading ?? false;
    }

    function getError(guildId: string): string | null {
        return guilds[guildId]?.error ?? null;
    }

    /** Look up a channel's display name from cached categories. Returns
     *  null if the guild hasn't been loaded yet (hot SSE event) — the
     *  notification falls back to a channel-id title in that case. */
    function findChannelName(guildId: string, channelId: string): string | null {
        const entry = guilds[guildId];
        if (!entry) return null;
        for (const cat of entry.categories) {
            for (const ch of cat.channels) {
                if (ch.id === channelId) return ch.name;
            }
        }
        return null;
    }

    function startSSE() {
        if (stopSSE) return;
        const messageCache = useMessageCacheStore();
        const unread = useUnreadStore();
        const botStore = useBotStore();
        stopSSE = subscribeGuildEvents({
            onEvent(event) {
                if (event.type === 'guild-message-deleted') {
                    messageCache.applyEvent({
                        type: 'message-deleted',
                        channelId: event.channelId,
                        messageId: event.messageId
                    });
                } else {
                    messageCache.applyEvent({
                        type: event.type.replace('guild-', '') as 'message-created' | 'message-updated',
                        channelId: event.channelId,
                        message: event.message
                    });
                    if (event.type === 'guild-message-created' && event.message.author.id !== botStore.userId) {
                        unread.noteMessage(event.channelId, event.guildId, !!event.message.mentionsMe, event.message.id);
                        // Only notify when the user is elsewhere AND the
                        // message either mentions us or arrives in a
                        // non-muted channel. maybeNotify enforces the
                        // muted-but-mention escape hatch on its own.
                        if (unread.currentChannelId !== event.channelId) {
                            const channelName = findChannelName(event.guildId, event.channelId);
                            const author = event.message.author;
                            const senderName = author.globalName ?? author.username ?? 'Someone';
                            const body = event.message.content?.slice(0, 140)
                                || (event.message.attachments?.length ? '📎 attachment' : 'New message');
                            maybeNotify({
                                channelId: event.channelId,
                                surface: event.guildId,
                                title: channelName ? `${senderName} · #${channelName}` : senderName,
                                body,
                                iconUrl: author.avatarUrl,
                                isMention: !!event.message.mentionsMe
                            });
                        }
                    }
                }
            },
            onError: () => {}
        });
    }

    // Closes the live event stream and drops every per-guild cache so the
    // next sign-in repopulates from scratch. Pending member/role promises
    // are intentionally not awaited — they'll resolve into a discarded
    // entry and be GC'd.
    function reset() {
        if (stopSSE) {
            stopSSE();
            stopSSE = null;
        }
        for (const key of Object.keys(guilds)) delete guilds[key];
    }

    async function loadChannels(guildId: string) {
        const entry = getOrCreate(guildId);
        entry.loading = true;
        try {
            entry.categories = await apiListChannels(guildId);
            entry.loaded = true;
            entry.error = null;
        } catch (err) {
            entry.error = err instanceof Error ? err.message : 'Failed to load channels';
            throw err;
        } finally {
            entry.loading = false;
        }
    }

    async function ensureChannels(guildId: string) {
        const entry = guilds[guildId];
        if (!entry?.loaded && !entry?.loading) await loadChannels(guildId);
    }

    async function listMessages(guildId: string, channelId: string, opts: { limit?: number; before?: string }) {
        return apiGetMessages(guildId, channelId, opts);
    }

    function sendMessage(guildId: string, channelId: string, content: string, files: File[], stickerIds: string[], replyToMessageId?: string, replyPingAuthor?: boolean) {
        return apiSendMessage(guildId, channelId, content, files, stickerIds, replyToMessageId, replyPingAuthor);
    }

    function editMessage(guildId: string, channelId: string, messageId: string, content: string) {
        return apiEditMessage(guildId, channelId, messageId, content);
    }

    function deleteMessage(guildId: string, channelId: string, messageId: string) {
        return apiDeleteMessage(guildId, channelId, messageId);
    }

    function addReaction(guildId: string, channelId: string, messageId: string, emoji: MessageEmoji) {
        return apiAddReaction(guildId, channelId, messageId, emoji);
    }

    function removeReaction(guildId: string, channelId: string, messageId: string, emoji: MessageEmoji) {
        return apiRemoveReaction(guildId, channelId, messageId, emoji);
    }

    // Mentionables: lazy-fetched, deduped via pending promises so concurrent
    // suggestion calls don't spam the API. Cache lives until the page reloads —
    // members/roles rarely change within a session and a stale list is a better
    // UX than a spinner on every `@`.
    async function ensureRoles(guildId: string): Promise<GuildRoleSummary[]> {
        const entry = getOrCreate(guildId);
        if (entry.roles) return entry.roles;
        if (entry.rolesPending) return entry.rolesPending;
        const promise = apiListRoles(guildId).then(roles => {
            entry.roles = roles;
            return roles;
        }).finally(() => { entry.rolesPending = null; });
        entry.rolesPending = promise;
        return promise;
    }

    async function ensureChannelMembers(guildId: string, channelId: string): Promise<GuildChannelMember[]> {
        const entry = getOrCreate(guildId);
        const cached = entry.channelMembers[channelId];
        if (cached) return cached;
        const pending = entry.channelMembersPending[channelId];
        if (pending) return pending;
        const promise = apiListChannelMembers(guildId, channelId).then(members => {
            entry.channelMembers[channelId] = members;
            return members;
        }).finally(() => { delete entry.channelMembersPending[channelId]; });
        entry.channelMembersPending[channelId] = promise;
        return promise;
    }

    function getRoles(guildId: string): GuildRoleSummary[] | null {
        return guilds[guildId]?.roles ?? null;
    }

    function getChannelMembers(guildId: string, channelId: string): GuildChannelMember[] | null {
        return guilds[guildId]?.channelMembers[channelId] ?? null;
    }

    return {
        guilds,
        getCategories,
        isLoading,
        getError,
        startSSE,
        reset,
        loadChannels,
        ensureChannels,
        listMessages,
        sendMessage,
        editMessage,
        deleteMessage,
        addReaction,
        removeReaction,
        ensureRoles,
        ensureChannelMembers,
        getRoles,
        getChannelMembers,
    };
});
