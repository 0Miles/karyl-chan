<script setup lang="ts">
import { computed, ref } from 'vue';
import { useBreakpoint } from '../composables/use-breakpoint';
import { usePopover, type Placement } from '../composables/use-popover';
import { useDrawer, type DrawerPlacement } from '../composables/use-drawer';

/**
 * Viewport-aware popover:
 * - Desktop → popover anchored to the trigger via usePopover.
 * - Mobile  → bottom drawer via useDrawer. Backdrop + panel z-index
 *   raised to 2000/2001 so a popover opened from inside the mobile
 *   hamburger nav (which sits at 1001) still renders on top.
 *
 * Two ways to wire the trigger:
 *   1. `#trigger` slot — the slot is wrapped in a `display: contents`
 *      span so the wrapper doesn't affect the caller's layout. Clicks
 *      anywhere on the wrapped content toggle open/close.
 *   2. `referenceEl` prop — for cases where the trigger can't live
 *      inside this component (e.g., per-row react buttons in a list
 *      that share a single popover instance). No click wiring; the
 *      caller drives open state directly.
 *
 * If both are provided, `referenceEl` wins.
 *
 * Open state is `v-model:open`; if the caller doesn't bind, the
 * component manages it internally.
 */
const props = withDefaults(defineProps<{
    /** External reference element. Overrides the #trigger slot if set. */
    referenceEl?: HTMLElement | null;
    /** Controlled open state; two-way via v-model:open. Optional. */
    open?: boolean;
    placement?: Placement;
    offset?: [number, number];
    drawerPlacement?: DrawerPlacement;
    /** Optional heading rendered at the top of the mobile drawer. */
    drawerTitle?: string;
    closeOnClickOutside?: boolean;
    closeOnEscape?: boolean;
    /** Close after any click inside the content (menu items etc). */
    closeOnContentClick?: boolean;
    /** Make the desktop popover match the trigger's width. */
    sameWidth?: boolean;
}>(), {
    referenceEl: null,
    placement: 'bottom-start',
    offset: () => [0, 8],
    drawerPlacement: 'bottom',
    closeOnClickOutside: true,
    closeOnEscape: true,
    closeOnContentClick: false,
    sameWidth: false
});

const emit = defineEmits<{
    (e: 'update:open', value: boolean): void;
}>();

const { isMobile } = useBreakpoint();

const internalOpen = ref(false);
const isOpen = computed<boolean>({
    get: () => props.open ?? internalOpen.value,
    set: (v) => {
        internalOpen.value = v;
        emit('update:open', v);
    }
});

const triggerWrapRef = ref<HTMLElement | null>(null);
const contentEl = ref<HTMLElement | null>(null);

// Resolve the popover's anchor: caller's external prop wins; otherwise
// take the first real child of the slot wrapper. The wrapper itself uses
// display: contents, which means its getBoundingClientRect is unreliable
// (some browsers return zero) — reading firstElementChild gives Popper
// a real laid-out element to position against.
//
// Named `anchorRef` so it doesn't shadow the `referenceEl` prop in the
// template: `v-if="!referenceEl"` reads the prop, not this computed,
// which avoids a mount → unmount loop when the slot wrapper's presence
// feeds back into its own v-if condition.
const anchorRef = computed<HTMLElement | null>(() => {
    if (props.referenceEl) return props.referenceEl;
    const wrap = triggerWrapRef.value;
    if (!wrap) return null;
    return (wrap.firstElementChild as HTMLElement | null) ?? wrap;
});

// Visibility is purely derived: desktop popover shows iff we're open
// AND on a wide enough viewport (mobile switches to the drawer branch
// below). Keeping this a computed — rather than a ref with three sync
// watchers — means there's exactly one source of truth (`isOpen`) and
// `usePopover` just reflects it.
const popoverVisible = computed(() => !isMobile.value && isOpen.value);
const drawerVisible = computed(() => isMobile.value && isOpen.value);

usePopover(anchorRef, contentEl, {
    placement: props.placement,
    trigger: 'manual',
    offset: props.offset,
    teleportTo: 'body',
    visible: popoverVisible,
    closeOnClickOutside: props.closeOnClickOutside,
    closeOnEscape: props.closeOnEscape,
    closeOnContentClick: props.closeOnContentClick,
    sameWidth: props.sameWidth,
    // Surface self-close (click-outside / Escape / content click) back
    // onto `isOpen` so the caller's v-model observes it. We only flip
    // when `popoverVisible` is still truthy — the false branch means
    // we're already mid-close (caller set open=false, or a mobile
    // switch recomputed popoverVisible), and re-emitting would be
    // redundant at best and a cycle at worst.
    onHide: () => {
        if (popoverVisible.value) isOpen.value = false;
    }
});

const { placement: drawerPlace, backdropClass, panelClass, backdropTransition, panelTransition } = useDrawer({
    visible: drawerVisible,
    placement: props.drawerPlacement,
    closeOnEscape: props.closeOnEscape,
    onClose: () => { isOpen.value = false; }
});

function toggle() { isOpen.value = !isOpen.value; }
function open() { isOpen.value = true; }
function close() { isOpen.value = false; }
function onContentClick() {
    if (props.closeOnContentClick) close();
}
</script>

<template>
    <!-- Trigger wrapper. display: contents makes the span layout-invisible
         so the slot children sit directly in the caller's flex/grid flow.
         The span still exists in the event tree, so a click anywhere inside
         bubbles up and toggles the popover. Suppressed entirely when the
         caller supplies an external `referenceEl`. -->
    <span
        v-if="!referenceEl"
        ref="triggerWrapRef"
        class="app-popover-trigger"
        @click="toggle"
    >
        <slot name="trigger" :is-open="isOpen" :toggle="toggle" :open="open" :close="close" />
    </span>

    <!-- Desktop popover content. Always rendered so usePopover can bind on
         mount; visibility gated by popoverVisible. -->
    <div
        ref="contentEl"
        class="app-popover-content app-popover-content--hidden"
        @click="onContentClick"
    >
        <slot :close="close" :is-open="isOpen" />
    </div>

    <!-- Mobile drawer. -->
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
                    <slot :close="close" :is-open="isOpen" />
                </div>
            </div>
        </Transition>
    </Teleport>
</template>

<style scoped>
.app-popover-trigger {
    display: contents;
}
.app-popover-content {
    /* Above AppModal's backdrop (1500) — popovers opened from inside a
       modal (e.g. the forward picker's destination AppSelect) need to
       float above the modal's surface, not behind it. The mobile drawer
       branch below already sits at 2000/2001 for the same reason. */
    z-index: 1600;
}
.app-popover-content--hidden {
    display: none;
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
/* Drag-handle visual cue at the screen-touching edge — mirrors AppModal's
   bottom drawer so picker/menu drawers feel consistent with the rest of
   the mobile chrome. Only emitted for top/bottom placements; side
   drawers don't carry a handle. */
.app-popover-drawer-panel[data-placement="bottom"]::before,
.app-popover-drawer-panel[data-placement="top"]::after {
    content: '';
    display: block;
    width: 36px;
    height: 4px;
    border-radius: 2px;
    background: var(--text-muted);
    opacity: 0.35;
    flex-shrink: 0;
}
.app-popover-drawer-panel[data-placement="bottom"]::before {
    margin: 0.4rem auto 0;
}
.app-popover-drawer-panel[data-placement="top"] {
    border-top: none;
    border-bottom: 1px solid var(--border);
    border-radius: 0 0 12px 12px;
}
.app-popover-drawer-panel[data-placement="top"]::after {
    margin: 0 auto 0.4rem;
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
    /* Belt-and-braces: fixed-width content (e.g., MediaPicker's 420px
       picker) shouldn't ever force horizontal overflow past the drawer
       edge. Drawer panel already has overflow: hidden but body is the
       scrolling region. */
    overflow-x: hidden;
}
</style>
