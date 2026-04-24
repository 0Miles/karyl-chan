<script setup lang="ts">
import { computed, ref } from 'vue';
import AppPopover from './AppPopover.vue';
import type { Placement } from '../composables/use-popover';
import type { DrawerPlacement } from '../composables/use-drawer';

/**
 * Dropdown-select layer on top of AppPopover. Same viewport split
 * (popover desktop / drawer mobile) and the same trigger-slot + isOpen
 * control surface, plus:
 * - A styled content wrapper (surface background, border, shadow) so
 *   the dropdown doesn't render transparent.
 * - `sameWidth` defaults to true so the menu matches the trigger's
 *   width, which is the usual expectation for a <select>-style picker.
 * - Closes on item click by default.
 *
 * AppPopover stays the underlying primitive for cases where the caller
 * wants to style the content themselves (e.g., MediaPicker with its
 * own surface) or doesn't want the same-width behavior.
 */
const props = withDefaults(defineProps<{
    open?: boolean;
    placement?: Placement;
    drawerPlacement?: DrawerPlacement;
    drawerTitle?: string;
    /** Close the dropdown after any click inside the menu. Default: true. */
    closeOnItemClick?: boolean;
    /** Make the popup width match the trigger's width. Default: true. */
    sameWidth?: boolean;
}>(), {
    placement: 'bottom-start',
    drawerPlacement: 'bottom',
    closeOnItemClick: true,
    sameWidth: true
});

const emit = defineEmits<{
    (e: 'update:open', value: boolean): void;
}>();

const internalOpen = ref(false);
const isOpen = computed<boolean>({
    get: () => props.open ?? internalOpen.value,
    set: (v) => {
        internalOpen.value = v;
        emit('update:open', v);
    }
});

function close() { isOpen.value = false; }
</script>

<template>
    <AppPopover
        v-model:open="isOpen"
        :placement="placement"
        :drawer-placement="drawerPlacement"
        :drawer-title="drawerTitle"
        :close-on-content-click="closeOnItemClick"
        :same-width="sameWidth"
    >
        <template #trigger="{ isOpen: open, toggle }">
            <slot name="trigger" :is-open="open" :toggle="toggle" />
        </template>
        <div class="app-select-dropdown">
            <slot :close="close" :is-open="isOpen" />
        </div>
    </AppPopover>
</template>

<style scoped>
.app-select-dropdown {
    min-width: 180px;
    padding: 0.25rem 0;
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: 6px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
    color: var(--text);
    /* On mobile the dropdown renders inside AppPopover's drawer body
       (which already provides its own surface). Flatten the local
       chrome there so we don't double-box it. */
}
@media (max-width: 768px) {
    .app-select-dropdown {
        min-width: 0;
        padding: 0;
        background: transparent;
        border: none;
        border-radius: 0;
        box-shadow: none;
    }
}
</style>
