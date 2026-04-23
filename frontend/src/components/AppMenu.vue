<script setup lang="ts">
import { ref } from 'vue';
import { usePopover, type Placement } from '../composables/use-popover';

const props = withDefaults(defineProps<{
    placement?: Placement;
    /** Distance [skidding, distance] between trigger and menu. Default: [0, 8]. */
    offset?: [number, number];
    /** Close after the user clicks any item inside the menu. Default: true. */
    closeOnItemClick?: boolean;
}>(), {
    placement: 'bottom-end',
    closeOnItemClick: true
});

const triggerEl = ref<HTMLElement | null>(null);
const contentEl = ref<HTMLElement | null>(null);

usePopover(triggerEl, contentEl, {
    placement: props.placement,
    trigger: 'click',
    offset: props.offset ?? [0, 8],
    teleportTo: 'body',
    closeOnClickOutside: true,
    closeOnEscape: true,
    closeOnContentClick: props.closeOnItemClick
});
</script>

<template>
    <!-- Wraps the trigger so usePopover can attach a click handler to a
         real DOM node without forcing the caller to expose one. -->
    <span ref="triggerEl" class="app-menu-trigger">
        <slot name="trigger" />
    </span>
    <div
        ref="contentEl"
        class="app-menu"
        role="menu"
        style="display: none"
    >
        <slot />
    </div>
</template>

<style scoped>
.app-menu-trigger {
    display: inline-flex;
    cursor: pointer;
}
.app-menu {
    min-width: 180px;
    padding: 0.3rem 0;
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: 6px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
    z-index: 1000;
}
</style>
