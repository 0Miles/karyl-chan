<script setup lang="ts">
import { computed, onBeforeUnmount, ref, toRef, type ComponentPublicInstance } from 'vue';
import { DynamicScroller, DynamicScrollerItem } from 'vue-virtual-scroller';
import MessageView from '../../libs/messages/MessageView.vue';
import MessageComposer from '../../libs/messages/MessageComposer.vue';
import { ProactiveFeaturesMenu } from '../dm-proactive-features';
import MediaPickerPopover from '../../libs/messages/picker/MediaPickerPopover.vue';
import MessageContextMenu, { type ContextMenuAction } from '../../libs/messages/MessageContextMenu.vue';
import ConversationHeader from './ConversationHeader.vue';
import MessageActionBar from './MessageActionBar.vue';
import MessageSourceModal from './MessageSourceModal.vue';
import DiscordUserCardPopover from './DiscordUserCardPopover.vue';
import type { MediaSelection } from '../../libs/messages/picker/MediaPicker.vue';
import { isContinuation } from '../../libs/messages/grouping';
import { useFileDrop } from '../../composables/use-file-drop';
import { useShiftKey } from '../../composables/use-shift-key';
import type { Message, MessageReference, OutgoingMessage } from '../../libs/messages/types';
import { useUnreadStore, markerGreater } from './stores/unreadStore';
import { useTypingIndicator } from './useTypingIndicator';
import { useScrollMemory } from './useScrollMemory';
import { useMessageContextMenu } from './useMessageContextMenu';
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
    /** Optional fetcher for pinned messages. When provided, the header
     *  shows a pin button that opens a panel listing the response.
     *  Surface-specific (DM vs guild) so the workspace passes whichever
     *  fetch matches its own channelId conventions. Returning a
     *  rejected promise surfaces in the panel as an error. */
    pinFetcher?: ((channelId: string) => Promise<Message[]>) | null;
    /** When true, the right-click menu shows a "Forward" entry that
     *  emits `forward(message)` for the host to route. DM surfaces leave
     *  this off because cross-DM forwarding has no destination picker. */
    canForward?: boolean;
    /** When true, the menu surfaces moderation entries (pin / unpin /
     *  delete-any-author / bulk-delete). Guild surfaces enable this; the
     *  underlying API still requires the bot to hold ManageMessages on
     *  the channel, so failures surface from the API call. */
    canModerate?: boolean;
    /** When true, the header shows a "browse threads" button that emits
     *  `browse-threads`. Hosts (the guild workspace) wire it to a modal
     *  that lists active + archived threads of the current channel. */
    canBrowseThreads?: boolean;
    /** When true, the composer shows the bot proactive-features menu
     *  next to the attach button. DM workspaces flip this on; guild
     *  workspaces leave it off. The menu's entries themselves come
     *  from `modules/dm-proactive-features/registry`. */
    showProactiveFeatures?: boolean;
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
    (e: 'jump-to-message', messageId: string): void;
    /** Surfaced so the workspace can show a destination picker — the
     *  conversation alone doesn't know the guild's channel tree. */
    (e: 'forward', message: Message): void;
    /** Pin / unpin / bulk-delete are routed through the host so it can
     *  surface a confirmation modal (bulk delete) or refresh ancillary
     *  views (pin panel). */
    (e: 'pin', message: Message): void;
    (e: 'unpin', message: Message): void;
    (e: 'mod-delete', message: Message): void;
    (e: 'bulk-delete', anchorMessage: Message): void;
    /** Surfaced when the user clicks the header's threads button. */
    (e: 'browse-threads'): void;
    /** Surfaced when the user picks an entry from the bot
     *  proactive-features menu. The host owns the API call so it can
     *  apply surface-specific routing / error handling. */
    (e: 'proactive-action', name: string): void;
}>();

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

// Typing indicator: pull users actively typing in the current channel.
const { typingLabel } = useTypingIndicator(toRef(props, 'channelId'));

// Index of the first message strictly newer than the unread divider
// marker for the current channel. Returns -1 when the channel has no
// snapshot, no marker, or every loaded message is older — in those
// cases the divider is suppressed entirely. Re-evaluates on every
// messages/channel change so SSE arrivals naturally land below.
const unreadStore = useUnreadStore();
// View-source modal — shows the raw markdown for a message so admins
// can copy syntax verbatim or debug rendering. Pinned to a single
// reactive ref because at most one source modal is ever open.
const sourceModalMessage = ref<Message | null>(null);
function closeSourceModal() { sourceModalMessage.value = null; }
async function copySourceToClipboard() {
    if (!sourceModalMessage.value) return;
    try { await navigator.clipboard.writeText(sourceModalMessage.value.content ?? ''); } catch { /* ignore */ }
}

// Context menu (right-click / long-press).
const { ctxMenu, ctxActions, onMessageContextMenu, onMessageTouchStart, onMessageTouchEnd, onContextPick } = useMessageContextMenu({
    messages: toRef(props, 'messages'),
    botUserId: toRef(props, 'botUserId'),
    canForward: toRef(props, 'canForward'),
    canModerate: toRef(props, 'canModerate'),
    channelId: toRef(props, 'channelId'),
    emit: (event: string, message: Message) => (emit as (e: string, m: Message) => void)(event, message),
    onShowSource: (message) => { sourceModalMessage.value = message; },
    onStartReact: (message, btn) => {
        reactingButton.value = btn;
        reactingMessageId.value = message.id;
    },
    onCopyLink: (message) => copyMessageLink(message),
});


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

function closeReactPicker() {
    reactingMessageId.value = null;
    reactingButton.value = null;
}

function onMessagesScroll() {
    const el = messagesContainer.value;
    if (!el) return;
    if (el.scrollTop < 80 && props.hasMore && !props.loadingOlder) emit('load-older');
    if (reactingMessageId.value) closeReactPicker();
}

// ── Scroll position memory ──────────────────────────────────────────────────
const { scrollToBottom, scrollToMessage, isNearBottom } = useScrollMemory({
    channelId: toRef(props, 'channelId'),
    messages: toRef(props, 'messages'),
    messagesContainer,
    scrollerRef,
    plainListRef,
    onScroll: onMessagesScroll,
    onChannelSwitch: closeReactPicker,
});

onBeforeUnmount(() => {
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
        <ConversationHeader
            v-if="channelId"
            :channel-id="channelId"
            :header-title="headerTitle"
            :header-subtitle="headerSubtitle"
            :can-browse-threads="canBrowseThreads"
            :pin-fetcher="pinFetcher"
            @browse-threads="emit('browse-threads')"
            @jump-to-message="(id) => emit('jump-to-message', id)"
        >
            <template v-if="$slots.header" #default>
                <slot name="header" />
            </template>
        </ConversationHeader>
        <p v-if="error" class="error">{{ error }}</p>
        <DynamicScroller
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
                        <MessageActionBar
                            :message="message"
                            :is-own="isOwn(message)"
                            :shift-held="shiftHeld"
                            :reacting="reactingMessageId === message.id"
                            :copied="copiedMessageId === message.id"
                            @react="startReact(message.id)"
                            @reply="emit('reply', message)"
                            @edit="emit('request-edit', message)"
                            @copy-link="copyMessageLink(message)"
                            @delete="(ev) => emit('delete', message, ev)"
                            @register-react-button="(el) => setReactButton(message.id, el)"
                            @unregister-react-button="setReactButton(message.id, null)"
                        />
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
        <MessageSourceModal
            :message="sourceModalMessage"
            @close="closeSourceModal"
            @copy="copySourceToClipboard"
        />
        <div v-if="channelId && typingLabel" class="typing-row">{{ typingLabel }}</div>
        <footer v-if="channelId" class="composer-row">
            <MessageComposer
                ref="composerRef"
                :channel-id="channelId"
                :reply-to="replyToProp"
                :disabled="sending"
                @send="(payload: OutgoingMessage) => emit('send', payload)"
                @cancel-reply="emit('cancel-reply')"
            >
                <template v-if="showProactiveFeatures" #leading-actions="{ disabled }">
                    <ProactiveFeaturesMenu
                        :disabled="disabled"
                        @pick="(name: string) => emit('proactive-action', name)"
                    />
                </template>
            </MessageComposer>
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
.error { color: var(--danger); margin: 0.5rem 1rem; }
.messages { flex: 1; overflow-y: auto; padding: 0.5rem 0; }
.center { text-align: center; margin: 2rem 0; }
.small { font-size: 0.8rem; margin: 0.5rem 0; }
.message-wrap { position: relative; }
.message-wrap.group-start:not(:first-child) { margin-top: .75rem; }
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
/* Hover trigger for the MessageActionBar sub-component. The opacity
   transition lives inside MessageActionBar.vue; the parent drives the
   visible state via :deep so the scoped boundary is respected. */
.message-wrap:hover :deep(.message-actions),
:deep(.message-actions:focus-within) { opacity: 1; }
.composer-row {
    padding: 0.5rem 0.75rem;
}
.typing-row {
    padding: 0 1rem 0.2rem;
    font-size: 0.78rem;
    color: var(--text-muted);
    font-style: italic;
}

.muted { color: var(--text-muted); font-size: 0.9rem; }
</style>
