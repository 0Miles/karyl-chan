<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import MessageView from './MessageView.vue';
import MessageComposer from './MessageComposer.vue';
import MediaPicker, { type MediaSelection } from './picker/MediaPicker.vue';
import { isContinuation } from './grouping';
import { useFileDrop, useFloatingPicker, useShiftKey } from './composables';
import type { Message, MessageReference, OutgoingMessage } from './types';
import type { ChatChannelSummary } from './ChatSidebar.vue';

const props = defineProps<{
    channel: ChatChannelSummary | null;
    messages: Message[];
    botUserId: string | null;
    hasMore: boolean;
    loadingMessages?: boolean;
    loadingOlder?: boolean;
    sending?: boolean;
    error?: string | null;
    editingMessageId?: string | null;
    replyTo?: MessageReference | null;
}>();

const emit = defineEmits<{
    (e: 'send', payload: OutgoingMessage): void;
    (e: 'reply', message: Message): void;
    (e: 'cancel-reply'): void;
    (e: 'request-edit', message: Message): void;
    (e: 'submit-edit', message: Message, content: string): void;
    (e: 'cancel-edit'): void;
    (e: 'delete', message: Message, event?: MouseEvent): void;
    (e: 'load-older'): void;
    (e: 'react', messageId: string, selection: MediaSelection): void;
    (e: 'add-files', files: File[]): void;
    (e: 'scroll-rendered'): void;
}>();

const composerRef = ref<InstanceType<typeof MessageComposer> | null>(null);
const messagesContainer = ref<HTMLDivElement | null>(null);
const messagesEnd = ref<HTMLDivElement | null>(null);
const shiftHeld = useShiftKey();
const reactPicker = useFloatingPicker({ width: 420, height: 460 });

const drop = useFileDrop((files) => {
    composerRef.value?.addFiles(files);
    emit('add-files', files);
});

const isOwn = (message: Message) => !!props.botUserId && message.author.id === props.botUserId;

function scrollToBottom() {
    messagesEnd.value?.scrollIntoView({ block: 'end' });
}

function isNearBottom(): boolean {
    const el = messagesEnd.value?.parentElement;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 80;
}

function onMessagesScroll() {
    const el = messagesContainer.value;
    if (!el) return;
    if (el.scrollTop < 80 && props.hasMore && !props.loadingOlder) emit('load-older');
    if (reactPicker.openId.value) reactPicker.close();
}

const groupedMessages = computed(() => props.messages);

watch(() => props.channel?.id, () => {
    reactPicker.close();
});

onMounted(() => {
    scrollToBottom();
});

defineExpose({ scrollToBottom, isNearBottom, addFiles: (files: File[]) => composerRef.value?.addFiles(files), messagesContainer });

function onReactPicked(selection: MediaSelection) {
    if (!reactPicker.openId.value) return;
    const messageId = reactPicker.openId.value;
    reactPicker.close();
    emit('react', messageId, selection);
}

function startReact(messageId: string, event: MouseEvent) {
    reactPicker.openAt(messageId, event);
}

const replyToProp = computed(() => props.replyTo);

async function maintainScrollAfterPaging(action: () => Promise<void> | void) {
    void action;
}
void maintainScrollAfterPaging;
</script>

<template>
    <div
        class="conversation"
        @dragenter="drop.onDragEnter"
        @dragover="drop.onDragOver"
        @dragleave="drop.onDragLeave"
        @drop="drop.onDrop"
    >
        <div v-if="drop.isDragging.value" class="drop-overlay">
            <div class="drop-banner">Drop files to attach</div>
        </div>
        <header v-if="channel" class="conv-header">
            <span class="title">{{ channel.recipient.globalName ?? channel.recipient.username }}</span>
            <span class="user-id">{{ channel.recipient.id }}</span>
        </header>
        <p v-if="error" class="error">{{ error }}</p>
        <div ref="messagesContainer" class="messages" @scroll.passive="onMessagesScroll">
            <p v-if="!channel" class="muted center">Select a chat to view messages.</p>
            <p v-else-if="loadingMessages && messages.length === 0" class="muted center">Loading…</p>
            <p v-else-if="messages.length === 0" class="muted center">No messages yet.</p>
            <p v-if="loadingOlder" class="muted center small">Loading older…</p>
            <p v-else-if="!hasMore && messages.length > 0" class="muted center small">Beginning of conversation</p>
            <div
                v-for="(message, idx) in groupedMessages"
                :key="message.id"
                :class="['message-wrap', { 'group-start': !isContinuation(messages[idx - 1], message) }]"
            >
                <MessageView
                    :message="message"
                    :compact="isContinuation(messages[idx - 1], message)"
                    :editing="editingMessageId === message.id"
                    @submit-edit="(content: string) => emit('submit-edit', message, content)"
                    @cancel-edit="emit('cancel-edit')"
                />
                <div class="message-actions">
                    <button type="button" :class="['action', { active: reactPicker.openId.value === message.id }]" title="React" @click="startReact(message.id, $event)">😊</button>
                    <button type="button" class="action" title="Reply" @click="emit('reply', message)">↩</button>
                    <template v-if="isOwn(message)">
                        <button type="button" class="action" title="Edit" @click="emit('request-edit', message)">✏</button>
                        <button
                            type="button"
                            :class="['action', { danger: shiftHeld }]"
                            :title="shiftHeld ? 'Delete (no confirm)' : 'Delete (shift to skip confirm)'"
                            @click="emit('delete', message, $event)"
                        >🗑</button>
                    </template>
                </div>
            </div>
            <div ref="messagesEnd" />
        </div>
        <Teleport to="body">
            <div
                v-if="reactPicker.openId.value && reactPicker.position.value"
                data-floating-picker
                class="react-pop-floating"
                :style="{ top: reactPicker.position.value.top + 'px', left: reactPicker.position.value.left + 'px' }"
            >
                <MediaPicker @select="onReactPicked" />
            </div>
        </Teleport>
        <footer v-if="channel" class="composer-row">
            <MessageComposer
                ref="composerRef"
                :reply-to="replyToProp"
                :disabled="sending"
                @send="(payload: OutgoingMessage) => emit('send', payload)"
                @cancel-reply="emit('cancel-reply')"
            />
        </footer>
    </div>
</template>

<style>
.react-pop-floating {
    position: fixed;
    z-index: 1000;
}
</style>

<style scoped>
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
.title { font-weight: 600; color: var(--text-strong); }
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
.center { text-align: center; margin: 2rem 0; }
.small { font-size: 0.8rem; margin: 0.5rem 0; }
.message-wrap { position: relative; }
.message-wrap.group-start:not(:first-child) { margin-top: 0.4rem; }
.message-wrap:hover .message-actions,
.message-actions:focus-within { opacity: 1; }
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
.action:hover { background: var(--bg-surface-hover); }
.action.active {
    background: var(--accent-bg);
    color: var(--accent-text-strong);
}
.action.danger {
    background: rgba(239, 68, 68, 0.18);
    color: var(--danger);
}
.composer-row {
    border-top: 1px solid var(--border);
    padding: 0.5rem 0.75rem;
}
.muted { color: var(--text-muted); font-size: 0.9rem; }
</style>
