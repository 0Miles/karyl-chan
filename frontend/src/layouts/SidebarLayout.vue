<script setup lang="ts">
import { computed } from 'vue';
import { useBreakpoint } from '../composables/use-breakpoint';
import { useFlushMain, useOverlayExtras } from '../composables/use-app-shell';

const props = withDefaults(defineProps<{
    /** Desktop sidebar width. Default: 280px. */
    sidebarWidth?: string;
    /** Force-disable the automatic full-bleed behavior on mobile. */
    flush?: boolean;
}>(), {
    sidebarWidth: '280px',
    flush: true
});

// Pages wrapped in this layout consume the full app-main viewport.
if (props.flush) useFlushMain();
useOverlayExtras();

const { isMobile } = useBreakpoint();

const gridStyle = computed(() =>
    isMobile.value ? undefined : { gridTemplateColumns: `${props.sidebarWidth} 1fr` }
);
</script>

<template>
    <section
        class="sidebar-layout"
        :class="{ 'sidebar-layout--mobile': isMobile }"
        :style="gridStyle"
    >
        <Teleport to="#mobile-nav-extras" :disabled="!isMobile">
            <aside class="sidebar">
                <slot name="sidebar" />
            </aside>
        </Teleport>
        <div class="main">
            <slot />
        </div>
    </section>
</template>

<style scoped>
.sidebar-layout {
    display: grid;
    grid-template-columns: 280px 1fr;
    height: 100%;
    min-height: 0;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg-surface);
    color: var(--text);
    overflow: hidden;
}
.sidebar-layout--mobile {
    grid-template-columns: 1fr !important;
    border: none;
    border-radius: 0;
}
.sidebar {
    border-right: 1px solid var(--border);
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    min-height: 0;
    height: 100%;
    background: var(--bg-surface);
}
.sidebar-layout--mobile .sidebar {
    border-right: none;
    flex: 1;
    min-height: 0;
}
.main {
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
}
</style>
