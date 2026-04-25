<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Icon } from '@iconify/vue';
import { useI18n } from 'vue-i18n';
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
const { t: $t } = useI18n();

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

// ── System messages (joins, pins, boosts, …) ───────────────────────
//
// Discord MessageType numeric constants — only the ones rendered with
// a custom line. Anything else with `system: true` falls back to the
// generic `systemMsg.fallback` text.
const TYPE_CHANNEL_PIN = 6;
const TYPE_USER_JOIN = 7;
const TYPE_BOOST = 8;
const TYPE_BOOST_TIER1 = 9;
const TYPE_BOOST_TIER2 = 10;
const TYPE_BOOST_TIER3 = 11;
const TYPE_CHANNEL_FOLLOW_ADD = 12;
const TYPE_THREAD_CREATED = 18;
const TYPE_AUTOMOD = 24;
const TYPE_STAGE_START = 27;
const TYPE_STAGE_END = 28;
const TYPE_STAGE_SPEAKER = 29;
const TYPE_STAGE_TOPIC = 31;

const systemIcon = computed(() => {
    switch (props.message.type) {
        case TYPE_CHANNEL_PIN: return 'material-symbols:keep-rounded';
        case TYPE_USER_JOIN: return 'material-symbols:waving-hand-outline-rounded';
        case TYPE_BOOST:
        case TYPE_BOOST_TIER1:
        case TYPE_BOOST_TIER2:
        case TYPE_BOOST_TIER3: return 'material-symbols:bolt-rounded';
        case TYPE_CHANNEL_FOLLOW_ADD: return 'material-symbols:rss-feed-rounded';
        case TYPE_THREAD_CREATED: return 'material-symbols:forum-outline-rounded';
        case TYPE_AUTOMOD: return 'material-symbols:shield-outline-rounded';
        case TYPE_STAGE_START:
        case TYPE_STAGE_END:
        case TYPE_STAGE_SPEAKER:
        case TYPE_STAGE_TOPIC: return 'material-symbols:campaign-outline-rounded';
        default: return 'material-symbols:info-outline-rounded';
    }
});

const systemText = computed(() => {
    const name = displayName.value;
    switch (props.message.type) {
        case TYPE_CHANNEL_PIN: return $t('systemMsg.pin', { name });
        case TYPE_USER_JOIN: return $t('systemMsg.join', { name });
        case TYPE_BOOST: return $t('systemMsg.boost', { name });
        case TYPE_BOOST_TIER1: return $t('systemMsg.boostTier', { name, tier: 1 });
        case TYPE_BOOST_TIER2: return $t('systemMsg.boostTier', { name, tier: 2 });
        case TYPE_BOOST_TIER3: return $t('systemMsg.boostTier', { name, tier: 3 });
        case TYPE_CHANNEL_FOLLOW_ADD: return $t('systemMsg.channelFollowAdd', { name });
        case TYPE_THREAD_CREATED: return $t('systemMsg.threadCreated', { name });
        case TYPE_AUTOMOD: return $t('systemMsg.automod');
        case TYPE_STAGE_START: return $t('systemMsg.stageStart', { name });
        case TYPE_STAGE_END: return $t('systemMsg.stageEnd', { name });
        case TYPE_STAGE_SPEAKER: return $t('systemMsg.stageSpeaker', { name });
        case TYPE_STAGE_TOPIC: return $t('systemMsg.stageTopic', { name });
        default: return $t('systemMsg.fallback', { name });
    }
});

// ── Forwarded message snapshots ────────────────────────────────────
//
// Each snapshot is a partial message (no author / id) — Discord renders
// forwards as a quoted block under the wrapper. We pre-parse each
// snapshot's content via the same markdown parser as the main body so
// mentions / emoji / links light up identically.
function snapshotAst(content: string) {
    return parseMessageContent(content);
}
</script>

<template>
    <!-- System events (joins, pins, boosts, …) render as a compact
         single-row banner; the body / avatar / actions are suppressed. -->
    <article
        v-if="message.system"
        :class="['message', 'system-message']"
        :data-message-id="message.id"
    >
        <Icon :icon="systemIcon" width="16" height="16" class="system-icon" />
        <span class="system-text">{{ systemText }}</span>
        <time class="system-time" :datetime="message.createdAt">{{ time }}</time>
    </article>
    <article
        v-else
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
                <MessageContent v-if="message.content" :nodes="ast" />
                <MessageAttachment
                    v-for="att in message.attachments ?? []"
                    :key="att.id"
                    :attachment="att"
                    :siblings="message.attachments ?? []"
                />
                <MessageSticker v-for="sticker in message.stickers ?? []" :key="sticker.id" :sticker="sticker" />
                <MessageEmbed v-for="(embed, idx) in message.embeds ?? []" :key="idx" :embed="embed" />
                <!-- Forward snapshots — Discord wraps the original
                     message content in a quoted-block under a wrapper
                     message; the wrapper's own content is empty. We
                     render each snapshot inline with its content +
                     attachments + embeds + stickers. -->
                <div
                    v-for="(snap, i) in message.messageSnapshots ?? []"
                    :key="`snap-${i}`"
                    class="forward-snap"
                >
                    <header class="forward-snap-head">
                        <Icon icon="material-symbols:forward-rounded" width="14" height="14" />
                        <span>{{ $t('systemMsg.forwarded') }}</span>
                    </header>
                    <div class="forward-snap-body">
                        <MessageContent v-if="snap.content" :nodes="snapshotAst(snap.content)" />
                        <MessageAttachment
                            v-for="att in snap.attachments ?? []"
                            :key="`snap-att-${att.id}`"
                            :attachment="att"
                            :siblings="snap.attachments ?? []"
                        />
                        <MessageSticker
                            v-for="sticker in snap.stickers ?? []"
                            :key="`snap-st-${sticker.id}`"
                            :sticker="sticker"
                        />
                        <MessageEmbed
                            v-for="(embed, ei) in snap.embeds ?? []"
                            :key="`snap-em-${ei}`"
                            :embed="embed"
                        />
                    </div>
                </div>
                <button
                    v-if="message.thread && ctx.onThreadClick"
                    type="button"
                    class="thread-chip"
                    @click.stop="ctx.onThreadClick?.(message.thread!.id)"
                >
                    <span class="thread-chip-icon">›</span>
                    <span class="thread-chip-name">{{ message.thread.name }}</span>
                    <span v-if="message.thread.messageCount > 0" class="thread-chip-count">
                        {{ message.thread.messageCount }}
                    </span>
                </button>
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
.thread-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    margin-top: 0.3rem;
    padding: 0.25rem 0.6rem;
    background: var(--bg-surface-2);
    border: 1px solid var(--border);
    border-radius: 999px;
    color: var(--text);
    font: inherit;
    font-size: 0.78rem;
    cursor: pointer;
    align-self: flex-start;
}
.thread-chip:hover { background: var(--bg-surface-hover); border-color: var(--accent); }
.thread-chip-icon { color: var(--text-muted); font-weight: 700; }
.thread-chip-name { font-weight: 500; }
.thread-chip-count {
    background: var(--accent-bg);
    color: var(--accent-text-strong);
    border-radius: 999px;
    padding: 0 0.4rem;
    font-size: 0.7rem;
    font-variant-numeric: tabular-nums;
}

/* System messages — joins, pins, boosts, etc. Compact one-line row,
   indented to match where regular message body content starts so the
   icon column visually replaces the avatar column. */
.system-message {
    flex-direction: row;
    align-items: center;
    gap: 0.55rem;
    padding: 0.25rem 0.75rem 0.25rem 1.25rem;
    color: var(--text-muted);
    font-size: 0.85rem;
}
.system-message .system-icon { color: var(--text-muted); flex-shrink: 0; }
.system-message .system-text { flex: 1; min-width: 0; }
.system-message .system-time {
    font-size: 0.72rem;
    color: var(--text-muted);
    flex-shrink: 0;
}

/* Forward snapshot — quoted-block style under the wrapper message. */
.forward-snap {
    margin-top: 0.3rem;
    border-left: 3px solid var(--accent);
    padding: 0.3rem 0.6rem;
    background: var(--bg-surface-2);
    border-radius: 4px;
}
.forward-snap-head {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    color: var(--text-muted);
    font-size: 0.72rem;
    margin-bottom: 0.2rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
}
.forward-snap-body {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
}
</style>
