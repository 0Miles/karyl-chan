<script setup lang="ts">
import { computed, onMounted, onUnmounted, provide, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import {
    MessageView,
    MessageComposer,
    MessageContextKey,
    type MessageContext,
    type MessageEmoji,
    type OutgoingMessage,
    type Message,
    type MessageReference
} from '../messages';
import { ApiError } from '../api/client';
import {
    addReaction,
    getMessages,
    listChannels,
    removeReaction,
    sendMessage,
    startChannel,
    type DmChannelSummary
} from '../api/dm';

const router = useRouter();

function bailOnAuthError(err: unknown): boolean {
    if (err instanceof ApiError && err.status === 401) {
        stopTimers();
        router.replace({ name: 'auth' });
        return true;
    }
    return false;
}

const channels = ref<DmChannelSummary[]>([]);
const selectedChannelId = ref<string | null>(null);
const messages = ref<Message[]>([]);
const replyTo = ref<MessageReference | null>(null);
const loadingChannels = ref(false);
const loadingMessages = ref(false);
const loadingOlder = ref(false);
const hasMore = ref(false);
const sending = ref(false);
const error = ref<string | null>(null);
const newRecipientId = ref('');
const showStart = ref(false);
const messagesEnd = ref<HTMLDivElement | null>(null);
const messagesContainer = ref<HTMLDivElement | null>(null);

const PAGE_SIZE = 10;
const CHANNEL_REFRESH_MS = 10_000;
const MESSAGE_REFRESH_MS = 5_000;
let channelTimer: ReturnType<typeof setInterval> | null = null;
let messageTimer: ReturnType<typeof setInterval> | null = null;

const selectedChannel = computed(() =>
    channels.value.find(c => c.id === selectedChannelId.value) ?? null
);

async function refreshChannels(autoSelect = true) {
    loadingChannels.value = true;
    try {
        channels.value = await listChannels();
        if (autoSelect && !selectedChannelId.value && channels.value.length > 0) {
            selectChannel(channels.value[0].id);
        }
        error.value = null;
    } catch (err) {
        if (bailOnAuthError(err)) return;
        error.value = err instanceof Error ? err.message : 'Failed to load channels';
    } finally {
        loadingChannels.value = false;
    }
}

async function loadInitialMessages() {
    if (!selectedChannelId.value) return;
    loadingMessages.value = true;
    try {
        const result = await getMessages(selectedChannelId.value, { limit: PAGE_SIZE });
        messages.value = result.messages;
        hasMore.value = result.hasMore;
        error.value = null;
        requestAnimationFrame(scrollToBottom);
    } catch (err) {
        if (bailOnAuthError(err)) return;
        error.value = err instanceof Error ? err.message : 'Failed to load messages';
    } finally {
        loadingMessages.value = false;
    }
}

async function pollNewMessages() {
    if (!selectedChannelId.value) return;
    try {
        const result = await getMessages(selectedChannelId.value, { limit: PAGE_SIZE });
        const seen = new Set(messages.value.map(m => m.id));
        const additions = result.messages.filter(m => !seen.has(m.id));
        if (additions.length === 0) return;
        const wasNearBottom = isNearBottom();
        messages.value = [...messages.value, ...additions];
        if (wasNearBottom) requestAnimationFrame(scrollToBottom);
    } catch (err) {
        if (bailOnAuthError(err)) return;
        // Don't surface poll errors loudly — initial load already shows them.
    }
}

async function loadOlder() {
    if (!selectedChannelId.value || loadingOlder.value || !hasMore.value || messages.value.length === 0) return;
    loadingOlder.value = true;
    const container = messagesContainer.value;
    const scrollHeightBefore = container?.scrollHeight ?? 0;
    const scrollTopBefore = container?.scrollTop ?? 0;
    try {
        const result = await getMessages(selectedChannelId.value, {
            limit: PAGE_SIZE,
            before: messages.value[0].id
        });
        if (result.messages.length === 0) {
            hasMore.value = false;
            return;
        }
        messages.value = [...result.messages, ...messages.value];
        hasMore.value = result.hasMore;
        requestAnimationFrame(() => {
            if (!container) return;
            container.scrollTop = scrollTopBefore + (container.scrollHeight - scrollHeightBefore);
        });
    } catch (err) {
        if (bailOnAuthError(err)) return;
        error.value = err instanceof Error ? err.message : 'Failed to load older messages';
    } finally {
        loadingOlder.value = false;
    }
}

function onMessagesScroll(event: Event) {
    const el = event.target as HTMLDivElement;
    if (el.scrollTop < 80 && hasMore.value && !loadingOlder.value) {
        loadOlder();
    }
}

function selectChannel(id: string) {
    selectedChannelId.value = id;
    replyTo.value = null;
    messages.value = [];
    hasMore.value = false;
    loadInitialMessages();
}

function isNearBottom(): boolean {
    const el = messagesEnd.value?.parentElement;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 80;
}

function scrollToBottom() {
    messagesEnd.value?.scrollIntoView({ block: 'end' });
}

async function onSend(payload: OutgoingMessage) {
    if (!selectedChannelId.value) return;
    sending.value = true;
    try {
        const sent = await sendMessage(
            selectedChannelId.value,
            payload.content,
            payload.reference?.messageId ?? undefined
        );
        messages.value = [...messages.value, sent];
        replyTo.value = null;
        requestAnimationFrame(scrollToBottom);
        refreshChannels(false);
    } catch (err) {
        if (bailOnAuthError(err)) return;
        error.value = err instanceof Error ? err.message : 'Failed to send';
    } finally {
        sending.value = false;
    }
}

async function onReactionAdd(messageId: string, emoji: MessageEmoji) {
    if (!selectedChannelId.value) return;
    try {
        await addReaction(selectedChannelId.value, messageId, emoji);
        pollNewMessages();
    } catch (err) {
        if (bailOnAuthError(err)) return;
        error.value = err instanceof Error ? err.message : 'Failed to react';
    }
}

async function onReactionRemove(messageId: string, emoji: MessageEmoji) {
    if (!selectedChannelId.value) return;
    try {
        await removeReaction(selectedChannelId.value, messageId, emoji);
        pollNewMessages();
    } catch (err) {
        if (bailOnAuthError(err)) return;
        error.value = err instanceof Error ? err.message : 'Failed to remove reaction';
    }
}

function onReplyClick(messageId: string) {
    const target = messages.value.find(m => m.id === messageId);
    if (!target) return;
    document.querySelector(`[data-message-id="${messageId}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function onMessageReply(message: Message) {
    replyTo.value = {
        messageId: message.id,
        channelId: message.channelId
    };
}

async function startNewDm() {
    const id = newRecipientId.value.trim();
    if (!id) return;
    try {
        const channel = await startChannel(id);
        await refreshChannels(false);
        selectChannel(channel.id);
        showStart.value = false;
        newRecipientId.value = '';
    } catch (err) {
        if (bailOnAuthError(err)) return;
        error.value = err instanceof Error ? err.message : 'Failed to start DM';
    }
}

const ctx: MessageContext = {
    onReactionAdd,
    onReactionRemove,
    onReplyClick
};
provide(MessageContextKey, ctx);

watch(selectedChannelId, () => {
    if (messageTimer) clearInterval(messageTimer);
    if (selectedChannelId.value) {
        messageTimer = setInterval(pollNewMessages, MESSAGE_REFRESH_MS);
    }
});

function stopTimers() {
    if (channelTimer) { clearInterval(channelTimer); channelTimer = null; }
    if (messageTimer) { clearInterval(messageTimer); messageTimer = null; }
}

onMounted(() => {
    refreshChannels();
    channelTimer = setInterval(() => refreshChannels(false), CHANNEL_REFRESH_MS);
});

onUnmounted(() => {
    stopTimers();
});

function formatTimestamp(iso: string | null): string {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const now = new Date();
    if (d.toDateString() === now.toDateString()) {
        return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return d.toLocaleDateString();
}
</script>

<template>
    <section class="dm">
        <aside class="sidebar">
            <header class="sidebar-header">
                <h2>DMs</h2>
                <button type="button" class="ghost" @click="showStart = !showStart">+</button>
            </header>
            <form v-if="showStart" class="start-form" @submit.prevent="startNewDm">
                <input v-model="newRecipientId" placeholder="Recipient user id" />
                <button type="submit" :disabled="!newRecipientId.trim()">Start</button>
            </form>
            <p v-if="loadingChannels && channels.length === 0" class="muted">Loading…</p>
            <p v-else-if="channels.length === 0" class="muted empty">No DMs yet. Send the bot a message in Discord, or start one above.</p>
            <ul class="channel-list">
                <li
                    v-for="channel in channels"
                    :key="channel.id"
                    :class="{ active: channel.id === selectedChannelId }"
                    @click="selectChannel(channel.id)"
                >
                    <img v-if="channel.recipient.avatarUrl" :src="channel.recipient.avatarUrl" alt="" class="avatar" />
                    <div v-else class="avatar avatar-fallback">{{ (channel.recipient.globalName ?? channel.recipient.username).charAt(0).toUpperCase() }}</div>
                    <div class="meta">
                        <div class="row">
                            <span class="name">{{ channel.recipient.globalName ?? channel.recipient.username }}</span>
                            <span class="timestamp">{{ formatTimestamp(channel.lastMessageAt) }}</span>
                        </div>
                        <div class="preview">{{ channel.lastMessagePreview ?? '' }}</div>
                    </div>
                </li>
            </ul>
        </aside>
        <div class="conversation">
            <header v-if="selectedChannel" class="conv-header">
                <span class="title">{{ selectedChannel.recipient.globalName ?? selectedChannel.recipient.username }}</span>
                <span class="user-id">{{ selectedChannel.recipient.id }}</span>
            </header>
            <p v-if="error" class="error">{{ error }}</p>
            <div ref="messagesContainer" class="messages" @scroll.passive="onMessagesScroll">
                <p v-if="!selectedChannel" class="muted center">Select a DM to view messages.</p>
                <p v-else-if="loadingMessages && messages.length === 0" class="muted center">Loading…</p>
                <p v-else-if="messages.length === 0" class="muted center">No messages yet.</p>
                <p v-if="loadingOlder" class="muted center small">Loading older…</p>
                <p v-else-if="!hasMore && messages.length > 0" class="muted center small">Beginning of conversation</p>
                <div v-for="message in messages" :key="message.id" class="message-wrap">
                    <MessageView :message="message" />
                    <button type="button" class="reply-action" @click="onMessageReply(message)">Reply</button>
                </div>
                <div ref="messagesEnd" />
            </div>
            <footer v-if="selectedChannel" class="composer-row">
                <MessageComposer
                    :reply-to="replyTo"
                    :disabled="sending"
                    @send="onSend"
                    @cancel-reply="replyTo = null"
                />
            </footer>
        </div>
    </section>
</template>

<style scoped>
.dm {
    display: grid;
    grid-template-columns: 280px 1fr;
    height: calc(100vh - 4rem);
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg-surface);
    color: var(--text);
    overflow: hidden;
}
.sidebar {
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    overflow-y: auto;
}
.sidebar-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.75rem 1rem;
    border-bottom: 1px solid var(--border);
}
.sidebar-header h2 {
    margin: 0;
    font-size: 0.95rem;
}
.ghost {
    background: none;
    border: 1px solid var(--border);
    border-radius: 4px;
    width: 28px;
    height: 28px;
    cursor: pointer;
    color: var(--text);
}
.ghost:hover {
    background: var(--bg-surface-2);
}
.start-form {
    display: flex;
    gap: 0.25rem;
    padding: 0.5rem 0.75rem;
    border-bottom: 1px solid var(--border);
}
.start-form input {
    flex: 1;
    padding: 0.3rem 0.5rem;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg-surface);
    color: var(--text);
    font: inherit;
}
.start-form button {
    padding: 0.3rem 0.6rem;
    background: var(--accent);
    color: var(--text-on-accent);
    border: none;
    border-radius: 4px;
    cursor: pointer;
}
.start-form button:disabled {
    opacity: 0.5;
}
.channel-list {
    list-style: none;
    margin: 0;
    padding: 0;
}
.channel-list li {
    display: flex;
    gap: 0.6rem;
    padding: 0.5rem 0.75rem;
    cursor: pointer;
    border-bottom: 1px solid var(--border);
}
.channel-list li:hover {
    background: var(--bg-surface-hover);
}
.channel-list li.active {
    background: var(--bg-surface-active);
}
.avatar {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    flex-shrink: 0;
    object-fit: cover;
}
.avatar-fallback {
    background: var(--accent);
    color: var(--text-on-accent);
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 600;
}
.meta {
    flex: 1;
    min-width: 0;
}
.row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
}
.name {
    font-weight: 500;
    color: var(--text-strong);
}
.timestamp {
    font-size: 0.75rem;
    color: var(--text-muted);
}
.preview {
    font-size: 0.8rem;
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.conversation {
    display: flex;
    flex-direction: column;
    overflow: hidden;
}
.conv-header {
    padding: 0.6rem 1rem;
    border-bottom: 1px solid var(--border);
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
}
.title {
    font-weight: 600;
    color: var(--text-strong);
}
.user-id {
    color: var(--text-faint);
    font-size: 0.8rem;
    font-family: ui-monospace, SFMono-Regular, monospace;
}
.error {
    color: var(--danger);
    margin: 0.5rem 1rem;
}
.messages {
    flex: 1;
    overflow-y: auto;
    padding: 0.5rem 0;
}
.center {
    text-align: center;
    margin: 2rem 0;
}
.small {
    font-size: 0.8rem;
    margin: 0.5rem 0;
}
.message-wrap {
    position: relative;
}
.message-wrap:hover .reply-action {
    opacity: 1;
}
.reply-action {
    position: absolute;
    top: 6px;
    right: 12px;
    padding: 2px 6px;
    background: var(--bg-surface);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 4px;
    font-size: 0.75rem;
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.15s;
}
.composer-row {
    border-top: 1px solid var(--border);
    padding: 0.5rem 0.75rem;
}
.muted {
    color: var(--text-muted);
    font-size: 0.9rem;
}
.empty {
    padding: 1rem;
}
</style>
