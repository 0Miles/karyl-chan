import { computed, onMounted, onUnmounted, provide, ref, watch, type Ref } from 'vue';
import { MessageContextKey } from '../../libs/messages';
import {
    addGuildReaction,
    deleteGuildMessage,
    editGuildMessage,
    getGuildMessages,
    listGuildTextChannels,
    removeGuildReaction,
    sendGuildMessage,
    subscribeGuildEvents,
    type GuildChannelCategory,
    type GuildChannelEvent,
} from '../../api/guilds';
import { createDiscordMessageContext } from './createMessageContext';
import { createAuthErrorBail } from './useAuthErrorBail';
import { useBotIdentity } from './useBotIdentity';
import { useDiscordChat, type ChannelMessageEvent } from './useDiscordChat';

export interface UseDiscordGuildChannelOptions {
    onAuthError?: () => void;
}

export function useDiscordGuildChannel(guildId: Ref<string | null>, opts: UseDiscordGuildChannelOptions = {}) {
    const categories = ref<GuildChannelCategory[]>([]);
    const selectedChannelId = ref<string | null>(null);
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

    const channels = computed(() => categories.value.flatMap(c => c.channels));

    const chat = useDiscordChat({
        channelId: selectedChannelId,
        botUserId,
        api: {
            listMessages: (channelId, o) => getGuildMessages(guildId.value!, channelId, o),
            sendMessage: (channelId, content, files, stickerIds, replyToMessageId) =>
                sendGuildMessage(guildId.value!, channelId, content, files, stickerIds, replyToMessageId),
            editMessage: (channelId, messageId, content) =>
                editGuildMessage(guildId.value!, channelId, messageId, content),
            deleteMessage: (channelId, messageId) =>
                deleteGuildMessage(guildId.value!, channelId, messageId),
            addReaction: (channelId, messageId, emoji) =>
                addGuildReaction(guildId.value!, channelId, messageId, emoji),
            removeReaction: (channelId, messageId, emoji) =>
                removeGuildReaction(guildId.value!, channelId, messageId, emoji)
        },
        onError: bailOnAuthError
    });

    const selectedChannel = computed(() =>
        channels.value.find(c => c.id === selectedChannelId.value) ?? null
    );

    const messageContext = createDiscordMessageContext({
        botUserId,
        onReactionAdd: chat.reactAdd,
        onReactionRemove: chat.reactRemove,
        resolveUser(id) {
            if (botUserId.value === id) {
                const name = botDisplayName();
                return name ? { name } : null;
            }
            for (const message of chat.messages.value) {
                if (message.author.id === id) {
                    return { name: message.author.globalName ?? message.author.username };
                }
            }
            return null;
        },
        suggestionProviders: []
    });
    provide(MessageContextKey, messageContext);

    async function refreshChannels(autoSelect = true) {
        const id = guildId.value;
        if (!id) return;
        loadingChannels.value = true;
        try {
            categories.value = await listGuildTextChannels(id);
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

    function applyGuildEvent(event: GuildChannelEvent) {
        if (event.guildId !== guildId.value) return;
        if (event.type === 'guild-message-deleted') {
            chat.applyEvent({ type: 'message-deleted', channelId: event.channelId, messageId: event.messageId } satisfies ChannelMessageEvent);
            return;
        }
        chat.applyEvent({ type: event.type.replace('guild-', '') as ChannelMessageEvent['type'], channelId: event.channelId, message: event.message } as ChannelMessageEvent);
    }

    watch(guildId, (id) => {
        selectedChannelId.value = null;
        categories.value = [];
        if (id) refreshChannels();
    });

    onMounted(() => {
        if (guildId.value) refreshChannels();
        unsubscribeEvents = subscribeGuildEvents({
            onEvent: applyGuildEvent,
            onError: () => { /* EventSource auto-reconnects */ }
        });
    });

    onUnmounted(() => {
        unsubscribeEvents?.();
        unsubscribeEvents = null;
    });

    return {
        categories,
        channels,
        selectedChannelId,
        selectedChannel,
        loadingChannels,
        channelsError,
        botUserId,
        chat,
        send: chat.send,
        reactWithSelection: chat.reactWithSelection,
        refreshChannels
    };
}
