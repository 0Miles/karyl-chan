<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue';
import { useMessageContext } from './context';
import { twemojiUrl } from './twemoji';
import type { MessageEmoji, MessageReaction } from './types';

const props = defineProps<{
    messageId: string;
    reactions: MessageReaction[];
}>();

const ctx = useMessageContext();

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

// Click-to-open users popover. Holds the active reaction key + the
// fetched user list; lazy-loads on first open. Toggle is moved off
// the chip click and into a button inside the popover so the chip
// becomes a "show details" target — admin clients spend more time
// observing than reacting, so this trade is worth it.
interface ReactedUser {
    id: string;
    username: string;
    globalName: string | null;
    avatarUrl: string;
}
const popoverKey = ref<string | null>(null);
const popoverUsers = ref<ReactedUser[]>([]);
const popoverLoading = ref(false);
const popoverError = ref<string | null>(null);
const popoverEmoji = ref<MessageEmoji | null>(null);
const popoverIsMine = ref(false);
const rootRef = ref<HTMLDivElement | null>(null);

async function openPopover(item: { reaction: MessageReaction }) {
    const key = reactionKey(item.reaction);
    if (popoverKey.value === key) {
        popoverKey.value = null;
        return;
    }
    popoverKey.value = key;
    popoverEmoji.value = item.reaction.emoji;
    popoverIsMine.value = item.reaction.me;
    popoverUsers.value = [];
    popoverError.value = null;
    if (!ctx.fetchReactionUsers) return;
    popoverLoading.value = true;
    try {
        popoverUsers.value = await ctx.fetchReactionUsers(props.messageId, item.reaction.emoji);
    } catch (err) {
        popoverError.value = err instanceof Error ? err.message : 'Failed to load reactions';
    } finally {
        popoverLoading.value = false;
    }
}

function closePopover() {
    popoverKey.value = null;
}

function onPopoverToggle() {
    if (!popoverEmoji.value) return;
    if (popoverIsMine.value) ctx.onReactionRemove?.(props.messageId, popoverEmoji.value);
    else ctx.onReactionAdd?.(props.messageId, popoverEmoji.value);
    closePopover();
}

function onWindowDown(event: MouseEvent) {
    if (!popoverKey.value) return;
    if (rootRef.value?.contains(event.target as Node)) return;
    closePopover();
}
function onWindowKey(event: KeyboardEvent) {
    if (!popoverKey.value) return;
    if (event.key === 'Escape') {
        event.preventDefault();
        closePopover();
    }
}

onMounted(() => {
    window.addEventListener('mousedown', onWindowDown);
    window.addEventListener('keydown', onWindowKey);
});
onUnmounted(() => {
    window.removeEventListener('mousedown', onWindowDown);
    window.removeEventListener('keydown', onWindowKey);
});

function userDisplay(u: ReactedUser): string {
    return u.globalName ?? u.username;
}
</script>

<template>
    <div ref="rootRef" class="reactions">
        <div v-for="item in items" :key="item.reaction.emoji.id ?? item.reaction.emoji.name" class="reaction-wrap">
            <button
                type="button"
                :class="['reaction', { mine: item.reaction.me, open: popoverKey === reactionKey(item.reaction) }]"
                @click="openPopover(item)"
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
            <div v-if="popoverKey === reactionKey(item.reaction)" class="reaction-pop">
                <header class="reaction-pop-head">
                    <button type="button" :class="['reaction-toggle', { mine: popoverIsMine }]" @click="onPopoverToggle">
                        {{ popoverIsMine ? $t('messages.reactionRemove') : $t('messages.reactionAdd') }}
                    </button>
                </header>
                <p v-if="popoverLoading" class="reaction-state">{{ $t('common.loading') }}</p>
                <p v-else-if="popoverError" class="reaction-state error">{{ popoverError }}</p>
                <p v-else-if="popoverUsers.length === 0" class="reaction-state">{{ $t('messages.reactionNoUsers') }}</p>
                <ul v-else class="reaction-users">
                    <li v-for="u in popoverUsers" :key="u.id">
                        <img v-if="u.avatarUrl" :src="u.avatarUrl" alt="" class="user-avatar" />
                        <div v-else class="user-avatar avatar-fallback">{{ userDisplay(u).charAt(0).toUpperCase() }}</div>
                        <span class="user-name">{{ userDisplay(u) }}</span>
                    </li>
                </ul>
            </div>
        </div>
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
.reaction.open { box-shadow: 0 0 0 2px var(--accent); }
.reaction-wrap { position: relative; }
.reaction-pop {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    z-index: 8;
    width: 240px;
    max-height: 280px;
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: 6px;
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.28);
    display: flex;
    flex-direction: column;
    overflow: hidden;
}
.reaction-pop-head {
    padding: 0.4rem 0.6rem;
    border-bottom: 1px solid var(--border);
}
.reaction-toggle {
    background: var(--accent);
    color: var(--text-on-accent);
    border: none;
    border-radius: 4px;
    padding: 0.3rem 0.6rem;
    cursor: pointer;
    font: inherit;
    font-size: 0.85rem;
    width: 100%;
}
.reaction-toggle.mine {
    background: var(--bg-surface-2);
    color: var(--text);
    border: 1px solid var(--border);
}
.reaction-toggle:hover { filter: brightness(1.1); }
.reaction-state { padding: 1rem; text-align: center; color: var(--text-muted); font-size: 0.85rem; margin: 0; }
.reaction-state.error { color: var(--danger); }
.reaction-users { list-style: none; margin: 0; padding: 0.25rem 0; overflow-y: auto; }
.reaction-users li {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.3rem 0.6rem;
}
.user-avatar {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    object-fit: cover;
    flex-shrink: 0;
    background: var(--bg-surface-2);
}
.user-avatar.avatar-fallback {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-on-accent);
    background: var(--accent);
    font-size: 0.7rem;
    font-weight: 600;
}
.user-name { font-size: 0.85rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
