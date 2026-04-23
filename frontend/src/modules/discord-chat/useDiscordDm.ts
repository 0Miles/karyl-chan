import { computed, onMounted, onUnmounted, provide, ref } from 'vue';
import { MessageContextKey } from '../../libs/messages';
import {
    addReaction,
    deleteMessage,
    editMessage,
    getMessages,
    listChannels,
    removeReaction,
    sendMessage,
    startChannel,
    subscribeEvents,
    type DmChannelSummary,
    type DmEvent
} from '../../api/dm';
import { createDiscordMessageContext } from './createMessageContext';
import { createAuthErrorBail } from './useAuthErrorBail';
import { useBotIdentity } from './useBotIdentity';
import { useDiscordChat, type ChannelMessageEvent } from './useDiscordChat';

export interface UseDiscordDmOptions {
    /** Invoked when the backend reports 401; the caller decides where to navigate. */
    onAuthError?: () => void;
}

/**
 * Owns everything needed to drive a DM workspace: channel list, bot identity
 * (delegated to `useBotIdentity`), per-channel chat state (via `useDiscordChat`),
 * MessageContext assembly (via `createDiscordMessageContext`), and the SSE
 * subscription. The view consumes the returned state purely for layout.
 */
export function useDiscordDm(opts: UseDiscordDmOptions = {}) {
    const channels = ref<DmChannelSummary[]>([]);
    const selectedChannelId = ref<string | null>(null);
    const newRecipientId = ref('');
    const showStart = ref(false);
    const channelsError = ref<string | null>(null);
    const loadingChannels = ref(false);

    let unsubscribeEvents: (() => void) | null = null;

    const { botUserId, displayName: botDisplayName } = useBotIdentity();

    const bailOnAuthError = createAuthErrorBail({
        onAuthError: opts.onAuthError,
        onBail: () => {
            unsubscribeEvents?.();
            unsubscribeEvents = null;
        }
    });

    const chat = useDiscordChat({
        channelId: selectedChannelId,
        botUserId,
        api: {
            listMessages: (channelId, o) => getMessages(channelId, o).then(r => ({ messages: r.messages, hasMore: r.hasMore })),
            sendMessage,
            editMessage,
            deleteMessage,
            addReaction,
            removeReaction
        },
        onError: bailOnAuthError
    });

    const selectedChannel = computed(() =>
        channels.value.find(c => c.id === selectedChannelId.value) ?? null
    );

    function mentionMatches(query: string, ...candidates: (string | null | undefined)[]): boolean {
        if (!query) return true;
        const q = query.toLowerCase();
        return candidates.some(c => !!c && c.toLowerCase().includes(q));
    }

    const messageContext = createDiscordMessageContext({
        botUserId,
        onReactionAdd: chat.reactAdd,
        onReactionRemove: chat.reactRemove,
        resolveUser(id) {
            const channel = selectedChannel.value;
            if (channel?.recipient.id === id) {
                return { name: channel.recipient.globalName ?? channel.recipient.username };
            }
            if (botUserId.value === id) {
                const name = botDisplayName();
                return name ? { name } : null;
            }
            // Fall back to whatever the message itself carries — DMs sometimes
            // surface mentions of users we don't have profile data for, but the
            // referencedMessage / message.author shape may have it.
            for (const message of chat.messages.value) {
                if (message.author.id === id) {
                    return { name: message.author.globalName ?? message.author.username };
                }
            }
            return null;
        },
        suggestionProviders: [
            {
                triggers: ['@'],
                suggest({ query }) {
                    const channel = selectedChannel.value;
                    if (!channel) return [];
                    const items = [];
                    const recipient = channel.recipient;
                    const recipientName = recipient.globalName ?? recipient.username;
                    if (mentionMatches(query, recipientName, recipient.username, recipient.id)) {
                        items.push({
                            key: recipient.id,
                            label: recipientName,
                            secondary: recipient.username !== recipientName ? `@${recipient.username}` : null,
                            iconUrl: recipient.avatarUrl,
                            insert: `<@${recipient.id}>`
                        });
                    }
                    return items;
                }
            }
        ]
    });
    provide(MessageContextKey, messageContext);

    async function refreshChannels(autoSelect = true) {
        loadingChannels.value = true;
        try {
            channels.value = await listChannels();
            if (autoSelect && !selectedChannelId.value && channels.value.length > 0) {
                selectedChannelId.value = channels.value[0].id;
            }
            channelsError.value = null;
        } catch (err) {
            if (bailOnAuthError(err)) return;
            channelsError.value = err instanceof Error ? err.message : 'Failed to load channels';
        } finally {
            loadingChannels.value = false;
        }
    }

    function applyDmEvent(event: DmEvent) {
        if (event.type === 'channel-touched') {
            const idx = channels.value.findIndex(c => c.id === event.channel.id);
            if (idx === -1) channels.value = [event.channel, ...channels.value];
            else channels.value = channels.value.map(c => (c.id === event.channel.id ? event.channel : c));
            channels.value = [...channels.value].sort((a, b) =>
                (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? ''));
            return;
        }
        chat.applyEvent(event satisfies ChannelMessageEvent);
    }

    async function send(payload: Parameters<typeof chat.send>[0]) {
        const sent = await chat.send(payload);
        if (!sent) return null;
        const summary = channels.value.find(c => c.id === sent.channelId);
        if (summary) {
            applyDmEvent({
                type: 'channel-touched',
                channel: {
                    ...summary,
                    lastMessageAt: sent.createdAt,
                    lastMessagePreview: sent.content || (sent.attachments?.length ? `📎 ${sent.attachments[0].filename}` : '')
                }
            });
        }
        return sent;
    }

    async function startNewDm() {
        const id = newRecipientId.value.trim();
        if (!id) return;
        try {
            const channel = await startChannel(id);
            await refreshChannels(false);
            selectedChannelId.value = channel.id;
            showStart.value = false;
            newRecipientId.value = '';
        } catch (err) {
            if (bailOnAuthError(err)) return;
            channelsError.value = err instanceof Error ? err.message : 'Failed to start DM';
        }
    }

    onMounted(() => {
        refreshChannels();
        unsubscribeEvents = subscribeEvents({
            onEvent: applyDmEvent,
            onError: () => { /* EventSource auto-reconnects */ }
        });
    });

    onUnmounted(() => {
        unsubscribeEvents?.();
        unsubscribeEvents = null;
    });

    return {
        // channel list state
        channels,
        selectedChannelId,
        selectedChannel,
        loadingChannels,
        channelsError,
        showStart,
        newRecipientId,
        // bot identity
        botUserId,
        // per-channel chat (from useDiscordChat)
        chat,
        // actions
        send,
        reactWithSelection: chat.reactWithSelection,
        startNewDm,
        refreshChannels
    };
}
