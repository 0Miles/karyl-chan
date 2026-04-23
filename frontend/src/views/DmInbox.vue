<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, provide, ref } from 'vue';
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
import MessageComposerComponent from '../messages/MessageComposer.vue';
import { animatedAvatarUrl, isAnimatedAvatar } from '../messages/avatar';
import MediaPicker, { type MediaSelection } from '../messages/picker/MediaPicker.vue';
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
} from '../api/dm';
import { api as botApi } from '../api/client';

const router = useRouter();

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
let unsubscribeEvents: (() => void) | null = null;
const hoveredChannelId = ref<string | null>(null);
const composerRef = ref<InstanceType<typeof MessageComposerComponent> | null>(null);
const isDraggingFiles = ref(false);
let dragCounter = 0;
const botUserId = ref<string | null>(null);
const editingMessageId = ref<string | null>(null);
const reactingMessageId = ref<string | null>(null);
const shiftHeld = ref(false);
function trackShift(event: KeyboardEvent) { shiftHeld.value = event.shiftKey; }
function releaseShift() { shiftHeld.value = false; }

function isOwnMessage(message: Message): boolean {
    return botUserId.value !== null && message.author.id === botUserId.value;
}

function isFileDrag(event: DragEvent): boolean {
    const types = event.dataTransfer?.types;
    if (!types) return false;
    for (let i = 0; i < types.length; i++) {
        if (types[i] === 'Files') return true;
    }
    return false;
}

function onDragEnter(event: DragEvent) {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    dragCounter++;
    isDraggingFiles.value = true;
}
function onDragOver(event: DragEvent) {
    if (!isFileDrag(event)) return;
    event.preventDefault();
}
function onDragLeave() {
    dragCounter = Math.max(0, dragCounter - 1);
    if (dragCounter === 0) isDraggingFiles.value = false;
}
function onDrop(event: DragEvent) {
    event.preventDefault();
    dragCounter = 0;
    isDraggingFiles.value = false;
    const files = event.dataTransfer?.files;
    if (!files || files.length === 0) return;
    composerRef.value?.addFiles(Array.from(files));
}

function rowAvatarSrc(channel: DmChannelSummary): string | null {
    const url = channel.recipient.avatarUrl;
    if (!url) return null;
    if (hoveredChannelId.value === channel.id && isAnimatedAvatar(url)) return animatedAvatarUrl(url);
    return url;
}

const GROUP_WINDOW_MS = 5 * 60 * 1000;

function isContinuation(prev: Message | undefined, curr: Message): boolean {
    if (!prev) return false;
    if (prev.author.id !== curr.author.id) return false;
    if (curr.referencedMessage) return false;
    const diff = new Date(curr.createdAt).getTime() - new Date(prev.createdAt).getTime();
    return diff >= 0 && diff <= GROUP_WINDOW_MS;
}

function bailOnAuthError(err: unknown): boolean {
    if (err instanceof ApiError && err.status === 401) {
        unsubscribeEvents?.();
        unsubscribeEvents = null;
        router.replace({ name: 'auth' });
        return true;
    }
    return false;
}

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
        await nextTick();
        scrollToBottom();
        await fillIfNoScrollbar();
    } catch (err) {
        if (bailOnAuthError(err)) return;
        error.value = err instanceof Error ? err.message : 'Failed to load messages';
    } finally {
        loadingMessages.value = false;
    }
}

async function fillIfNoScrollbar() {
    await nextTick();
    const el = messagesContainer.value;
    if (!el) return;
    if (el.scrollHeight <= el.clientHeight && hasMore.value && !loadingOlder.value) {
        await loadOlder();
    }
}

function applyEvent(event: DmEvent) {
    if (event.type === 'channel-touched') {
        const idx = channels.value.findIndex(c => c.id === event.channel.id);
        if (idx === -1) channels.value = [event.channel, ...channels.value];
        else channels.value = channels.value
            .map(c => (c.id === event.channel.id ? event.channel : c));
        channels.value = [...channels.value].sort((a, b) =>
            (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? ''));
        return;
    }
    if (event.channelId !== selectedChannelId.value) return;
    if (event.type === 'message-created') {
        if (messages.value.some(m => m.id === event.message.id)) return;
        const wasNearBottom = isNearBottom();
        messages.value = [...messages.value, event.message];
        if (wasNearBottom) requestAnimationFrame(scrollToBottom);
    } else if (event.type === 'message-updated') {
        messages.value = messages.value.map(m => (m.id === event.message.id ? event.message : m));
    } else if (event.type === 'message-deleted') {
        messages.value = messages.value.filter(m => m.id !== event.messageId);
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
        await nextTick();
        if (container) {
            container.scrollTop = scrollTopBefore + (container.scrollHeight - scrollHeightBefore);
        }
    } catch (err) {
        if (bailOnAuthError(err)) return;
        error.value = err instanceof Error ? err.message : 'Failed to load older messages';
    } finally {
        loadingOlder.value = false;
    }
    await fillIfNoScrollbar();
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
            payload.attachments ?? [],
            payload.stickerIds ?? [],
            payload.reference?.messageId ?? undefined
        );
        replyTo.value = null;
        // Optimistic update so the operator sees their own send immediately.
        // The matching SSE message-created event is de-duped by id below.
        applyEvent({ type: 'message-created', channelId: sent.channelId, message: sent });
        const summary = channels.value.find(c => c.id === sent.channelId);
        if (summary) {
            applyEvent({
                type: 'channel-touched',
                channel: {
                    ...summary,
                    lastMessageAt: sent.createdAt,
                    lastMessagePreview: sent.content || (sent.attachments?.length ? `📎 ${sent.attachments[0].filename}` : '')
                }
            });
        }
    } catch (err) {
        if (bailOnAuthError(err)) return;
        error.value = err instanceof Error ? err.message : 'Failed to send';
    } finally {
        sending.value = false;
    }
}

function emojiMatches(a: MessageEmoji, b: MessageEmoji): boolean {
    if (a.id || b.id) return a.id === b.id;
    return a.name === b.name;
}

function applyReactionDelta(messageId: string, emoji: MessageEmoji, delta: 1 | -1) {
    messages.value = messages.value.map(m => {
        if (m.id !== messageId) return m;
        const existing = m.reactions ?? [];
        let found = false;
        const updated = existing.map(r => {
            if (!emojiMatches(r.emoji, emoji)) return r;
            found = true;
            return { ...r, count: Math.max(0, r.count + delta), me: delta > 0 };
        }).filter(r => r.count > 0);
        if (!found && delta > 0) updated.push({ emoji, count: 1, me: true });
        return { ...m, reactions: updated };
    });
}

async function onReactionAdd(messageId: string, emoji: MessageEmoji) {
    if (!selectedChannelId.value) return;
    applyReactionDelta(messageId, emoji, 1);
    try {
        await addReaction(selectedChannelId.value, messageId, emoji);
    } catch (err) {
        applyReactionDelta(messageId, emoji, -1);
        if (bailOnAuthError(err)) return;
        error.value = err instanceof Error ? err.message : 'Failed to react';
    }
}

async function onReactionRemove(messageId: string, emoji: MessageEmoji) {
    if (!selectedChannelId.value) return;
    applyReactionDelta(messageId, emoji, -1);
    try {
        await removeReaction(selectedChannelId.value, messageId, emoji);
    } catch (err) {
        applyReactionDelta(messageId, emoji, 1);
        if (bailOnAuthError(err)) return;
        error.value = err instanceof Error ? err.message : 'Failed to remove reaction';
    }
}

function startEdit(message: Message) {
    if (!isOwnMessage(message)) return;
    editingMessageId.value = message.id;
}

function cancelEdit() {
    editingMessageId.value = null;
}

async function submitEdit(message: Message, content: string) {
    if (!selectedChannelId.value) return;
    const trimmed = content.trim();
    if (!trimmed) {
        editingMessageId.value = null;
        return;
    }
    try {
        await editMessage(selectedChannelId.value, message.id, trimmed);
        editingMessageId.value = null;
    } catch (err) {
        if (bailOnAuthError(err)) return;
        error.value = err instanceof Error ? err.message : 'Failed to edit';
    }
}

async function confirmDelete(message: Message, event?: MouseEvent) {
    if (!selectedChannelId.value || !isOwnMessage(message)) return;
    const skipPrompt = event?.shiftKey === true;
    if (!skipPrompt && !window.confirm('Delete this message?')) return;
    try {
        await deleteMessage(selectedChannelId.value, message.id);
    } catch (err) {
        if (bailOnAuthError(err)) return;
        error.value = err instanceof Error ? err.message : 'Failed to delete';
    }
}

function startReact(messageId: string) {
    reactingMessageId.value = reactingMessageId.value === messageId ? null : messageId;
}

async function onReactPicked(selection: MediaSelection) {
    if (!selectedChannelId.value || !reactingMessageId.value) return;
    if (selection.type === 'sticker') return;
    const emoji: MessageEmoji = selection.type === 'unicode'
        ? { id: null, name: selection.value }
        : { id: selection.id, name: selection.name, animated: selection.animated };
    const targetId = reactingMessageId.value;
    reactingMessageId.value = null;
    applyReactionDelta(targetId, emoji, 1);
    try {
        await addReaction(selectedChannelId.value, targetId, emoji);
    } catch (err) {
        applyReactionDelta(targetId, emoji, -1);
        if (bailOnAuthError(err)) return;
        error.value = err instanceof Error ? err.message : 'Failed to react';
    }
}

function closeReactPicker() {
    reactingMessageId.value = null;
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
    onReplyClick,
    get currentUserId() { return botUserId.value; }
} as MessageContext;
provide(MessageContextKey, ctx);

onMounted(() => {
    refreshChannels();
    botApi.getBotStatus().then(status => { botUserId.value = status.userId; }).catch(() => {});
    unsubscribeEvents = subscribeEvents({
        onEvent: applyEvent,
        onError: () => { /* EventSource auto-reconnects */ }
    });
    document.addEventListener('keydown', trackShift);
    document.addEventListener('keyup', trackShift);
    window.addEventListener('blur', releaseShift);
});

onUnmounted(() => {
    unsubscribeEvents?.();
    unsubscribeEvents = null;
    document.removeEventListener('keydown', trackShift);
    document.removeEventListener('keyup', trackShift);
    window.removeEventListener('blur', releaseShift);
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
                    @mouseenter="hoveredChannelId = channel.id"
                    @mouseleave="hoveredChannelId = null"
                >
                    <img v-if="rowAvatarSrc(channel)" :src="rowAvatarSrc(channel) ?? ''" alt="" class="avatar" />
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
        <div
            class="conversation"
            @dragenter="onDragEnter"
            @dragover="onDragOver"
            @dragleave="onDragLeave"
            @drop="onDrop"
        >
            <div v-if="isDraggingFiles" class="drop-overlay">
                <div class="drop-banner">Drop files to attach</div>
            </div>
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
                <div
                    v-for="(message, idx) in messages"
                    :key="message.id"
                    :class="['message-wrap', { 'group-start': !isContinuation(messages[idx - 1], message) }]"
                >
                    <MessageView
                        :message="message"
                        :compact="isContinuation(messages[idx - 1], message)"
                        :editing="editingMessageId === message.id"
                        @submit-edit="(content) => submitEdit(message, content)"
                        @cancel-edit="cancelEdit"
                    />
                    <div class="message-actions">
                        <button type="button" :class="['action', { active: reactingMessageId === message.id }]" title="React" @click="startReact(message.id)">😊</button>
                        <button type="button" class="action" title="Reply" @click="onMessageReply(message)">↩</button>
                        <template v-if="isOwnMessage(message)">
                            <button type="button" class="action" title="Edit" @click="startEdit(message)">✏</button>
                            <button
                                type="button"
                                :class="['action', { danger: shiftHeld }]"
                                :title="shiftHeld ? 'Delete (no confirm)' : 'Delete (shift to skip confirm)'"
                                @click="confirmDelete(message, $event)"
                            >🗑</button>
                        </template>
                    </div>
                    <div v-if="reactingMessageId === message.id" class="react-pop">
                        <MediaPicker @select="onReactPicked" />
                    </div>
                </div>
                <div ref="messagesEnd" />
            </div>
            <footer v-if="selectedChannel" class="composer-row">
                <MessageComposer
                    ref="composerRef"
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
    height: 100%;
    min-height: 0;
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
    position: relative;
}
.drop-overlay {
    position: absolute;
    inset: 0;
    background: rgba(88, 101, 242, 0.18);
    border: 2px dashed var(--accent);
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 5;
    pointer-events: none;
}
.drop-banner {
    background: var(--bg-surface);
    color: var(--text-strong);
    padding: 0.75rem 1.5rem;
    border-radius: 8px;
    font-weight: 600;
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.18);
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
.message-wrap.group-start:not(:first-child) {
    margin-top: 0.4rem;
}
.message-wrap:hover .message-actions,
.message-actions:focus-within {
    opacity: 1;
}
.message-actions {
    position: absolute;
    top: 4px;
    right: 12px;
    display: flex;
    gap: 0.2rem;
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 2px;
    opacity: 0;
    transition: opacity 0.15s;
    z-index: 2;
}
.action {
    background: none;
    border: none;
    cursor: pointer;
    padding: 2px 6px;
    border-radius: 3px;
    color: var(--text);
    font-size: 0.85rem;
    line-height: 1;
}
.action:hover {
    background: var(--bg-surface-hover);
}
.action.active {
    background: var(--accent-bg);
    color: var(--accent-text-strong);
}
.action.danger {
    background: rgba(239, 68, 68, 0.18);
    color: var(--danger);
}
.react-pop {
    position: absolute;
    top: 32px;
    right: 12px;
    z-index: 5;
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
