<script setup lang="ts">
export interface StickerCell {
    key: string;
    title: string;
    imageUrl: string;
}

defineProps<{
    cells: StickerCell[];
}>();

const emit = defineEmits<{
    (e: 'pick', key: string, event: MouseEvent): void;
}>();
</script>

<template>
    <div class="sticker-grid">
        <button
            v-for="cell in cells"
            :key="cell.key"
            type="button"
            class="cell"
            :title="cell.title"
            @click="emit('pick', cell.key, $event)"
        >
            <img :src="cell.imageUrl" :alt="cell.title" class="sticker" />
        </button>
    </div>
</template>

<style scoped>
.sticker-grid {
    /* auto-fill so the grid wraps to whatever container width it gets;
       a fixed column count would force horizontal overflow when the
       container is narrower than 4×min-sticker-width (e.g. inside the
       mobile drawer). */
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(72px, 1fr));
    gap: 0.3rem;
}
.cell {
    background: none;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    padding: 4px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    aspect-ratio: 1 / 1;
    min-width: 0;
}
.cell:hover {
    background: var(--bg-surface-hover);
    border-color: var(--border);
}
.sticker {
    width: 100%;
    height: 100%;
    object-fit: contain;
}
</style>
