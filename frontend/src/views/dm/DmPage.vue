<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, provide, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import DmSidebar from './DmSidebar.vue';
import {
    DiscordConversation,
    createDiscordMediaProvider,
    useDiscordChat,
    type ChannelMessageEvent
} from '../../modules/discord-chat';
import { ApiError, api as botApi } from '../../api/client';
import { listEmojis, listStickers, loadStickerLottie } from '../../api/discord';
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
import { MessageContextKey, type MessageContext } from '../../libs/messages';
import type { MediaSelection } from '../../libs/messages/picker/MediaPicker.vue';

const router = useRouter();

const channels = ref<DmChannelSummary[]>([]);
const selectedChannelId = ref<string | null>(null);
const botUserId = ref<string | null>(null);
const botUserTag = ref<string | null>(null);
const newRecipientId = ref('');
const showStart = ref(false);
const channelsError = ref<string | null>(null);
const loadingChannels = ref(false);

function botDisplayName(): string | null {
    const tag = botUserTag.value;
    if (!tag) return null;
    return tag.includes('#') ? tag.split('#')[0] : tag;
}

let unsubscribeEvents: (() => void) | null = null;

function bailOnAuthError(err: unknown): boolean {
    if (err instanceof ApiError && err.status === 401) {
        unsubscribeEvents?.();
        unsubscribeEvents = null;
        router.replace({ name: 'auth' });
        return true;
    }
    return false;
}

const chat = useDiscordChat({
    channelId: selectedChannelId,
    botUserId,
    api: {
        listMessages: (channelId, opts) => getMessages(channelId, opts).then(r => ({ messages: r.messages, hasMore: r.hasMore })),
        sendMessage: (channelId, content, files, stickerIds, replyToMessageId) =>
            sendMessage(channelId, content, files, stickerIds, replyToMessageId),
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

const conversationRef = ref<InstanceType<typeof DiscordConversation> | null>(null);
watch(() => conversationRef.value?.messagesContainer, (container) => {
    if (!container) return;
    chat.bindContainers({
        messagesContainer: container,
        messagesEnd: container.querySelector(':scope > div:last-of-type') as HTMLElement | null
    });
});

function matchesMentionQuery(name: string, query: string): boolean {
    if (!query) return true;
    return name.toLowerCase().includes(query.toLowerCase());
}

const ctx: MessageContext = {
    onReactionAdd: chat.reactAdd,
    onReactionRemove: chat.reactRemove,
    onReplyClick: (id) => document.querySelector(`[data-message-id="${id}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
    get currentUserId() { return botUserId.value; },
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
    mediaProvider: createDiscordMediaProvider({
        listEmojis,
        listStickers,
        loadLottieSticker: loadStickerLottie
    }),
    suggestionProviders: [
        {
            triggers: ['@'],
            suggest({ query }) {
                const channel = selectedChannel.value;
                if (!channel) return [];
                const items = [];
                const recipient = channel.recipient;
                const recipientName = recipient.globalName ?? recipient.username;
                if (matchesMentionQuery(recipientName, query)) {
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
} as MessageContext;
provide(MessageContextKey, ctx);

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

async function onSend(payload: Parameters<typeof chat.send>[0]) {
    const sent = await chat.send(payload);
    if (!sent) return;
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
}

async function onReactPicked(messageId: string, selection: MediaSelection) {
    if (selection.type === 'sticker') return;
    const emoji = selection.type === 'unicode'
        ? { id: null, name: selection.value }
        : { id: selection.id, name: selection.name, animated: selection.animated };
    await chat.reactAdd(messageId, emoji);
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
    botApi.getBotStatus().then(status => {
        botUserId.value = status.userId;
        botUserTag.value = status.userTag;
    }).catch(() => {});
    unsubscribeEvents = subscribeEvents({
        onEvent: applyDmEvent,
        onError: () => { /* EventSource auto-reconnects */ }
    });
});

onUnmounted(() => {
    unsubscribeEvents?.();
    unsubscribeEvents = null;
});
</script>

<template>
    <section class="dm-page">
        <DmSidebar
            title="DMs"
            :channels="channels"
            :selected-id="selectedChannelId"
            :loading="loadingChannels"
            :show-start-form="showStart"
            :new-recipient-id="newRecipientId"
            empty-hint="No DMs yet. Send the bot a message in Discord, or start one above."
            @select="(id) => (selectedChannelId = id)"
            @toggle-start="showStart = !showStart"
            @submit-start="startNewDm"
            @update:newRecipientId="(v) => (newRecipientId = v)"
        />
        <DiscordConversation
            ref="conversationRef"
            :channel-id="selectedChannelId"
            :header-title="selectedChannel ? (selectedChannel.recipient.globalName ?? selectedChannel.recipient.username) : null"
            :header-subtitle="selectedChannel?.recipient.id ?? null"
            :messages="chat.messages.value"
            :bot-user-id="botUserId"
            :has-more="chat.hasMore.value"
            :loading-messages="chat.loadingMessages.value"
            :loading-older="chat.loadingOlder.value"
            :sending="chat.sending.value"
            :error="chat.error.value ?? channelsError"
            :editing-message-id="chat.editingMessageId.value"
            :reply-to="chat.replyTo.value"
            @send="onSend"
            @reply="chat.reply"
            @cancel-reply="chat.cancelReply"
            @request-edit="chat.startEdit"
            @submit-edit="chat.submitEdit"
            @cancel-edit="chat.cancelEdit"
            @delete="chat.confirmDelete"
            @load-older="chat.loadOlder"
            @react="onReactPicked"
        />
    </section>
</template>

<style scoped>
.dm-page {
    display: grid;
    grid-template-columns: 280px 1fr;
    height: 100%;
    min-height: 0;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg-surface);
    color: var(--text);
    overflow: hidden;
}
</style>
