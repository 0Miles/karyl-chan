import { defineStore } from 'pinia';
import { reactive } from 'vue';
import {
    addGuildReaction as apiAddReaction,
    deleteGuildMessage as apiDeleteMessage,
    editGuildMessage as apiEditMessage,
    getGuildMessages as apiGetMessages,
    listGuildTextChannels as apiListChannels,
    removeGuildReaction as apiRemoveReaction,
    sendGuildMessage as apiSendMessage,
    subscribeGuildEvents,
    type GuildChannelCategory,
} from '../../../api/guilds';
import type { MessageEmoji } from '../../../libs/messages';
import { useMessageCacheStore } from './messageCacheStore';

interface GuildEntry {
    categories: GuildChannelCategory[];
    loading: boolean;
    loaded: boolean;
    error: string | null;
}

export const useGuildChannelStore = defineStore('discord-guild-channel', () => {
    const guilds = reactive<Record<string, GuildEntry>>({});

    let stopSSE: (() => void) | null = null;

    function getOrCreate(guildId: string): GuildEntry {
        if (!guilds[guildId]) {
            guilds[guildId] = { categories: [], loading: false, loaded: false, error: null };
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

    function startSSE() {
        if (stopSSE) return;
        const messageCache = useMessageCacheStore();
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
                }
            },
            onError: () => {}
        });
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

    function sendMessage(guildId: string, channelId: string, content: string, files: File[], stickerIds: string[], replyToMessageId?: string) {
        return apiSendMessage(guildId, channelId, content, files, stickerIds, replyToMessageId);
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

    return {
        guilds,
        getCategories,
        isLoading,
        getError,
        startSSE,
        loadChannels,
        ensureChannels,
        listMessages,
        sendMessage,
        editMessage,
        deleteMessage,
        addReaction,
        removeReaction,
    };
});
