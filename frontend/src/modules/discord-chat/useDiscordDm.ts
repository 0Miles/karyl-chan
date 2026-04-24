import { computed, onMounted, provide, ref, shallowRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { MessageContextKey } from '../../libs/messages';
import { createDiscordMessageContext } from './createMessageContext';
import { createDiscordMessageLinkHandler } from './discord-link-handler';
import { createAuthErrorBail } from './useAuthErrorBail';
import { useDiscordChat } from './useDiscordChat';
import { loadLastDmChannel, saveLastDmChannel, saveLastSurface } from './last-channel';
import { useWorkspace } from './useWorkspace';
import { useBotStore } from './stores/botStore';
import { useDmStore } from './stores/dmStore';
import { useUnreadSync } from './useUnreadSync';

export interface UseDiscordDmOptions {
    onAuthError?: () => void;
    /** Fired when the workspace machine's pending scroll target resolves (found or gave up). */
    onScrollFinished?: (messageId: string, found: boolean) => void;
    /** Scroller-aware scroll attempt — see UseWorkspaceOptions.attemptScroll. */
    attemptScroll?: (messageId: string) => boolean;
}

export function useDiscordDm(opts: UseDiscordDmOptions = {}) {
    const dmStore = useDmStore();
    const botStore = useBotStore();
    const router = useRouter();
    const { t } = useI18n();

    const newRecipientId = ref('');
    const showStart = ref(false);

    const bailOnAuthError = createAuthErrorBail({ onAuthError: opts.onAuthError });

    const botUserId = computed(() => botStore.userId);
    const botDisplayName = () => botStore.displayName();

    // DM surfaces have no guild id.
    const guildIdRef = shallowRef<string | null>(null);
    const availableChannelIds = computed(() => dmStore.channels.map(c => c.id));

    const workspace = useWorkspace({
        guildId: guildIdRef,
        availableChannelIds,
        readLastChannel: () => loadLastDmChannel(),
        onChannelCommitted: (_gid, channelId) => {
            saveLastDmChannel(channelId);
            saveLastSurface({ mode: 'dm', channelId });
        },
        onScrollFinished: opts.onScrollFinished,
        attemptScroll: opts.attemptScroll
    });

    const selectedChannelId = workspace.selectedChannelId;

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

    watch(chat.messages, () => workspace.notifyMessagesChanged());

    useUnreadSync(
        selectedChannelId,
        computed(() => dmStore.channels.map(c => ({ id: c.id, lastMarker: c.lastMessageId }))),
        'dm',
    );

    // Anchor-fetch pending scroll targets that aren't in the loaded
    // batch — typically a link click to an older DM message.
    let lastAroundFetch = '';
    watch(
        [workspace.pendingScrollTo, chat.messages],
        ([scrollTarget, msgs]) => {
            if (!scrollTarget || lastAroundFetch === scrollTarget) return;
            if (msgs.some(m => m.id === scrollTarget)) return;
            lastAroundFetch = scrollTarget;
            chat.loadAround(scrollTarget).catch(() => { /* best-effort */ });
        }
    );
    watch(workspace.pendingScrollTo, (v) => {
        if (v === null) lastAroundFetch = '';
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
        linkHandlers: [createDiscordMessageLinkHandler({
            router,
            currentChannelId: () => selectedChannelId.value,
            currentGuildId: () => null,
            unknownLabel: t('messages.linkUnknown')
        })],
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
            workspace.select(channel.id);
            showStart.value = false;
            newRecipientId.value = '';
        } catch (err) {
            if (bailOnAuthError(err)) return;
        }
    }

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
        selectChannel: workspace.select,
        requestScroll: workspace.requestScroll
    };
}
