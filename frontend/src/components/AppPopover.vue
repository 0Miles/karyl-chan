<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useBreakpoint } from '../composables/use-breakpoint';
import { usePopover, type Placement } from '../composables/use-popover';
import { useDrawer, type DrawerPlacement } from '../composables/use-drawer';

/**
 * Viewport-aware popover controlled by an external reference element.
 * Mirrors AppSelect's desktop/mobile split but doesn't bake in a
 * trigger — callers own the button and drive open state via v-model:open.
 *
 * - Desktop → popover anchored to `referenceEl` via usePopover.
 * - Mobile  → bottom drawer via useDrawer. Backdrop + panel get a
 *   raised z-index so nested popovers (e.g., a picker opened from the
 *   hamburger nav) render on top of the app-shell drawer at 1001.
 *
 * Usage:
 *   <button ref="triggerEl" @click="open = !open">…</button>
 *   <AppPopover :reference-el="triggerEl" v-model:open="open">
 *       …content…
 *   </AppPopover>
 */
const props = withDefaults(defineProps<{
    /** Element the desktop popover anchors to. Ignored in drawer mode. */
    referenceEl: HTMLElement | null;
    /** Controlled open state; two-way via v-model:open. */
    open: boolean;
    placement?: Placement;
    /** [skidding, distance] from the reference (desktop popover only). */
    offset?: [number, number];
    drawerPlacement?: DrawerPlacement;
    /** Optional title rendered at the top of the mobile drawer. */
    drawerTitle?: string;
    closeOnClickOutside?: boolean;
    closeOnEscape?: boolean;
    /** Close after any click inside the content (menu items etc). */
    closeOnContentClick?: boolean;
}>(), {
    placement: 'bottom-start',
    offset: () => [0, 8],
    drawerPlacement: 'bottom',
    closeOnClickOutside: true,
    closeOnEscape: true,
    closeOnContentClick: false
});

const emit = defineEmits<{
    (e: 'update:open', value: boolean): void;
}>();

const { isMobile } = useBreakpoint();

const contentEl = ref<HTMLElement | null>(null);
// Wrap the prop so usePopover's internal watcher reruns when callers
// swap the reference (e.g., a per-row button that remounts on edit).
const referenceRef = computed(() => props.referenceEl);

// Desktop popover visibility — ref (not computed) because usePopover
// toggles it itself on self-close (Escape / click-outside) and we need
// to surface that back to the caller via update:open.
const popoverVisible = ref(false);
watch(() => props.open, (v) => { popoverVisible.value = !isMobile.value && v; });
watch(isMobile, (mobile) => {
    popoverVisible.value = !mobile && props.open;
});
watch(popoverVisible, (v) => {
    // Only fire when the popover genuinely transitioned — caller already
    // knows about its own state changes.
    const expected = !isMobile.value && props.open;
    if (v !== expected) emit('update:open', v);
});

// Mobile drawer visibility — computed, onClose handles the transition
// back to the caller's state.
const drawerVisible = computed(() => isMobile.value && props.open);

usePopover(referenceRef, contentEl, {
    placement: props.placement,
    trigger: 'manual',
    offset: props.offset,
    teleportTo: 'body',
    visible: popoverVisible,
    closeOnClickOutside: props.closeOnClickOutside,
    closeOnEscape: props.closeOnEscape,
    closeOnContentClick: props.closeOnContentClick
});

const { placement: drawerPlace, backdropClass, panelClass, backdropTransition, panelTransition } = useDrawer({
    visible: drawerVisible,
    placement: props.drawerPlacement,
    closeOnEscape: props.closeOnEscape,
    onClose: () => emit('update:open', false)
});

function close() { emit('update:open', false); }
function onContentClick() {
    if (props.closeOnContentClick) close();
}
</script>

<template>
    <!-- Desktop popover content. Always rendered so usePopover finds a
         stable ref on mount; invisible on mobile because popoverVisible
         stays false there. That means the slot mounts once on mobile too
         (next to the trigger, display: none) — acceptable for the two
         menu-shaped consumers we have today. -->
    <div
        ref="contentEl"
        class="app-popover-content"
        style="display: none"
        @click="onContentClick"
    >
        <slot />
    </div>

    <!-- Mobile drawer. z-index is raised above any parent drawer the
         content might have been opened from (e.g., the hamburger nav at
         1001). -->
    <Teleport v-if="isMobile" to="body">
        <Transition :name="backdropTransition">
            <div
                v-if="drawerVisible"
                :class="[backdropClass, 'app-popover-drawer-backdrop']"
                :style="{ zIndex: 2000 }"
                @click="close"
            />
        </Transition>
        <Transition :name="panelTransition">
            <div
                v-if="drawerVisible"
                :class="[panelClass, 'app-popover-drawer-panel']"
                :data-placement="drawerPlace"
                :style="{ zIndex: 2001 }"
                role="dialog"
                aria-modal="true"
                @click="onContentClick"
            >
                <header v-if="drawerTitle" class="app-popover-drawer-title">{{ drawerTitle }}</header>
                <div class="app-popover-drawer-body">
                    <slot />
                </div>
            </div>
        </Transition>
    </Teleport>
</template>

<style scoped>
.app-popover-content {
    z-index: 1000;
}
.app-popover-drawer-panel {
    max-height: 70vh;
    background: var(--bg-surface);
    border-top: 1px solid var(--border);
    border-radius: 12px 12px 0 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
}
.app-popover-drawer-panel[data-placement="top"] {
    border-top: none;
    border-bottom: 1px solid var(--border);
    border-radius: 0 0 12px 12px;
}
.app-popover-drawer-panel[data-placement="left"],
.app-popover-drawer-panel[data-placement="right"] {
    max-height: 100vh;
    border-top: none;
    border-radius: 0;
    max-width: 85vw;
    width: 360px;
}
.app-popover-drawer-title {
    padding: 0.75rem 1rem;
    font-weight: 600;
    font-size: 0.95rem;
    color: var(--text-strong);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
}
.app-popover-drawer-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
}
</style>
