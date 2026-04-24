<script setup lang="ts">
import type { ComposerSuggestionItem } from './types';

defineProps<{
    items: ComposerSuggestionItem[];
    activeIndex: number;
    /** Optional label shown at the top of the menu (e.g. "MEMBERS MATCHING bob"). */
    title?: string | null;
}>();

const emit = defineEmits<{
    (e: 'select', key: string): void;
    (e: 'hover', index: number): void;
}>();
</script>

<template>
    <div v-if="items.length" class="suggestions">
        <header v-if="title" class="title">{{ title }}</header>
        <button
            v-for="(item, idx) in items"
            :key="item.key"
            type="button"
            :class="['item', { active: idx === activeIndex }]"
            @mousedown.prevent="emit('select', item.key)"
            @mouseenter="emit('hover', idx)"
        >
            <img v-if="item.iconUrl" :src="item.iconUrl" alt="" class="icon" />
            <span class="label" :style="item.color ? { color: item.color } : undefined">{{ item.label }}</span>
            <span v-if="item.secondary" class="secondary">{{ item.secondary }}</span>
        </button>
    </div>
</template>

<style scoped>
.suggestions {
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: 6px;
    box-shadow: 0 -4px 14px rgba(0, 0, 0, 0.12);
    max-height: 240px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
}
.title {
    padding: 0.4rem 0.6rem;
    font-size: 0.7rem;
    color: var(--text-muted);
    border-bottom: 1px solid var(--border);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    flex-shrink: 0;
}
.item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.4rem 0.6rem;
    background: none;
    border: none;
    cursor: pointer;
    color: var(--text);
    text-align: left;
    font: inherit;
}
.item:hover {
    background: var(--bg-surface-hover);
}
.item.active {
    background: var(--accent-bg);
    color: var(--accent-text-strong);
}
.icon {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    object-fit: cover;
    flex-shrink: 0;
}
.label {
    font-weight: 500;
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.secondary {
    color: var(--text-muted);
    font-size: 0.85rem;
}
</style>
