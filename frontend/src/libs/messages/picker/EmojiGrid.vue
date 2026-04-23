<script setup lang="ts">
export interface EmojiCell {
    key: string;
    title: string;
    /** When set, renders an `<img>`; otherwise renders the unicode glyph. */
    imageUrl?: string | null;
    glyph?: string | null;
}

defineProps<{
    cells: EmojiCell[];
}>();

const emit = defineEmits<{
    (e: 'pick', key: string): void;
}>();
</script>

<template>
    <div class="emoji-grid">
        <button
            v-for="cell in cells"
            :key="cell.key"
            type="button"
            class="cell"
            :title="cell.title"
            @click="emit('pick', cell.key)"
        >
            <img v-if="cell.imageUrl" :src="cell.imageUrl" :alt="cell.title" class="emoji" />
            <span v-else class="unicode">{{ cell.glyph }}</span>
        </button>
    </div>
</template>

<style scoped>
.emoji-grid {
    display: grid;
    grid-template-columns: repeat(8, 1fr);
    gap: 0.3rem;
}
.cell {
    background: none;
    border: 1px solid transparent;
    border-radius: 4px;
    padding: 4px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    aspect-ratio: 1 / 1;
}
.cell:hover { background: var(--bg-surface-hover); }
.emoji {
    width: 28px;
    height: 28px;
    object-fit: contain;
}
.unicode {
    font-size: 1.5rem;
    line-height: 1;
}
</style>
