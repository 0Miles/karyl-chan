<script setup lang="ts">
import { computed } from 'vue';
import { useMessageContext } from './context';
import { twemojiUrl } from './twemoji';
import type { MessageReaction } from './types';

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

function toggle(r: MessageReaction) {
    if (r.me) ctx.onReactionRemove?.(props.messageId, r.emoji);
    else ctx.onReactionAdd?.(props.messageId, r.emoji);
}

// Per-reaction broken-image flag. When the twemoji CDN is unreachable
// (or future CSP changes block it), the 22×22 broken-image frame is
// too small to even show alt text, so we swap to the raw unicode glyph
// and let the OS draw its native emoji.
import { reactive } from 'vue';
const failed = reactive(new Set<string>());
function reactionKey(r: MessageReaction): string {
    return r.emoji.id ?? r.emoji.name;
}
function onImgError(r: MessageReaction) {
    failed.add(reactionKey(r));
}
</script>

<template>
    <div class="reactions">
        <button
            v-for="item in items"
            :key="item.reaction.emoji.id ?? item.reaction.emoji.name"
            type="button"
            :class="['reaction', { mine: item.reaction.me }]"
            @click="toggle(item.reaction)"
        >
            <img
                v-if="item.url && !failed.has(reactionKey(item.reaction))"
                :src="item.url"
                :alt="item.alt"
                class="emoji"
                @error="onImgError(item.reaction)"
            />
            <span v-else class="emoji-fallback">{{ item.reaction.emoji.name }}</span>
            <span class="count">{{ item.reaction.count }}</span>
        </button>
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
