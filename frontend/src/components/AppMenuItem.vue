<script setup lang="ts">
defineProps<{
    disabled?: boolean;
    /** If true, the item is rendered with danger styling (e.g., sign out). */
    danger?: boolean;
}>();
</script>

<template>
    <button
        type="button"
        role="menuitem"
        :class="['app-menu-item', { 'is-danger': danger }]"
        :disabled="disabled"
    >
        <slot />
    </button>
</template>

<style scoped>
.app-menu-item {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.85rem;
    background: none;
    border: none;
    color: var(--text);
    font: inherit;
    font-size: 0.9rem;
    text-align: left;
    cursor: pointer;
}
.app-menu-item:hover:not(:disabled) {
    background: var(--bg-surface-hover);
}
.app-menu-item:disabled {
    opacity: 0.5;
    cursor: default;
}
.app-menu-item.is-danger { color: var(--danger); }
</style>
