<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import MessageContent from './MessageContent.vue';
import MessageReplyHeader from './MessageReplyHeader.vue';
import MessageAttachment from './MessageAttachment.vue';
import MessageSticker from './MessageSticker.vue';
import MessageReactions from './MessageReactions.vue';
import MessageEmbed from './MessageEmbed.vue';
import { parseMessageContent } from './markdown';
import { useMessageContext } from './context';
import type { Message } from './types';

const ctx = useMessageContext();

const props = defineProps<{
    message: Message;
    compact?: boolean;
    editing?: boolean;
}>();

const emit = defineEmits<{
    (e: 'submit-edit', content: string): void;
    (e: 'cancel-edit'): void;
}>();

const ast = computed(() => parseMessageContent(props.message.content));
const time = computed(() => {
    const d = new Date(props.message.createdAt);
    return Number.isNaN(d.getTime()) ? props.message.createdAt : d.toLocaleString();
});
const resolvedAuthor = computed(() => ctx.resolveUser?.(props.message.author.id) ?? null);
// Prefer the guild nickname the backend attaches from `message.member`,
// so guild surfaces render each author by their per-guild identity even
// before the channel-members cache has populated for resolveUser.
const displayName = computed(() =>
    props.message.author.nickname
    ?? props.message.author.globalName
    ?? props.message.author.username
);
// Discord renders author names in the member's highest-coloured role.
// resolveUser returns the colour when the context knows about the member
// (guild surfaces with a populated channel-members cache); DM fall through
// to no colour.
const authorColor = computed(() => resolvedAuthor.value?.color ?? null);

const hovered = ref(false);
const avatarSrc = computed(() => {
    const url = props.message.author.avatarUrl;
    if (!url) return null;
    if (hovered.value && ctx.mediaProvider?.avatarHoverUrl) {
        return ctx.mediaProvider.avatarHoverUrl(url) ?? url;
    }
    return url;
});

const editDraft = ref('');
watch(() => props.editing, (val) => {
    if (val) editDraft.value = props.message.content;
});

function onEditKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
        event.preventDefault();
        emit('cancel-edit');
    } else if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        emit('submit-edit', editDraft.value);
    }
}

function onAuthorClick(event: MouseEvent) {
    if (!ctx.onUserClick) return;
    const anchor = event.currentTarget as HTMLElement | null;
    if (!anchor) return;
    event.preventDefault();
    event.stopPropagation();
    ctx.onUserClick(props.message.author.id, anchor);
}

function onAuthorContextMenu(event: MouseEvent) {
    if (!ctx.onUserContextMenu) return;
    const anchor = event.currentTarget as HTMLElement | null;
    if (!anchor) return;
    event.preventDefault();
    event.stopPropagation();
    ctx.onUserContextMenu(
        props.message.author.id,
        anchor,
        { x: event.clientX, y: event.clientY },
        displayName.value
    );
}

// Touch long-press on the avatar/name. Mirrors DiscordConversation's
// LONG_PRESS_MS so the timing feels consistent across surfaces. Without
// this, mobile long-press on the author would never fire `onUserContextMenu`
// — the parent message wrapper's touch handler would win and open the
// message menu instead.
const AUTHOR_LONG_PRESS_MS = 450;
let authorLongPressTimer: ReturnType<typeof setTimeout> | null = null;
function onAuthorTouchStart(event: TouchEvent) {
    if (!ctx.onUserContextMenu) return;
    if (event.touches.length !== 1) return;
    const anchor = event.currentTarget as HTMLElement | null;
    if (!anchor) return;
    const touch = event.touches[0];
    if (authorLongPressTimer) clearTimeout(authorLongPressTimer);
    authorLongPressTimer = setTimeout(() => {
        authorLongPressTimer = null;
        ctx.onUserContextMenu?.(
            props.message.author.id,
            anchor,
            { x: touch.clientX, y: touch.clientY },
            displayName.value
        );
    }, AUTHOR_LONG_PRESS_MS);
}
function onAuthorTouchEnd() {
    if (authorLongPressTimer) {
        clearTimeout(authorLongPressTimer);
        authorLongPressTimer = null;
    }
}
</script>

<template>
    <article
        :class="['message', { compact }]"
        :data-message-id="message.id"
        @mouseenter="hovered = true"
        @mouseleave="hovered = false"
    >
        <MessageReplyHeader v-if="message.referencedMessage" :referenced="message.referencedMessage" />
        <header v-if="!compact" class="header">
            <img
                v-if="avatarSrc"
                :src="avatarSrc"
                alt=""
                class="avatar author-click"
                @click.stop="onAuthorClick"
                @contextmenu.stop="onAuthorContextMenu"
                @touchstart.stop.passive="onAuthorTouchStart"
                @touchend.stop="onAuthorTouchEnd"
                @touchmove.stop="onAuthorTouchEnd"
                @touchcancel.stop="onAuthorTouchEnd"
            />
            <div
                v-else
                class="avatar avatar-fallback author-click"
                @click.stop="onAuthorClick"
                @contextmenu.stop="onAuthorContextMenu"
                @touchstart.stop.passive="onAuthorTouchStart"
                @touchend.stop="onAuthorTouchEnd"
                @touchmove.stop="onAuthorTouchEnd"
                @touchcancel.stop="onAuthorTouchEnd"
            >{{ displayName.charAt(0).toUpperCase() }}</div>
            <div class="meta">
                <span
                    class="name author-click"
                    :style="authorColor ? { color: authorColor } : undefined"
                    @click.stop="onAuthorClick"
                    @contextmenu.stop="onAuthorContextMenu"
                    @touchstart.stop.passive="onAuthorTouchStart"
                    @touchend.stop="onAuthorTouchEnd"
                    @touchmove.stop="onAuthorTouchEnd"
                    @touchcancel.stop="onAuthorTouchEnd"
                >{{ displayName }}</span>
                <span v-if="message.author.bot" class="bot-tag">BOT</span>
                <time class="time" :datetime="message.createdAt">{{ time }}</time>
                <span v-if="message.editedAt" class="edited">(edited)</span>
            </div>
        </header>
        <div class="body">
            <div v-if="editing" class="editor">
                <textarea
                    v-model="editDraft"
                    rows="2"
                    class="edit-textarea"
                    @keydown="onEditKeydown"
                />
                <div class="edit-actions">
                    <span class="hint">esc to cancel · enter to save</span>
                    <button type="button" @click="$emit('cancel-edit')">Cancel</button>
                    <button type="button" class="primary" @click="$emit('submit-edit', editDraft)">Save</button>
                </div>
            </div>
            <template v-else>
                <MessageContent :nodes="ast" />
                <MessageAttachment
                    v-for="att in message.attachments ?? []"
                    :key="att.id"
                    :attachment="att"
                    :siblings="message.attachments ?? []"
                />
                <MessageSticker v-for="sticker in message.stickers ?? []" :key="sticker.id" :sticker="sticker" />
                <MessageEmbed v-for="(embed, idx) in message.embeds ?? []" :key="idx" :embed="embed" />
                <MessageReactions
                    v-if="message.reactions?.length"
                    :message-id="message.id"
                    :reactions="message.reactions"
                />
            </template>
        </div>
    </article>
</template>

<style scoped>
.message {
    display: flex;
    flex-direction: column;
    padding: 0.4rem 0.75rem;
    gap: 0.15rem;
}
.message:hover {
    background: var(--bg-surface-hover);
}
.message.compact {
    padding-top: 0.1rem;
    padding-bottom: 0.1rem;
}
.header {
    display: flex;
    align-items: flex-start;
    gap: 0.6rem;
}
.avatar {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    object-fit: cover;
    flex-shrink: 0;
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
    display: flex;
    align-items: baseline;
    gap: 0.4rem;
    flex-wrap: wrap;
}
.name {
    font-weight: 600;
    color: var(--text-strong);
}
.author-click {
    cursor: pointer;
}
.author-click:hover {
    text-decoration: underline;
    text-underline-offset: 2px;
}
img.author-click:hover,
div.author-click:hover {
    text-decoration: none;
    opacity: 0.88;
}
.bot-tag {
    background: var(--accent);
    color: var(--text-on-accent);
    font-size: 0.65rem;
    font-weight: 700;
    padding: 1px 4px;
    border-radius: 3px;
    line-height: 1;
}
.time {
    font-size: 0.75rem;
    color: var(--text-muted);
}
.edited {
    font-size: 0.75rem;
    color: var(--text-faint);
}
.body {
    margin-left: 2.85rem;
    margin-top: -0.7rem;
}
.compact .body {
    margin-left: 2.85rem;
    margin-top: 0;
}
.editor {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
}
.edit-textarea {
    width: 100%;
    padding: 0.4rem 0.5rem;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg-surface-2);
    color: var(--text);
    font: inherit;
    resize: vertical;
}
.edit-actions {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.8rem;
}
.hint {
    color: var(--text-muted);
    margin-right: auto;
}
.edit-actions button {
    padding: 0.2rem 0.7rem;
    border: 1px solid var(--border);
    background: var(--bg-surface);
    color: var(--text);
    border-radius: 4px;
    cursor: pointer;
}
.edit-actions button.primary {
    background: var(--accent);
    color: var(--text-on-accent);
    border-color: var(--accent);
}
</style>
