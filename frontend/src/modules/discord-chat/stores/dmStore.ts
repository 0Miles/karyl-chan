import { defineStore } from 'pinia';
import { ref } from 'vue';
import {
    addReaction as apiAddReaction,
    deleteMessage as apiDeleteMessage,
    editMessage as apiEditMessage,
    getMessages as apiGetMessages,
    listChannels as apiListChannels,
    removeReaction as apiRemoveReaction,
    sendMessage as apiSendMessage,
    startChannel as apiStartChannel,
    subscribeEvents,
    type DmChannelSummary,
} from '../../../api/dm';
import type { MessageEmoji } from '../../../libs/messages';
import { useMessageCacheStore, type ChannelMessageEvent } from './messageCacheStore';
import { useBotStore } from './botStore';
import { useUnreadStore } from './unreadStore';

export const useDmStore = defineStore('discord-dm', () => {
    const channels = ref<DmChannelSummary[]>([]);
    const loadingChannels = ref(false);
    const channelsLoaded = ref(false);
    const error = ref<string | null>(null);

    let stopSSE: (() => void) | null = null;

    function touchChannel(channel: DmChannelSummary) {
        const idx = channels.value.findIndex(c => c.id === channel.id);
        if (idx === -1) {
            channels.value = [channel, ...channels.value];
        } else {
            channels.value = channels.value.map(c => c.id === channel.id ? channel : c);
        }
        channels.value = [...channels.value].sort(
            (a, b) => (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? '')
        );
    }

    function startSSE() {
        if (stopSSE) return;
        const messageCache = useMessageCacheStore();
        const unread = useUnreadStore();
        const botStore = useBotStore();
        stopSSE = subscribeEvents({
            onEvent(event) {
                if (event.type === 'channel-touched') {
                    touchChannel(event.channel);
                } else {
                    messageCache.applyEvent(event satisfies ChannelMessageEvent);
                    if (event.type === 'message-created' && event.message.author.id !== botStore.userId) {
                        unread.noteMessage(event.channelId, 'dm');
                    }
                }
            },
            onError: () => {}
        });
    }

    async function loadChannels() {
        loadingChannels.value = true;
        try {
            channels.value = await apiListChannels();
            channelsLoaded.value = true;
            error.value = null;
        } catch (err) {
            error.value = err instanceof Error ? err.message : 'Failed to load channels';
            throw err;
        } finally {
            loadingChannels.value = false;
        }
    }

    async function ensureChannels() {
        if (!channelsLoaded.value && !loadingChannels.value) await loadChannels();
    }

    async function startNewDmChannel(recipientUserId: string): Promise<DmChannelSummary> {
        const channel = await apiStartChannel(recipientUserId);
        await loadChannels();
        return channel;
    }

    async function listMessages(channelId: string, opts: { limit?: number; before?: string }) {
        const result = await apiGetMessages(channelId, opts);
        return { messages: result.messages, hasMore: result.hasMore };
    }

    function sendMessage(channelId: string, content: string, files: File[], stickerIds: string[], replyToMessageId?: string) {
        return apiSendMessage(channelId, content, files, stickerIds, replyToMessageId);
    }

    function editMessage(channelId: string, messageId: string, content: string) {
        return apiEditMessage(channelId, messageId, content);
    }

    function deleteMessage(channelId: string, messageId: string) {
        return apiDeleteMessage(channelId, messageId);
    }

    function addReaction(channelId: string, messageId: string, emoji: MessageEmoji) {
        return apiAddReaction(channelId, messageId, emoji);
    }

    function removeReaction(channelId: string, messageId: string, emoji: MessageEmoji) {
        return apiRemoveReaction(channelId, messageId, emoji);
    }

    return {
        channels,
        loadingChannels,
        channelsLoaded,
        error,
        touchChannel,
        startSSE,
        loadChannels,
        ensureChannels,
        startNewDmChannel,
        listMessages,
        sendMessage,
        editMessage,
        deleteMessage,
        addReaction,
        removeReaction,
    };
});
