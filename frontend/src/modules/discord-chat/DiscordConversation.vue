<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type ComponentPublicInstance } from 'vue';
import { DynamicScroller, DynamicScrollerItem } from 'vue-virtual-scroller';
import MessageView from '../../libs/messages/MessageView.vue';
import MessageComposer from '../../libs/messages/MessageComposer.vue';
import MediaPickerPopover from '../../libs/messages/picker/MediaPickerPopover.vue';
import MediaPickerDrawer from '../../libs/messages/picker/MediaPickerDrawer.vue';
import type { MediaSelection } from '../../libs/messages/picker/MediaPicker.vue';
import { isContinuation } from '../../libs/messages/grouping';
import { useFileDrop } from '../../composables/use-file-drop';
import { useShiftKey } from '../../composables/use-shift-key';
import { useBreakpoint } from '../../composables/use-breakpoint';
import type { Message, MessageReference, OutgoingMessage } from '../../libs/messages/types';
import { useMessageCacheStore } from './stores/messageCacheStore';

const props = defineProps<{
    channelId: string | null;
    headerTitle?: string | null;
    headerSubtitle?: string | null;
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
}>();

const VIRTUAL_THRESHOLD = 64;
const useVirtual = computed(() => props.messages.length > VIRTUAL_THRESHOLD);

const composerRef = ref<InstanceType<typeof MessageComposer> | null>(null);
const scrollerRef = ref<ComponentPublicInstance | null>(null);
const plainListRef = ref<HTMLDivElement | null>(null);
const messagesEnd = ref<HTMLDivElement | null>(null);
const messagesContainer = ref<HTMLElement | null>(null);
const shiftHeld = useShiftKey();
const { isMobile } = useBreakpoint();
const reactingMessageId = ref<string | null>(null);
const reactingButton = ref<HTMLButtonElement | null>(null);
const reactingButtons = new Map<string, HTMLButtonElement>();
function setReactButton(id: string, el: HTMLButtonElement | null) {
    if (el) reactingButtons.set(id, el);
    else reactingButtons.delete(id);
}

const drop = useFileDrop((files) => {
    composerRef.value?.addFiles(files);
    emit('add-files', files);
});

const isOwn = (message: Message) => !!props.botUserId && message.author.id === props.botUserId;

function scrollToBottom() {
    const el = messagesContainer.value;
    if (el) el.scrollTop = el.scrollHeight;
}

function isNearBottom(): boolean {
    const el = messagesContainer.value;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 80;
}

function onMessagesScroll() {
    const el = messagesContainer.value;
    if (!el) return;
    if (el.scrollTop < 80 && props.hasMore && !props.loadingOlder) emit('load-older');
    if (reactingMessageId.value) closeReactPicker();
}

function closeReactPicker() {
    reactingMessageId.value = null;
    reactingButton.value = null;
}

// ── Scroll anchor memory ────────────────────────────────────────────────────
// Stored in messageCacheStore so anchors survive component remounts.
const messageCache = useMessageCacheStore();

type PendingRestore =
    | { channelId: string; type: 'anchor'; messageId: string }
    | { channelId: string; type: 'bottom' };
let pendingRestore: PendingRestore | null = null;

function getTopAnchor(): string | null {
    const container = messagesContainer.value;
    if (!container) return null;
    const rect = container.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    // Scan top-to-bottom in 16 px increments to find first message element.
    for (let dy = 0; dy < container.clientHeight; dy += 16) {
        let el = document.elementFromPoint(x, rect.top + dy) as HTMLElement | null;
        while (el && el !== container) {
            if (el.dataset.messageId) return el.dataset.messageId;
            el = el.parentElement;
        }
    }
    return null;
}

function applyAnchor(messageId: string) {
    if (useVirtual.value) {
        const idx = props.messages.findIndex(m => m.id === messageId);
        if (idx >= 0) (scrollerRef.value as any)?.scrollToItem(idx);
    } else {
        const container = plainListRef.value;
        const msgEl = container?.querySelector<HTMLElement>(`[data-message-id="${messageId}"]`);
        if (container && msgEl) {
            container.scrollTop += msgEl.getBoundingClientRect().top - container.getBoundingClientRect().top;
        }
    }
}

watch(() => props.channelId, (newId, oldId) => {
    // Save topmost visible message for the channel we're leaving.
    if (oldId) {
        const anchor = isNearBottom() ? null : getTopAnchor();
        messageCache.setScrollAnchor(oldId, anchor);
    }
    closeReactPicker();
    // Queue restore action for the incoming channel.
    if (newId) {
        const saved = messageCache.getScrollAnchor(newId);
        pendingRestore = saved
            ? { channelId: newId, type: 'anchor', messageId: saved }
            : { channelId: newId, type: 'bottom' };
    } else {
        pendingRestore = null;
    }
});

// Apply pendingRestore once when the new channel's messages arrive.
watch(() => props.messages, () => {
    const restore = pendingRestore;
    if (!restore || restore.channelId !== props.channelId || props.messages.length === 0) return;
    pendingRestore = null;
    if (restore.type === 'anchor') {
        const id = restore.messageId;
        // First pass: instant scroll before virtual scroller measures heights.
        // Second pass (RAF): after paint, heights are stable — scroll again to land precisely.
        nextTick().then(() => {
            applyAnchor(id);
            if (useVirtual.value) requestAnimationFrame(() => applyAnchor(id));
        });
    } else {
        nextTick().then(() => {
            scrollToBottom();
            requestAnimationFrame(scrollToBottom);
        });
    }
});

watch([scrollerRef, plainListRef], ([scroller, plain], _prev, onCleanup) => {
    const el = (scroller ? (scroller.$el as HTMLElement) : plain) ?? null;
    messagesContainer.value = el;
    if (!el) return;
    el.addEventListener('scroll', onMessagesScroll, { passive: true });
    onCleanup(() => el.removeEventListener('scroll', onMessagesScroll));
}, { immediate: true });

onMounted(() => {
    scrollToBottom();
});

onBeforeUnmount(() => {
    reactingButtons.clear();
});

defineExpose({
    scrollToBottom,
    isNearBottom,
    addFiles: (files: File[]) => composerRef.value?.addFiles(files),
    messagesContainer,
    messagesEnd
});

function onReactPicked(selection: MediaSelection) {
    if (!reactingMessageId.value) return;
    const messageId = reactingMessageId.value;
    closeReactPicker();
    emit('react', messageId, selection);
}

function startReact(messageId: string) {
    if (reactingMessageId.value === messageId) {
        closeReactPicker();
        return;
    }
    reactingMessageId.value = messageId;
    reactingButton.value = reactingButtons.get(messageId) ?? null;
}

const replyToProp = computed(() => props.replyTo);
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
        <header v-if="channelId" class="conv-header">
            <slot name="header">
                <span class="title">{{ headerTitle }}</span>
                <span v-if="headerSubtitle" class="subtitle">{{ headerSubtitle }}</span>
            </slot>
        </header>
        <p v-if="error" class="error">{{ error }}</p>
        <DynamicScroller
            v-if="useVirtual"
            ref="scrollerRef"
            :key="channelId ?? 'empty'"
            class="messages"
            :items="messages"
            key-field="id"
            :min-item-size="44"
        >
            <template #before>
                <p v-if="loadingOlder" class="muted center small">Loading older…</p>
                <p v-else-if="!hasMore && messages.length > 0" class="muted center small">Beginning of conversation</p>
            </template>
            <template #default="{ item: message, index: idx, active }">
                <DynamicScrollerItem
                    :item="message"
                    :active="active"
                    :size-dependencies="[
                        message.content,
                        message.editedAt,
                        message.attachments?.length ?? 0,
                        message.embeds?.length ?? 0,
                        message.reactions?.length ?? 0,
                        message.stickers?.length ?? 0,
                        !!message.referencedMessage,
                        editingMessageId === message.id,
                        isContinuation(messages[idx - 1], message)
                    ]"
                    :data-index="idx"
                >
                    <div
                        :class="['message-wrap', { 'group-start': !isContinuation(messages[idx - 1], message) }]"
                        :data-message-id="message.id"
                    >
                        <MessageView
                            :message="message"
                            :compact="isContinuation(messages[idx - 1], message)"
                            :editing="editingMessageId === message.id"
                            @submit-edit="(content: string) => emit('submit-edit', message, content)"
                            @cancel-edit="emit('cancel-edit')"
                        />
                        <div class="message-actions">
                            <button
                                :ref="(el) => setReactButton(message.id, el as HTMLButtonElement | null)"
                                type="button"
                                :class="['action', { active: reactingMessageId === message.id }]"
                                title="React"
                                @click="startReact(message.id)"
                            >😊</button>
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
                </DynamicScrollerItem>
            </template>
            <template #after>
                <div ref="messagesEnd" />
            </template>
            <template #empty>
                <p v-if="!channelId" class="muted center">Select a chat to view messages.</p>
                <p v-else-if="loadingMessages" class="muted center">Loading…</p>
                <p v-else class="muted center">No messages yet.</p>
            </template>
        </DynamicScroller>
        <div v-else ref="plainListRef" class="messages">
            <p v-if="loadingOlder" class="muted center small">Loading older…</p>
            <p v-else-if="!hasMore && messages.length > 0" class="muted center small">Beginning of conversation</p>
            <template v-if="messages.length > 0">
                <div
                    v-for="(message, idx) in messages"
                    :key="message.id"
                    :class="['message-wrap', { 'group-start': !isContinuation(messages[idx - 1], message) }]"
                    :data-message-id="message.id"
                >
                    <MessageView
                        :message="message"
                        :compact="isContinuation(messages[idx - 1], message)"
                        :editing="editingMessageId === message.id"
                        @submit-edit="(content: string) => emit('submit-edit', message, content)"
                        @cancel-edit="emit('cancel-edit')"
                    />
                    <div class="message-actions">
                        <button
                            :ref="(el) => setReactButton(message.id, el as HTMLButtonElement | null)"
                            type="button"
                            :class="['action', { active: reactingMessageId === message.id }]"
                            title="React"
                            @click="startReact(message.id)"
                        >😊</button>
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
            </template>
            <template v-else>
                <p v-if="!channelId" class="muted center">Select a chat to view messages.</p>
                <p v-else-if="loadingMessages" class="muted center">Loading…</p>
                <p v-else class="muted center">No messages yet.</p>
            </template>
            <div ref="messagesEnd" />
        </div>
        <MediaPickerPopover
            v-if="!isMobile"
            :reference-el="reactingButton"
            :visible="reactingMessageId !== null"
            placement="top-end"
            @update:visible="(v) => { if (!v) closeReactPicker(); }"
            @select="onReactPicked"
        />
        <MediaPickerDrawer
            v-else
            :visible="reactingMessageId !== null"
            @update:visible="(v) => { if (!v) closeReactPicker(); }"
            @select="onReactPicked"
        />
        <footer v-if="channelId" class="composer-row">
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
.subtitle {
    color: var(--text-faint);
    font-size: 0.8rem;
    font-family: ui-monospace, SFMono-Regular, monospace;
}
.error { color: var(--danger); margin: 0.5rem 1rem; }
.messages { flex: 1; overflow-y: auto; padding: 0.5rem 0; }
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
