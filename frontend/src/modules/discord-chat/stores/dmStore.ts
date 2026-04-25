import { defineStore } from 'pinia';
import { ref } from 'vue';
import {
    addReaction as apiAddReaction,
    deleteMessage as apiDeleteMessage,
    editMessage as apiEditMessage,
    fetchUnreadCounts as apiFetchUnreadCounts,
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
import { maybeNotify } from '../notifications';

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
                        unread.noteMessage(event.channelId, 'dm', false, event.message.id);
                        // Skip the notification if the user is actively
                        // viewing this DM — they don't need an OS-level
                        // ping for content already on their screen.
                        if (unread.currentChannelId !== event.channelId) {
                            const channel = channels.value.find(c => c.id === event.channelId);
                            const author = event.message.author;
                            const senderName = author.globalName ?? author.username ?? 'Someone';
                            const recipientName = channel?.recipient.globalName ?? channel?.recipient.username;
                            // Title is the conversation, not the sender, so
                            // a flurry of replies in one DM collapses to a
                            // single OS notification (tag = channelId).
                            const title = recipientName ?? senderName;
                            const body = event.message.content?.slice(0, 140)
                                || (event.message.attachments?.length ? '📎 attachment' : 'New message');
                            maybeNotify({
                                channelId: event.channelId,
                                surface: 'dm',
                                title: `${senderName} · ${title}`,
                                body,
                                iconUrl: author.avatarUrl
                            });
                        }
                    }
                }
            },
            onError: () => {}
        });
    }

    // Closes the live event stream and resets the in-memory channel list.
    // Called on sign-out so the previous session's EventSource doesn't
    // outlive the auth token (and so the next sign-in starts clean).
    function reset() {
        if (stopSSE) {
            stopSSE();
            stopSSE = null;
        }
        channels.value = [];
        loadingChannels.value = false;
        channelsLoaded.value = false;
        error.value = null;
    }

    async function loadChannels() {
        loadingChannels.value = true;
        try {
            channels.value = await apiListChannels();
            channelsLoaded.value = true;
            error.value = null;
            // Backfill unread counts for channels that accumulated messages
            // while the app was closed. Runs in the background so sidebar
            // paints immediately — counts light up a beat later.
            void refreshHistoricalUnread();
        } catch (err) {
            error.value = err instanceof Error ? err.message : 'Failed to load channels';
            throw err;
        } finally {
            loadingChannels.value = false;
        }
    }

    async function refreshHistoricalUnread() {
        if (channels.value.length === 0) return;
        const unread = useUnreadStore();
        const lastSeen: Record<string, string | null> = {};
        const snapshot: Record<string, number> = {};
        for (const c of channels.value) {
            lastSeen[c.id] = unread.lastSeen[c.id] ?? null;
            snapshot[c.id] = unread.getChannelCount(c.id);
        }
        try {
            const result = await apiFetchUnreadCounts(lastSeen);
            for (const [channelId, { count }] of Object.entries(result)) {
                unread.applyHistoricalCount(channelId, 'dm', count, snapshot[channelId] ?? 0);
            }
        } catch {
            /* best-effort backfill */
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

    function sendMessage(channelId: string, content: string, files: File[], stickerIds: string[], replyToMessageId?: string, replyPingAuthor?: boolean) {
        return apiSendMessage(channelId, content, files, stickerIds, replyToMessageId, replyPingAuthor);
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
        reset,
        loadChannels,
        ensureChannels,
        refreshHistoricalUnread,
        startNewDmChannel,
        listMessages,
        sendMessage,
        editMessage,
        deleteMessage,
        addReaction,
        removeReaction,
    };
});
