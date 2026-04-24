import { computed, onMounted, provide, ref, watch } from 'vue';
import { MessageContextKey } from '../../libs/messages';
import { createDiscordMessageContext } from './createMessageContext';
import { createAuthErrorBail } from './useAuthErrorBail';
import { useDiscordChat } from './useDiscordChat';
import { loadLastDmChannel, saveLastDmChannel } from './last-channel';
import { useBotStore } from './stores/botStore';
import { useDmStore } from './stores/dmStore';

export interface UseDiscordDmOptions {
    onAuthError?: () => void;
}

export function useDiscordDm(opts: UseDiscordDmOptions = {}) {
    const dmStore = useDmStore();
    const botStore = useBotStore();

    const selectedChannelId = ref<string | null>(null);
    const newRecipientId = ref('');
    const showStart = ref(false);

    const bailOnAuthError = createAuthErrorBail({ onAuthError: opts.onAuthError });

    const botUserId = computed(() => botStore.userId);
    const botDisplayName = () => botStore.displayName();

    const chat = useDiscordChat({
        channelId: selectedChannelId,
        botUserId,
        api: {
            listMessages: dmStore.listMessages,
            sendMessage: dmStore.sendMessage,
            editMessage: dmStore.editMessage,
            deleteMessage: dmStore.deleteMessage,
            addReaction: dmStore.addReaction,
            removeReaction: dmStore.removeReaction,
        },
        onError: bailOnAuthError,
    });

    const selectedChannel = computed(() =>
        dmStore.channels.find(c => c.id === selectedChannelId.value) ?? null
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
                    const selfId = botUserId.value;
                    const selfUsername = botStore.username;
                    const selfName = botDisplayName() ?? selfUsername;
                    if (selfId && selfName && mentionMatches(query, selfName, selfUsername, selfId)) {
                        items.push({
                            key: selfId,
                            label: selfName,
                            secondary: selfUsername && selfUsername !== selfName ? `@${selfUsername}` : null,
                            iconUrl: botStore.avatarUrl,
                            insert: `<@${selfId}>`
                        });
                    }
                    return items;
                }
            }
        ]
    });
    provide(MessageContextKey, messageContext);

    async function send(payload: Parameters<typeof chat.send>[0]) {
        const sent = await chat.send(payload);
        if (!sent) return null;
        const summary = dmStore.channels.find(c => c.id === sent.channelId);
        if (summary) {
            dmStore.touchChannel({
                ...summary,
                lastMessageAt: sent.createdAt,
                lastMessagePreview: sent.content || (sent.attachments?.length ? `📎 ${sent.attachments[0].filename}` : '')
            });
        }
        return sent;
    }

    async function startNewDm() {
        const id = newRecipientId.value.trim();
        if (!id) return;
        try {
            const channel = await dmStore.startNewDmChannel(id);
            selectedChannelId.value = channel.id;
            showStart.value = false;
            newRecipientId.value = '';
        } catch (err) {
            if (bailOnAuthError(err)) return;
        }
    }

    // Only persist ids we've verified against the live list — stops a
    // stale URL param (e.g. a guild channel id left over from a mode
    // switch) from being written to localStorage before the selection
    // watcher below re-picks a valid DM channel. Depends on the channel
    // list too so a URL-seeded selection that arrives before `ensureChannels`
    // completes still gets persisted once the list populates.
    watch([selectedChannelId, () => dmStore.channels], ([id, list]) => {
        if (!id) return;
        if (!list.some(c => c.id === id)) return;
        saveLastDmChannel(id);
    });

    // Same selection policy as useDiscordGuildChannel: validate the
    // current id against the live list, otherwise fall back to the
    // localStorage record and then the first channel. Depends on
    // selectedChannelId too so any externally-set invalid id (URL query,
    // deep link) is immediately corrected without waiting for a list
    // mutation. Immediate so a hot nav with a pre-populated store still
    // picks a channel.
    watch([() => dmStore.channels, selectedChannelId], ([list, current]) => {
        if (list.length === 0) return;
        if (current && list.some(c => c.id === current)) return;
        const remembered = loadLastDmChannel();
        const match = remembered ? list.find(c => c.id === remembered) : null;
        selectedChannelId.value = match ? match.id : list[0].id;
    }, { immediate: true });

    onMounted(async () => {
        botStore.init();
        dmStore.startSSE();
        try {
            await dmStore.ensureChannels();
        } catch (err) {
            bailOnAuthError(err);
        }
    });

    return {
        channels: computed(() => dmStore.channels),
        selectedChannelId,
        selectedChannel,
        loadingChannels: computed(() => dmStore.loadingChannels),
        channelsError: computed(() => dmStore.error),
        showStart,
        newRecipientId,
        botUserId,
        chat,
        send,
        reactWithSelection: chat.reactWithSelection,
        startNewDm,
        refreshChannels: () => dmStore.loadChannels(),
    };
}
