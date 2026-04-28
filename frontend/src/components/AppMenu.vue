<script setup lang="ts">
import { computed, ref } from 'vue';
import { useBreakpoint } from '../composables/use-breakpoint';
import { usePopover, type Placement } from '../composables/use-popover';
import { useDrawer } from '../composables/use-drawer';

/**
 * Viewport-aware menu:
 * - Desktop → popover anchored to the trigger via usePopover.
 * - Mobile  → bottom drawer (mirrors AppPopover so menu surfaces
 *   feel consistent with picker / popover surfaces on touch).
 *
 * The trigger slot is wrapped in a click-bubbling `display: contents`
 * span so the wrapper doesn't affect the caller's layout. Clicking
 * any AppMenuItem inside the default slot closes the menu when
 * `closeOnItemClick` is true (the default — same as the original
 * desktop-only AppMenu it replaces).
 */
const props = withDefaults(defineProps<{
    placement?: Placement;
    /** Distance [skidding, distance] between trigger and menu. Default: [0, 8]. */
    offset?: [number, number];
    /** Close after the user clicks any item inside the menu. Default: true. */
    closeOnItemClick?: boolean;
    /** Optional heading rendered at the top of the mobile drawer. */
    drawerTitle?: string;
}>(), {
    placement: 'bottom-end',
    closeOnItemClick: true
});

const { isMobile } = useBreakpoint();

const isOpen = ref(false);
function toggle() { isOpen.value = !isOpen.value; }
function close() { isOpen.value = false; }

const triggerWrapRef = ref<HTMLElement | null>(null);
const contentEl = ref<HTMLElement | null>(null);

// Anchor the desktop popover against the slot's first real child —
// the wrapper itself uses display: contents and has no usable layout
// rectangle in some browsers. Same trick AppPopover plays.
const anchorRef = computed<HTMLElement | null>(() => {
    const wrap = triggerWrapRef.value;
    if (!wrap) return null;
    return (wrap.firstElementChild as HTMLElement | null) ?? wrap;
});

const popoverVisible = computed(() => !isMobile.value && isOpen.value);
const drawerVisible = computed(() => isMobile.value && isOpen.value);

usePopover(anchorRef, contentEl, {
    placement: props.placement,
    trigger: 'manual',
    offset: props.offset ?? [0, 8],
    teleportTo: 'body',
    visible: popoverVisible,
    closeOnClickOutside: true,
    closeOnEscape: true,
    closeOnContentClick: props.closeOnItemClick,
    onHide: () => {
        // Mirror self-close (Escape / click-outside / item-click) back
        // onto the local open ref. Guard against the false branch
        // firing during a mobile/desktop swap, which would otherwise
        // recurse the close.
        if (popoverVisible.value) close();
    }
});

const { backdropClass, panelClass, backdropTransition, panelTransition } = useDrawer({
    visible: drawerVisible,
    placement: 'bottom',
    closeOnEscape: true,
    onClose: close
});

function onContentClick() {
    if (props.closeOnItemClick) close();
}
</script>

<template>
    <span
        ref="triggerWrapRef"
        class="app-menu-trigger"
        @click="toggle"
    >
        <slot name="trigger" :is-open="isOpen" :toggle="toggle" :close="close" />
    </span>

    <!-- Desktop popover content. Always rendered so usePopover binds on
         mount; visibility gated by popoverVisible. -->
    <div
        ref="contentEl"
        class="app-menu"
        role="menu"
        style="display: none"
        @click="onContentClick"
    >
        <slot :close="close" :is-open="isOpen" />
    </div>

    <!-- Mobile drawer branch — slides up from the bottom edge,
         matches AppPopover's drawer chrome. z-index sits above
         AppModal (1500) so a menu opened from inside a modal still
         floats on top. -->
    <Teleport v-if="isMobile" to="body">
        <Transition :name="backdropTransition">
            <div
                v-if="drawerVisible"
                :class="[backdropClass, 'app-menu-drawer-backdrop']"
                :style="{ zIndex: 2000 }"
                @click="close"
            />
        </Transition>
        <Transition :name="panelTransition">
            <div
                v-if="drawerVisible"
                :class="[panelClass, 'app-menu-drawer-panel']"
                data-placement="bottom"
                :style="{ zIndex: 2001 }"
                role="menu"
                aria-modal="true"
                @click="onContentClick"
            >
                <header v-if="drawerTitle" class="app-menu-drawer-title">{{ drawerTitle }}</header>
                <div class="app-menu-drawer-body">
                    <slot :close="close" :is-open="isOpen" />
                </div>
            </div>
        </Transition>
    </Teleport>
</template>

<style scoped>
.app-menu-trigger {
    display: contents;
    cursor: pointer;
}
.app-menu {
    min-width: 180px;
    padding: 0.3rem 0;
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-base);
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
    z-index: 1600;
}
.app-menu-drawer-panel {
    max-height: 70vh;
    background: var(--bg-surface);
    border-top: 1px solid var(--border);
    border-radius: 12px 12px 0 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    padding-bottom: env(safe-area-inset-bottom, 0px);
}
.app-menu-drawer-panel::before {
    content: '';
    display: block;
    width: 36px;
    height: 4px;
    border-radius: 2px;
    background: var(--text-muted);
    opacity: 0.35;
    margin: 0.4rem auto 0;
    flex-shrink: 0;
}
.app-menu-drawer-title {
    padding: 0.6rem 1rem 0.5rem;
    font-weight: 600;
    font-size: 0.95rem;
    color: var(--text-strong);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
}
.app-menu-drawer-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 0.3rem 0;
}
/* Bump menu items inside the mobile drawer to a comfortable touch
   target — the desktop popover already has acceptable spacing for
   pointer use, but cramped rows on a touchscreen are easy to misfire. */
.app-menu-drawer-body :deep(.app-menu-item) {
    padding: 0.85rem 1rem;
    font-size: 1rem;
    min-height: 48px;
}
</style>
