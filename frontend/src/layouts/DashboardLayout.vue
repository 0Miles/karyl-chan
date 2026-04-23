<script setup lang="ts">
defineProps<{
    /** Optional title rendered in the default header slot. */
    title?: string;
    /** Narrow column width for reading-focused pages. Default: unbounded. */
    maxWidth?: string;
}>();
</script>

<template>
    <section class="dashboard-layout" :style="maxWidth ? { maxWidth, margin: '0 auto' } : undefined">
        <header v-if="title || $slots.header || $slots.actions" class="page-header">
            <div class="heading">
                <slot name="header">
                    <h1 v-if="title">{{ title }}</h1>
                </slot>
            </div>
            <div v-if="$slots.actions" class="actions">
                <slot name="actions" />
            </div>
        </header>
        <div class="content">
            <slot />
        </div>
    </section>
</template>

<style scoped>
.dashboard-layout {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    min-height: 0;
}
.page-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    flex-wrap: wrap;
}
.heading :deep(h1) {
    margin: 0;
    font-size: 1.25rem;
}
.actions {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;
}
.content {
    min-height: 0;
}

@media (max-width: 768px) {
    .dashboard-layout { gap: 0.75rem; }
    .page-header { gap: 0.5rem; }
}
</style>
