<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useMessageContext } from './context';
import { twemojiUrl } from './twemoji';
import MessageContextMenu, { type ContextMenuAction } from './MessageContextMenu.vue';
import type { MessageEmoji, MessageReaction } from './types';

const props = defineProps<{
    messageId: string;
    reactions: MessageReaction[];
}>();

const ctx = useMessageContext();
const { t: $t } = useI18n();

const items = computed(() =>
    props.reactions.map(r => {
        const isCustom = r.emoji.id !== null;
        let url = '';
        let alt = r.emoji.name;
        if (isCustom) {
            if (ctx.resolveCustomEmoji) {
                const meta = ctx.resolveCustomEmoji(r.emoji.id!, !!r.emoji.animated, r.emoji.name);
                url = meta.url; alt = meta.alt;
            } else if (ctx.mediaProvider?.customEmojiUrl) {
                url = ctx.mediaProvider.customEmojiUrl({ id: r.emoji.id!, animated: !!r.emoji.animated, name: r.emoji.name });
                alt = `:${r.emoji.name}:`;
            }
        } else {
            url = twemojiUrl(r.emoji.name) ?? '';
        }
        return { reaction: r, url, alt };
    })
);

// Per-reaction broken-image flag. When the twemoji CDN is unreachable
// (or future CSP changes block it), the 22×22 broken-image frame is
// too small to even show alt text, so we swap to the raw unicode glyph
// and let the OS draw its native emoji.
const failed = reactive<Record<string, true>>({});
function reactionKey(r: MessageReaction): string {
    return r.emoji.id ?? r.emoji.name;
}
function onImgError(r: MessageReaction) {
    failed[reactionKey(r)] = true;
}

// Click → toggle add/remove (the original Discord behavior); the
// reactor list now lives in the right-click menu instead of a
// click-popover so a primary tap is always a one-step toggle.
function onReactionClick(r: MessageReaction) {
    if (r.me) ctx.onReactionRemove?.(props.messageId, r.emoji);
    else ctx.onReactionAdd?.(props.messageId, r.emoji);
}

// Right-click (long-press on touch) opens the context menu. The list
// of users who reacted is fetched lazily on open and rendered as menu
// items below the toggle action — clicking a user opens their profile
// via MessageContext.onUserClick, matching the avatar/mention flows.
const ctxMenu = ref<{ x: number; y: number; reaction: MessageReaction } | null>(null);
const ctxAnchorRef = ref<HTMLElement | null>(null);
const ctxUsers = ref<Array<{ id: string; username: string; globalName: string | null; avatarUrl: string }>>([]);
const ctxUsersLoading = ref(false);
const ctxUsersError = ref<string | null>(null);

const LONG_PRESS_MS = 450;
let longPressTimer: ReturnType<typeof setTimeout> | null = null;

async function openContextFor(reaction: MessageReaction, x: number, y: number, anchor: HTMLElement | null) {
    ctxMenu.value = { x, y, reaction };
    ctxAnchorRef.value = anchor;
    ctxUsers.value = [];
    ctxUsersError.value = null;
    if (!ctx.fetchReactionUsers) return;
    ctxUsersLoading.value = true;
    try {
        const users = await ctx.fetchReactionUsers(props.messageId, reaction.emoji);
        // Stale-result guard: another reaction may have been opened by
        // the time this fetch resolves.
        if (ctxMenu.value?.reaction !== reaction) return;
        ctxUsers.value = users;
    } catch (err) {
        if (ctxMenu.value?.reaction !== reaction) return;
        ctxUsersError.value = err instanceof Error ? err.message : 'Failed to load reactions';
    } finally {
        if (ctxMenu.value?.reaction === reaction) ctxUsersLoading.value = false;
    }
}

function onContextMenu(event: MouseEvent, reaction: MessageReaction) {
    event.preventDefault();
    event.stopPropagation();
    void openContextFor(reaction, event.clientX, event.clientY, event.currentTarget as HTMLElement | null);
}

function onTouchStart(event: TouchEvent, reaction: MessageReaction) {
    if (event.touches.length !== 1) return;
    if (longPressTimer) clearTimeout(longPressTimer);
    const touch = event.touches[0];
    const anchor = event.currentTarget as HTMLElement | null;
    longPressTimer = setTimeout(() => {
        longPressTimer = null;
        void openContextFor(reaction, touch.clientX, touch.clientY, anchor);
    }, LONG_PRESS_MS);
}
function onTouchEnd() {
    if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
    }
}

const ctxActions = computed<ContextMenuAction[]>(() => {
    const ctxState = ctxMenu.value;
    if (!ctxState) return [];
    const r = ctxState.reaction;
    const actions: ContextMenuAction[] = [
        {
            key: 'toggle',
            label: r.me ? $t('messages.reactionRemove') : $t('messages.reactionAdd'),
            icon: r.me ? 'material-symbols:heart-broken-outline-rounded' : 'material-symbols:add-reaction-outline-rounded'
        },
        {
            key: 'copy-emoji',
            label: $t('messages.reactionCopyEmoji'),
            icon: 'material-symbols:content-copy-outline-rounded'
        }
    ];
    if (ctxUsersLoading.value) {
        actions.push({ key: '__loading', label: $t('common.loading'), icon: 'material-symbols:hourglass-empty-rounded' });
    } else if (ctxUsersError.value) {
        actions.push({ key: '__error', label: ctxUsersError.value, icon: 'material-symbols:error-outline-rounded', danger: true });
    } else if (ctxUsers.value.length === 0) {
        actions.push({ key: '__empty', label: $t('messages.reactionNoUsers'), icon: 'material-symbols:groups-outline-rounded' });
    } else {
        for (const u of ctxUsers.value) {
            actions.push({
                key: `user:${u.id}`,
                label: u.globalName ?? u.username,
                iconUrl: u.avatarUrl
            });
        }
    }
    return actions;
});

function onContextPick(actionKey: string) {
    const state = ctxMenu.value;
    if (!state) return;
    if (actionKey === 'toggle') {
        if (state.reaction.me) ctx.onReactionRemove?.(props.messageId, state.reaction.emoji);
        else ctx.onReactionAdd?.(props.messageId, state.reaction.emoji);
        return;
    }
    if (actionKey === 'copy-emoji') {
        // Custom emoji → Discord's `<:name:id>` form so it can be
        // pasted straight back into the composer; unicode → the raw
        // glyph from `r.emoji.name`.
        const e = state.reaction.emoji;
        const text = e.id ? `<${e.animated ? 'a' : ''}:${e.name}:${e.id}>` : e.name;
        void navigator.clipboard?.writeText(text).catch(() => { /* ignore */ });
        return;
    }
    if (actionKey.startsWith('user:')) {
        const id = actionKey.slice('user:'.length);
        if (ctx.onUserClick && ctxAnchorRef.value) {
            ctx.onUserClick(id, ctxAnchorRef.value);
        }
        return;
    }
    // __loading / __error / __empty: no-op informational entries.
}
</script>

<template>
    <div class="reactions">
        <button
            v-for="item in items"
            :key="item.reaction.emoji.id ?? item.reaction.emoji.name"
            type="button"
            :class="['reaction', { mine: item.reaction.me }]"
            @click.stop="onReactionClick(item.reaction)"
            @contextmenu.stop="onContextMenu($event, item.reaction)"
            @touchstart.stop.passive="onTouchStart($event, item.reaction)"
            @touchend.stop="onTouchEnd"
            @touchmove.stop="onTouchEnd"
            @touchcancel.stop="onTouchEnd"
        >
            <img
                v-if="item.url && !failed[reactionKey(item.reaction)]"
                :src="item.url"
                :alt="item.alt"
                class="emoji"
                @error="onImgError(item.reaction)"
            />
            <span v-else class="emoji-fallback">{{ item.reaction.emoji.name }}</span>
            <span class="count">{{ item.reaction.count }}</span>
        </button>
        <MessageContextMenu
            :visible="ctxMenu !== null"
            :x="ctxMenu?.x ?? 0"
            :y="ctxMenu?.y ?? 0"
            :actions="ctxActions"
            @pick="onContextPick"
            @close="ctxMenu = null"
        />
    </div>
</template>

<style scoped>
.reactions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
    margin-top: 0.5rem;
}
.reaction {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 3px 8px;
    border: 1px solid transparent;
    background: var(--pill-bg);
    color: var(--text);
    border-radius: 10px;
    cursor: pointer;
    font-size: 0.95rem;
    line-height: 1;
}
.reaction:hover {
    border-color: var(--accent);
}
.reaction.mine {
    background: var(--accent-bg);
    border-color: var(--accent);
    color: var(--accent-text-strong);
}
.emoji {
    width: 22px;
    height: 22px;
    object-fit: contain;
}
.emoji-fallback {
    font-size: 1.2rem;
    line-height: 1;
}
.count {
    font-variant-numeric: tabular-nums;
    font-size: 0.85rem;
    color: var(--text-muted);
}
.reaction.mine .count {
    color: var(--accent-text-strong);
}
</style>
