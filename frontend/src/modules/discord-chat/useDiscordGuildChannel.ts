import { computed, onMounted, provide, ref, watch, type Ref } from 'vue';
import { MessageContextKey } from '../../libs/messages';
import { createDiscordMessageContext } from './createMessageContext';
import { createAuthErrorBail } from './useAuthErrorBail';
import { useDiscordChat } from './useDiscordChat';
import { useBotStore } from './stores/botStore';
import { useGuildChannelStore } from './stores/guildChannelStore';

export interface UseDiscordGuildChannelOptions {
    onAuthError?: () => void;
}

export function useDiscordGuildChannel(guildId: Ref<string | null>, opts: UseDiscordGuildChannelOptions = {}) {
    const guildStore = useGuildChannelStore();
    const botStore = useBotStore();

    const selectedChannelId = ref<string | null>(null);

    const bailOnAuthError = createAuthErrorBail({ onAuthError: opts.onAuthError });

    const botUserId = computed(() => botStore.userId);
    const botDisplayName = () => botStore.displayName();

    const categories = computed(() =>
        guildId.value ? guildStore.getCategories(guildId.value) : []
    );
    const channels = computed(() => categories.value.flatMap(c => c.channels));

    const chat = useDiscordChat({
        channelId: selectedChannelId,
        botUserId,
        api: {
            listMessages: (channelId, o) => guildStore.listMessages(guildId.value!, channelId, o),
            sendMessage: (channelId, content, files, stickerIds, replyToMessageId) =>
                guildStore.sendMessage(guildId.value!, channelId, content, files, stickerIds, replyToMessageId),
            editMessage: (channelId, messageId, content) =>
                guildStore.editMessage(guildId.value!, channelId, messageId, content),
            deleteMessage: (channelId, messageId) =>
                guildStore.deleteMessage(guildId.value!, channelId, messageId),
            addReaction: (channelId, messageId, emoji) =>
                guildStore.addReaction(guildId.value!, channelId, messageId, emoji),
            removeReaction: (channelId, messageId, emoji) =>
                guildStore.removeReaction(guildId.value!, channelId, messageId, emoji),
        },
        onError: bailOnAuthError,
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

    async function loadGuild(id: string, autoSelect = true) {
        try {
            await guildStore.ensureChannels(id);
            if (autoSelect && !selectedChannelId.value && channels.value.length > 0) {
                selectedChannelId.value = channels.value[0].id;
            }
        } catch (err) {
            bailOnAuthError(err);
        }
    }

    watch(guildId, async (id) => {
        selectedChannelId.value = null;
        if (id) await loadGuild(id);
    });

    onMounted(async () => {
        botStore.init();
        guildStore.startSSE();
        if (guildId.value) await loadGuild(guildId.value);
    });

    return {
        categories,
        channels,
        selectedChannelId,
        selectedChannel,
        loadingChannels: computed(() => guildId.value ? guildStore.isLoading(guildId.value) : false),
        channelsError: computed(() => guildId.value ? guildStore.getError(guildId.value) : null),
        botUserId,
        chat,
        send: chat.send,
        reactWithSelection: chat.reactWithSelection,
        refreshChannels: () => guildId.value ? guildStore.loadChannels(guildId.value) : Promise.resolve(),
    };
}
