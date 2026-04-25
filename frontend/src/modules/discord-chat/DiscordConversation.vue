<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type ComponentPublicInstance } from 'vue';
import { DynamicScroller, DynamicScrollerItem } from 'vue-virtual-scroller';
import MessageView from '../../libs/messages/MessageView.vue';
import MessageComposer from '../../libs/messages/MessageComposer.vue';
import MediaPickerPopover from '../../libs/messages/picker/MediaPickerPopover.vue';
import MessageContextMenu, { type ContextMenuAction } from '../../libs/messages/MessageContextMenu.vue';
import DiscordUserCardPopover from './DiscordUserCardPopover.vue';
import type { MediaSelection } from '../../libs/messages/picker/MediaPicker.vue';
import { isContinuation } from '../../libs/messages/grouping';
import { flashMessage } from '../../libs/messages/scroll-flash';
import { useFileDrop } from '../../composables/use-file-drop';
import { useShiftKey } from '../../composables/use-shift-key';
import type { Message, MessageReference, OutgoingMessage } from '../../libs/messages/types';
import { useMessageCacheStore, type ScrollPosition } from './stores/messageCacheStore';
import { useMuteStore } from './stores/muteStore';
import { useUnreadStore, markerGreater } from './stores/unreadStore';
import { Icon } from '@iconify/vue';
import { useI18n } from 'vue-i18n';
const { t: $t } = useI18n();

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

const muteStore = useMuteStore();
const isMuted = computed(() => muteStore.isMuted(props.channelId));
function toggleMute() {
    if (props.channelId) muteStore.toggle(props.channelId);
}

// Index of the first message strictly newer than the unread divider
// marker for the current channel. Returns -1 when the channel has no
// snapshot, no marker, or every loaded message is older — in those
// cases the divider is suppressed entirely. Re-evaluates on every
// messages/channel change so SSE arrivals naturally land below.
const unreadStore = useUnreadStore();
// Context menu (right-click / long-press). The action set is computed
// per-message so the menu shows edit/delete only on the bot's own
// messages. Mark-unread anchors to the message immediately preceding
// `target` so reopening the channel surfaces the divider above it.
const ctxMenu = ref<{ x: number; y: number; messageId: string } | null>(null);
const LONG_PRESS_MS = 500;
let longPressTimer: ReturnType<typeof setTimeout> | null = null;

function openContextMenu(event: MouseEvent | TouchEvent, message: Message) {
    const point = 'touches' in event && event.touches.length > 0
        ? { x: event.touches[0].clientX, y: event.touches[0].clientY }
        : { x: (event as MouseEvent).clientX, y: (event as MouseEvent).clientY };
    ctxMenu.value = { x: point.x, y: point.y, messageId: message.id };
}

function onMessageContextMenu(event: MouseEvent, message: Message) {
    // Allow the OS native menu when the user is right-clicking inside
    // an editor (compose / edit textbox) so they can paste / spell-check.
    const target = event.target as HTMLElement | null;
    if (target?.closest('[contenteditable="true"], textarea, input')) return;
    event.preventDefault();
    openContextMenu(event, message);
}

function onMessageTouchStart(event: TouchEvent, message: Message) {
    if (event.touches.length !== 1) return;
    if (longPressTimer) clearTimeout(longPressTimer);
    longPressTimer = setTimeout(() => {
        longPressTimer = null;
        openContextMenu(event, message);
    }, LONG_PRESS_MS);
}

function onMessageTouchEnd() {
    if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
    }
}

const ctxActions = computed<ContextMenuAction[]>(() => {
    if (!ctxMenu.value) return [];
    const message = props.messages.find(m => m.id === ctxMenu.value!.messageId);
    if (!message) return [];
    const actions: ContextMenuAction[] = [
        { key: 'reply', label: $t('messages.reply'), icon: 'material-symbols:reply-rounded' },
        { key: 'copy-text', label: $t('messages.copyText'), icon: 'material-symbols:content-copy-outline-rounded' },
        { key: 'copy-link', label: $t('messages.copyLink'), icon: 'material-symbols:link-rounded' },
        { key: 'copy-id', label: $t('messages.copyId'), icon: 'material-symbols:fingerprint-rounded' },
        { key: 'mark-unread', label: $t('messages.markUnread'), icon: 'material-symbols:mark-as-unread-outline-rounded' }
    ];
    if (isOwn(message)) {
        actions.push({ key: 'edit', label: $t('messages.edit'), icon: 'material-symbols:edit-rounded' });
        actions.push({ key: 'delete', label: $t('messages.delete'), icon: 'material-symbols:delete-rounded', danger: true });
    }
    return actions;
});

async function copyToClipboard(text: string) {
    try { await navigator.clipboard.writeText(text); } catch { /* ignore */ }
}

function onContextPick(actionKey: string) {
    const ctx = ctxMenu.value;
    if (!ctx) return;
    const message = props.messages.find(m => m.id === ctx.messageId);
    if (!message) return;
    switch (actionKey) {
        case 'reply': emit('reply', message); break;
        case 'copy-text': void copyToClipboard(message.content ?? ''); break;
        case 'copy-link': void copyToClipboard(messageUrl(message)); break;
        case 'copy-id': void copyToClipboard(message.id); break;
        case 'mark-unread': {
            // Anchor lastSeen at the message immediately before this one
            // so the target message becomes the first unread.
            const idx = props.messages.findIndex(m => m.id === message.id);
            const predecessor = idx > 0 ? props.messages[idx - 1].id : null;
            if (props.channelId) unreadStore.markUnreadFrom(props.channelId, predecessor);
            break;
        }
        case 'edit': emit('request-edit', message); break;
        case 'delete': emit('delete', message); break;
    }
}


const unreadDividerIndex = computed<number>(() => {
    if (!props.channelId) return -1;
    const marker = unreadStore.getDividerMarker(props.channelId);
    if (!marker) return -1;
    for (let i = 0; i < props.messages.length; i++) {
        const id = props.messages[i].id;
        if (id && markerGreater(id, marker)) return i;
    }
    return -1;
});

/**
 * Whether `message` targets the current bot user — directly (@mention),
 * broadly (@everyone / @here), or by being a reply to one of the bot's
 * messages. Drives the "mentioned-self" highlight so the user can spot
 * pings at a glance.
 */
function mentionsSelf(message: Message): boolean {
    const selfId = props.botUserId;
    if (!selfId) return false;
    // `<@id>` + the legacy `<@!id>` nickname-mention variant.
    if (new RegExp(`<@!?${selfId}>`).test(message.content)) return true;
    if (message.mentionEveryone) return true;
    if (message.referencedMessage?.author.id === selfId) return true;
    return false;
}

function scrollToBottom() {
    const el = messagesContainer.value;
    if (el) el.scrollTop = el.scrollHeight;
}

/**
 * DynamicScroller measures items lazily, so `scrollHeight` right after a
 * fresh render is often an under-estimate — a single `scrollTop = height`
 * lands mid-list instead of bottom. We set a value larger than the doc
 * can hold (browsers clamp to `scrollHeight`) and repeat across a few
 * frames so each measurement pass re-clamps us to the true end.
 */
function scrollToBottomStable(maxFrames = 6): void {
    let frame = 0;
    const tick = () => {
        const el = messagesContainer.value;
        if (!el) return;
        el.scrollTop = Number.MAX_SAFE_INTEGER;
        frame++;
        if (frame < maxFrames) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
}

/**
 * Try to land on the given message id. Returns `true` when the target
 * is already in the DOM and we scrolled to it; returns `false` when the
 * message is either out of the virtual-scroller's rendered window (in
 * which case we nudge it in via `scrollToItem` so the next render picks
 * it up) or not in the loaded batch at all.
 */
function scrollToMessage(messageId: string): boolean {
    const el = messagesContainer.value;
    if (!el) return false;
    const msgEl = el.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(messageId)}"]`);
    if (msgEl) {
        msgEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        flashMessage(messageId);
        return true;
    }
    if (useVirtual.value && scrollerRef.value) {
        const idx = props.messages.findIndex(m => m.id === messageId);
        if (idx >= 0) {
            (scrollerRef.value as unknown as { scrollToItem?: (i: number) => void }).scrollToItem?.(idx);
        }
    }
    return false;
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

// ── Scroll position memory ──────────────────────────────────────────────────
// On channel switch we capture the topmost visible message + its pixel offset
// from the container top, stash it in the cache store, and replay on return.
// A `null` captured position means "the user was at/near the bottom" — the
// absence of a stored position is our sentinel so restoration defaults to
// bottom for fresh channels too.
const messageCache = useMessageCacheStore();

interface PendingRestore {
    channelId: string;
    position: ScrollPosition | null;
}
let pendingRestore: PendingRestore | null = null;

function capturePosition(): ScrollPosition | null {
    const el = messagesContainer.value;
    if (!el) return null;
    // Near-bottom → return null so restore defaults to bottom (keep following).
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 80) return null;
    const containerTop = el.getBoundingClientRect().top;
    // Walk every rendered message; the first whose bottom is below the
    // container top is our topmost visible anchor. `querySelectorAll` returns
    // them in document order, which matches visual top-to-bottom.
    const items = el.querySelectorAll<HTMLElement>('[data-message-id]');
    for (const item of items) {
        const rect = item.getBoundingClientRect();
        if (rect.bottom > containerTop) {
            return {
                messageId: item.dataset.messageId as string,
                offset: rect.top - containerTop
            };
        }
    }
    return null;
}

/**
 * Apply a saved position. Plain list: find the element and align. Virtual
 * scroller: use `scrollToItem` to bring the anchor into the rendered window
 * first, then re-align once the browser has painted — item heights are only
 * measured after mount, so a single pass lands too early.
 */
function applyRestore(restore: PendingRestore, attempt = 0): void {
    if (restore.channelId !== props.channelId) return;
    const el = messagesContainer.value;
    if (!el) return;
    const { position } = restore;
    if (!position) {
        scrollToBottomStable();
        return;
    }
    const msgEl = el.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(position.messageId)}"]`);
    if (msgEl) {
        const rect = msgEl.getBoundingClientRect();
        const containerRect = el.getBoundingClientRect();
        el.scrollTop += (rect.top - containerRect.top) - position.offset;
        // Virtual scroller re-measures after paint — one follow-up lands precisely.
        if (useVirtual.value && attempt < 2) {
            requestAnimationFrame(() => applyRestore(restore, attempt + 1));
        }
        return;
    }
    // Anchor not rendered yet (virtual scroller window). Nudge it in and retry.
    if (useVirtual.value && scrollerRef.value) {
        const idx = props.messages.findIndex(m => m.id === position.messageId);
        if (idx >= 0) {
            (scrollerRef.value as unknown as { scrollToItem?: (i: number) => void }).scrollToItem?.(idx);
        }
        if (attempt < 10) requestAnimationFrame(() => applyRestore(restore, attempt + 1));
    }
}

// flush: 'sync' ensures we read the old DOM before Vue swaps it for the new
// channel's render. Default 'pre' would also work but sync is defensive.
watch(() => props.channelId, (newId, oldId) => {
    if (oldId) messageCache.saveScrollPosition(oldId, capturePosition());
    closeReactPicker();
    pendingRestore = newId
        ? { channelId: newId, position: messageCache.getScrollPosition(newId) }
        : null;
}, { flush: 'sync' });

// Apply the queued restore once the new channel's messages land in the DOM.
// Fires both on channel switch (reference change) and on new-message arrival;
// the `pendingRestore` guard ensures we only replay the first time.
watch(() => props.messages, () => {
    const restore = pendingRestore;
    if (!restore || restore.channelId !== props.channelId || props.messages.length === 0) return;
    pendingRestore = null;
    nextTick().then(() => applyRestore(restore));
});

watch([scrollerRef, plainListRef], ([scroller, plain], _prev, onCleanup) => {
    const el = (scroller ? (scroller.$el as HTMLElement) : plain) ?? null;
    messagesContainer.value = el;
    if (!el) return;
    el.addEventListener('scroll', onMessagesScroll, { passive: true });
    onCleanup(() => el.removeEventListener('scroll', onMessagesScroll));
}, { immediate: true });

onMounted(() => {
    // Initial mount: seed a pendingRestore for the current channel so either
    // the messages watcher (async arrival) or a direct applyRestore here
    // (messages already cached) puts the user back where they left off.
    if (!props.channelId) {
        scrollToBottom();
        return;
    }
    pendingRestore = {
        channelId: props.channelId,
        position: messageCache.getScrollPosition(props.channelId)
    };
    if (props.messages.length > 0) {
        const restore = pendingRestore;
        pendingRestore = null;
        nextTick().then(() => applyRestore(restore));
    }
});

onBeforeUnmount(() => {
    // Component tear-down (e.g., navigating away) — capture one last time so
    // returning to this route finds the user where they left off.
    if (props.channelId) {
        messageCache.saveScrollPosition(props.channelId, capturePosition());
    }
    reactingButtons.clear();
});

defineExpose({
    scrollToBottom,
    scrollToMessage,
    isNearBottom,
    addFiles: (files: File[]) => composerRef.value?.addFiles(files),
    messagesContainer,
    messagesEnd
});

function onReactPicked(selection: MediaSelection) {
    if (!reactingMessageId.value) return;
    // Don't close here — MediaPicker decides whether to emit a `close`
    // (and thus flip update:visible → closeReactPicker) based on the
    // shift key. Closing unconditionally here would stomp the
    // shift-to-stay-open affordance and collapse the picker between
    // every reaction added to the same message.
    emit('react', reactingMessageId.value, selection);
}

function startReact(messageId: string) {
    if (reactingMessageId.value === messageId) {
        closeReactPicker();
        return;
    }
    reactingMessageId.value = messageId;
    reactingButton.value = reactingButtons.get(messageId) ?? null;
}

// Transient "just copied" flag per message id — flips back after the
// user's eye has had time to catch the tooltip swap (~1.2s).
const copiedMessageId = ref<string | null>(null);
let copiedResetTimer: ReturnType<typeof setTimeout> | null = null;

function messageUrl(message: Message): string {
    // `@me` stands in for null guildId in Discord's own permalink scheme.
    return `https://discord.com/channels/${message.guildId ?? '@me'}/${message.channelId}/${message.id}`;
}

async function copyMessageLink(message: Message) {
    const url = messageUrl(message);
    try {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(url);
        } else {
            // Older browsers / non-secure contexts: fall back to the
            // `execCommand` path via a hidden textarea.
            const ta = document.createElement('textarea');
            ta.value = url;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            ta.remove();
        }
        copiedMessageId.value = message.id;
        if (copiedResetTimer) clearTimeout(copiedResetTimer);
        copiedResetTimer = setTimeout(() => {
            copiedMessageId.value = null;
            copiedResetTimer = null;
        }, 1200);
    } catch {
        // Silent: clipboard may be blocked by permissions policy.
    }
}

onBeforeUnmount(() => {
    if (copiedResetTimer) clearTimeout(copiedResetTimer);
});

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
            <div class="drop-banner">{{ $t('messages.dropFiles') }}</div>
        </div>
        <header v-if="channelId" class="conv-header">
            <slot name="header">
                <span class="title">{{ headerTitle }}</span>
                <span v-if="headerSubtitle" class="subtitle">{{ headerSubtitle }}</span>
                <span class="header-spacer"></span>
                <button
                    type="button"
                    :class="['header-action', { active: isMuted }]"
                    :title="isMuted ? $t('messages.unmute') : $t('messages.mute')"
                    :aria-label="isMuted ? $t('messages.unmute') : $t('messages.mute')"
                    @click="toggleMute"
                >
                    <Icon :icon="isMuted ? 'material-symbols:notifications-off-outline-rounded' : 'material-symbols:notifications-outline-rounded'" width="18" height="18" />
                </button>
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
                <p v-if="loadingOlder" class="muted center small">{{ $t('messages.loadingOlder') }}</p>
                <p v-else-if="!hasMore && messages.length > 0" class="muted center small">{{ $t('messages.beginningOfConversation') }}</p>
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
                        v-if="idx === unreadDividerIndex"
                        class="unread-divider"
                        role="separator"
                        :aria-label="$t('messages.newMessages')"
                    >
                        <span class="unread-divider-label">{{ $t('messages.newMessages') }}</span>
                    </div>
                    <div
                        :class="['message-wrap', {
                        'group-start': !isContinuation(messages[idx - 1], message),
                        'mentioned-self': mentionsSelf(message)
                    }]"
                        :data-message-id="message.id"
                        @contextmenu="onMessageContextMenu($event, message)"
                        @touchstart="onMessageTouchStart($event, message)"
                        @touchend="onMessageTouchEnd"
                        @touchmove="onMessageTouchEnd"
                        @touchcancel="onMessageTouchEnd"
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
                                :title="$t('messages.react')"
                                @click="startReact(message.id)"
                            >
                                <Icon icon="material-symbols:add-reaction-rounded" width="16" height="16" />
                            </button>
                            <button type="button" class="action" :title="$t('messages.reply')" @click="emit('reply', message)">
                                <Icon icon="material-symbols:reply-rounded" width="16" height="16" />
                            </button>
                            <template v-if="isOwn(message)">
                                <button type="button" class="action" :title="$t('messages.edit')" @click="emit('request-edit', message)">
                                    <Icon icon="material-symbols:edit-rounded" width="16" height="16" />
                                </button>
                            </template>
                            <button
                                type="button"
                                :class="['action', { copied: copiedMessageId === message.id }]"
                                :title="copiedMessageId === message.id ? $t('messages.copyLinkDone') : $t('messages.copyLink')"
                                @click="copyMessageLink(message)"
                            >
                                <Icon :icon="copiedMessageId === message.id ? 'material-symbols:check-rounded' : 'material-symbols:link-rounded'" width="16" height="16" />
                            </button>
                            <template v-if="isOwn(message)">
                                <button
                                    type="button"
                                    :class="['action', { danger: shiftHeld }]"
                                    :title="shiftHeld ? $t('messages.deleteNoConfirm') : $t('messages.deleteShiftConfirm')"
                                    @click="emit('delete', message, $event)"
                                >
                                    <Icon icon="material-symbols:delete-rounded" width="16" height="16" />
                                </button>
                            </template>
                        </div>
                    </div>
                </DynamicScrollerItem>
            </template>
            <template #after>
                <div ref="messagesEnd" />
            </template>
            <template #empty>
                <p v-if="!channelId" class="muted center">{{ $t('messages.selectChat') }}</p>
                <p v-else-if="loadingMessages" class="muted center">{{ $t('common.loading') }}</p>
                <p v-else class="muted center">{{ $t('messages.noMessages') }}</p>
            </template>
        </DynamicScroller>
        <div v-else ref="plainListRef" class="messages">
            <p v-if="loadingOlder" class="muted center small">{{ $t('messages.loadingOlder') }}</p>
            <p v-else-if="!hasMore && messages.length > 0" class="muted center small">{{ $t('messages.beginningOfConversation') }}</p>
            <template v-if="messages.length > 0">
                <template v-for="(message, idx) in messages" :key="message.id">
                    <div
                        v-if="idx === unreadDividerIndex"
                        class="unread-divider"
                        role="separator"
                        :aria-label="$t('messages.newMessages')"
                    >
                        <span class="unread-divider-label">{{ $t('messages.newMessages') }}</span>
                    </div>
                <div
                    :class="['message-wrap', {
                        'group-start': !isContinuation(messages[idx - 1], message),
                        'mentioned-self': mentionsSelf(message)
                    }]"
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
                            :title="$t('messages.react')"
                            @click="startReact(message.id)"
                        >
                            <Icon icon="material-symbols:add-reaction-rounded" width="16" height="16" />
                        </button>
                        <button type="button" class="action" :title="$t('messages.reply')" @click="emit('reply', message)">
                            <Icon icon="material-symbols:reply-rounded" width="16" height="16" />
                        </button>
                        <template v-if="isOwn(message)">
                            <button type="button" class="action" :title="$t('messages.edit')" @click="emit('request-edit', message)">
                                <Icon icon="material-symbols:edit-rounded" width="16" height="16" />
                            </button>
                        </template>
                        <button
                            type="button"
                            :class="['action', { copied: copiedMessageId === message.id }]"
                            :title="copiedMessageId === message.id ? $t('messages.copyLinkDone') : $t('messages.copyLink')"
                            @click="copyMessageLink(message)"
                        >
                            <Icon :icon="copiedMessageId === message.id ? 'material-symbols:check-rounded' : 'material-symbols:link-rounded'" width="16" height="16" />
                        </button>
                        <template v-if="isOwn(message)">
                            <button
                                type="button"
                                :class="['action', { danger: shiftHeld }]"
                                :title="shiftHeld ? $t('messages.deleteNoConfirm') : $t('messages.deleteShiftConfirm')"
                                @click="emit('delete', message, $event)"
                            >
                                <Icon icon="material-symbols:delete-rounded" width="16" height="16" />
                            </button>
                        </template>
                    </div>
                </div>
                </template>
            </template>
            <template v-else>
                <p v-if="!channelId" class="muted center">{{ $t('messages.selectChat') }}</p>
                <p v-else-if="loadingMessages" class="muted center">{{ $t('common.loading') }}</p>
                <p v-else class="muted center">{{ $t('messages.noMessages') }}</p>
            </template>
            <div ref="messagesEnd" />
        </div>
        <MediaPickerPopover
            :reference-el="reactingButton"
            :visible="reactingMessageId !== null"
            :stickers="false"
            placement="top-end"
            @update:visible="(v) => { if (!v) closeReactPicker(); }"
            @select="onReactPicked"
        />
        <!-- Single shared user-profile popover, driven by the
             userProfileStore that MessageContext.onUserClick writes to. -->
        <DiscordUserCardPopover />
        <MessageContextMenu
            :visible="ctxMenu !== null"
            :x="ctxMenu?.x ?? 0"
            :y="ctxMenu?.y ?? 0"
            :actions="ctxActions"
            @pick="onContextPick"
            @close="ctxMenu = null"
        />
        <footer v-if="channelId" class="composer-row">
            <MessageComposer
                ref="composerRef"
                :channel-id="channelId"
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
    flex: 1;
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
    height: 54px;
    padding: 1rem;
    border-bottom: 1px solid var(--border);
    display: flex;
    align-items: center;
    gap: 0.5rem;
}
@media (max-width: 768px) {
    .conv-header {
        height: auto;
    }
}
.title { font-weight: 600; color: var(--text-strong); }
.subtitle {
    color: var(--text-faint);
    font-size: 0.8rem;
    font-family: ui-monospace, SFMono-Regular, monospace;
}
.header-spacer { flex: 1; }
.header-action {
    background: none;
    border: 1px solid transparent;
    border-radius: 4px;
    padding: 4px;
    cursor: pointer;
    color: var(--text-muted);
    line-height: 0;
    transition: background 0.12s, color 0.12s, border-color 0.12s;
}
.header-action:hover { background: var(--bg-surface-hover); color: var(--text); }
.header-action.active { color: var(--accent-text-strong); border-color: var(--accent); }
.error { color: var(--danger); margin: 0.5rem 1rem; }
.messages { flex: 1; overflow-y: auto; padding: 0.5rem 0; }
.center { text-align: center; margin: 2rem 0; }
.small { font-size: 0.8rem; margin: 0.5rem 0; }
.message-wrap { position: relative; }
.message-wrap.group-start:not(:first-child) { margin-top: 0.4rem; }
/* Mention / reply-to-self — persistent highlight. Inset box-shadow
   draws the left accent without pushing content right. */
.message-wrap.mentioned-self {
    background: rgba(250, 166, 26, 0.08);
    box-shadow: inset 3px 0 0 #faa61a;
}
/* Scroll-target flash — transient pulse that fades back to either
   transparent or the `.mentioned-self` background underneath. */
.message-wrap.msg-flash {
    animation: msg-flash 1.2s ease-out;
}
/* "New messages" divider — anchored at the lastSeen marker captured
   when the user opened the channel. Re-anchors on next entry, stays
   put while the channel is open so SSE arrivals land below it. */
.unread-divider {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin: 0.4rem 1rem;
    color: var(--unread-accent, #f23f43);
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
}
.unread-divider::before,
.unread-divider::after {
    content: "";
    flex: 1;
    height: 1px;
    background: var(--unread-accent, #f23f43);
    opacity: 0.6;
}
.unread-divider-label { flex-shrink: 0; }
@keyframes msg-flash {
    0% { background-color: rgba(99, 150, 240, 0.32); }
    60% { background-color: rgba(99, 150, 240, 0.2); }
    100% { background-color: transparent; }
}
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
    padding: 4px;
    border-radius: 3px;
    color: var(--text);
    line-height: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
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
.action.copied {
    background: var(--accent-bg);
    color: var(--accent-text-strong);
}
.composer-row {
    padding: 0.5rem 0.75rem;
}
.muted { color: var(--text-muted); font-size: 0.9rem; }
</style>
