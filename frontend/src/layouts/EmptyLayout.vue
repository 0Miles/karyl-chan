<script setup lang="ts">
defineProps<{
    /** Optional reading-width cap. Default: unbounded. */
    maxWidth?: string;
}>();
</script>

<template>
    <section class="empty-layout" :style="maxWidth ? { maxWidth, margin: '0 auto' } : undefined">
        <slot />
    </section>
</template>

<style scoped>
.empty-layout {
    display: flex;
    flex-direction: column;
    min-height: 0;
}
</style>
