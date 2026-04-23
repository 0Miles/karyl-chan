<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { usePopover, type Placement } from '../../../composables/use-popover';
import { useBreakpoint } from '../../../composables/use-breakpoint';
import MediaPicker, { type MediaSelection } from './MediaPicker.vue';

const props = defineProps<{
    /** The element the popover anchors to (typically a `<button>` ref). */
    referenceEl: HTMLElement | null;
    /** v-model:visible — true to open, false to close. */
    visible: boolean;
    placement?: Placement;
    /** Distance offset from the reference, [skidding, distance]. */
    offset?: [number, number];
}>();

const emit = defineEmits<{
    (e: 'select', selection: MediaSelection): void;
    (e: 'update:visible', value: boolean): void;
}>();

const { isMobile } = useBreakpoint();

const contentEl = ref<HTMLElement | null>(null);
const referenceRef = computed(() => props.referenceEl);

// Desktop popover visibility: on mobile we suppress it so usePopover never
// positions the element, and the drawer takes over instead.
const popoverVisible = ref(false);
watch(() => props.visible, (v) => { popoverVisible.value = isMobile.value ? false : v; });
watch(isMobile, (mobile) => { if (mobile) popoverVisible.value = false; });
watch(popoverVisible, (v) => { if (v !== props.visible) emit('update:visible', v); });

// Mobile drawer visibility.
const drawerVisible = computed(() => isMobile.value && props.visible);

usePopover(referenceRef, contentEl, {
    placement: props.placement ?? 'top-end',
    trigger: 'manual',
    offset: props.offset ?? [0, 8],
    teleportTo: 'body',
    visible: popoverVisible,
    closeOnClickOutside: true,
    closeOnEscape: true
});
</script>

<template>
    <!-- Desktop: standard popover managed by usePopover. -->
    <div ref="contentEl" class="media-picker-popover" style="display: none">
        <MediaPicker v-if="!isMobile" @select="(s) => emit('select', s)" />
    </div>

    <!-- Mobile: full-width bottom drawer. Teleported to body so it never
         contributes to any parent's scroll width. -->
    <Teleport to="body">
        <Transition name="picker-fade">
            <div
                v-if="drawerVisible"
                class="drawer-backdrop"
                @click="emit('update:visible', false)"
            />
        </Transition>
        <Transition name="picker-slide-up">
            <div
                v-if="drawerVisible"
                class="drawer-panel"
                role="dialog"
                aria-modal="true"
            >
                <div class="drawer-handle" aria-hidden="true" />
                <MediaPicker @select="(s) => emit('select', s)" />
            </div>
        </Transition>
    </Teleport>
</template>

<style scoped>
.media-picker-popover { z-index: 1000; }

/* ── Mobile drawer ─────────────────────────────────────────────────────── */
.drawer-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    z-index: 1000;
}
.drawer-panel {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    z-index: 1001;
    background: var(--bg-surface);
    border-top: 1px solid var(--border);
    border-radius: 12px 12px 0 0;
    max-height: 70vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
}
.drawer-handle {
    width: 36px;
    height: 4px;
    background: var(--border);
    border-radius: 2px;
    margin: 10px auto 4px;
    flex-shrink: 0;
}

/* Backdrop fade */
.picker-fade-enter-active,
.picker-fade-leave-active { transition: opacity 0.2s; }
.picker-fade-enter-from,
.picker-fade-leave-to { opacity: 0; }

/* Drawer slide-up */
.picker-slide-up-enter-active,
.picker-slide-up-leave-active { transition: transform 0.22s cubic-bezier(0.4, 0, 0.2, 1); }
.picker-slide-up-enter-from,
.picker-slide-up-leave-to { transform: translateY(100%); }
</style>
