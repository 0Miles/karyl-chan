<script setup lang="ts">
import { computed } from 'vue';
import { useMessageContext, defaultContext } from './context';
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
        const meta = isCustom
            ? (ctx.resolveCustomEmoji ?? defaultContext.resolveCustomEmoji)(r.emoji.id!, !!r.emoji.animated, r.emoji.name)
            : { url: twemojiUrl(r.emoji.name) ?? '', alt: r.emoji.name };
        return { reaction: r, url: meta.url, alt: meta.alt };
    })
);

function toggle(r: MessageReaction) {
    if (r.me) ctx.onReactionRemove?.(props.messageId, r.emoji);
    else ctx.onReactionAdd?.(props.messageId, r.emoji);
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
            <img v-if="item.url" :src="item.url" :alt="item.alt" class="emoji" />
            <span v-else class="emoji-fallback">{{ item.reaction.emoji.name }}</span>
            <span class="count">{{ item.reaction.count }}</span>
        </button>
    </div>
</template>

<style scoped>
.reactions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
    margin-top: 0.25rem;
}
.reaction {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 1px 6px;
    border: 1px solid transparent;
    background: var(--pill-bg);
    color: var(--text);
    border-radius: 8px;
    cursor: pointer;
    font-size: 0.85rem;
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
    width: 16px;
    height: 16px;
    object-fit: contain;
}
.emoji-fallback {
    font-size: 1rem;
    line-height: 1;
}
.count {
    font-variant-numeric: tabular-nums;
}
</style>
