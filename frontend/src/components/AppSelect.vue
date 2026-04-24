<script setup lang="ts">
import { computed, ref } from 'vue';
import { useBreakpoint } from '../composables/use-breakpoint';
import { usePopover, type Placement } from '../composables/use-popover';
import { useDrawer, type DrawerPlacement } from '../composables/use-drawer';

/**
 * Generic dropdown menu that adapts to viewport:
 * - Desktop → popover anchored to the trigger (via usePopover)
 * - Mobile  → bottom drawer (via useDrawer) with a z-index raised above
 *   the app-shell hamburger drawer, so nested selects still render on top.
 *
 * Usage:
 *   <AppSelect v-model:open="isOpen">
 *       <template #trigger="{ isOpen: open, toggle }">
 *           <button @click="toggle">…</button>
 *       </template>
 *       <!-- default slot = menu content -->
 *       <ul>…</ul>
 *   </AppSelect>
 */
const props = withDefaults(defineProps<{
    /** External open-state binding. Optional — the component manages internal state if omitted. */
    open?: boolean;
    /** Desktop popover placement. Default: bottom-start. */
    placement?: Placement;
    /** Mobile drawer placement. Default: bottom. */
    drawerPlacement?: DrawerPlacement;
    /** Mobile drawer heading; renders above the content. */
    drawerTitle?: string;
    /** Close the popover/drawer after a click inside the content. Default: true. */
    closeOnContentClick?: boolean;
}>(), {
    placement: 'bottom-start',
    drawerPlacement: 'bottom',
    closeOnContentClick: true
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

const triggerRef = ref<HTMLElement | null>(null);
// The popover content element lives in the DOM unconditionally so
// usePopover's onMounted hook finds something to bind. The visibleRef
// below stays false on mobile so show() never fires and the content
// stays put (display: none) next to the trigger instead of teleporting.
const popoverContentRef = ref<HTMLElement | null>(null);

const popoverVisible = computed(() => !isMobile.value && isOpen.value);
const drawerVisible = computed(() => isMobile.value && isOpen.value);

usePopover(triggerRef, popoverContentRef, {
    placement: props.placement,
    trigger: 'manual',
    offset: [0, 8],
    teleportTo: 'body',
    visible: popoverVisible,
    closeOnClickOutside: true,
    closeOnEscape: true,
    closeOnContentClick: props.closeOnContentClick
});

const { placement: drawerPlace, backdropClass, panelClass, backdropTransition, panelTransition } = useDrawer({
    visible: drawerVisible,
    placement: props.drawerPlacement,
    onClose: () => { isOpen.value = false; }
});

function toggle() {
    isOpen.value = !isOpen.value;
}

function close() {
    isOpen.value = false;
}

function onContentClick() {
    if (props.closeOnContentClick) close();
}
</script>

<template>
    <span ref="triggerRef" class="app-select-trigger">
        <slot name="trigger" :is-open="isOpen" :toggle="toggle" />
    </span>

    <!-- Desktop popover content. Always in DOM so usePopover can bind on
         mount; visibility gated by the computed popoverVisible. -->
    <div
        ref="popoverContentRef"
        class="app-select-popover"
        style="display: none"
        @click="onContentClick"
    >
        <slot :close="close" :is-open="isOpen" />
    </div>

    <!-- Mobile drawer. Raised z-index so nested selects stay on top of a
         parent drawer (e.g., the mobile nav shell at z-index 1001). -->
    <Teleport v-if="isMobile" to="body">
        <Transition :name="backdropTransition">
            <div
                v-if="drawerVisible"
                :class="[backdropClass, 'app-select-drawer-backdrop']"
                :style="{ zIndex: 2000 }"
                @click="close"
            />
        </Transition>
        <Transition :name="panelTransition">
            <div
                v-if="drawerVisible"
                :class="[panelClass, 'app-select-drawer-panel']"
                :data-placement="drawerPlace"
                :style="{ zIndex: 2001 }"
                role="dialog"
                aria-modal="true"
                @click="onContentClick"
            >
                <header v-if="drawerTitle" class="app-select-drawer-title">
                    {{ drawerTitle }}
                </header>
                <div class="app-select-drawer-body">
                    <slot :close="close" :is-open="isOpen" />
                </div>
            </div>
        </Transition>
    </Teleport>
</template>

<style scoped>
.app-select-trigger {
    display: inline-flex;
    /* Fit the parent so trigger slots that want width: 100% can stretch.
       min-width: 0 lets ellipsis work for child labels. */
    min-width: 0;
}
.app-select-popover {
    min-width: 180px;
    padding: 0.25rem 0;
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: 6px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
    z-index: 1000;
}
.app-select-drawer-panel {
    max-height: 70vh;
    background: var(--bg-surface);
    border-top: 1px solid var(--border);
    border-radius: 12px 12px 0 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
}
.app-select-drawer-panel[data-placement="top"] {
    border-top: none;
    border-bottom: 1px solid var(--border);
    border-radius: 0 0 12px 12px;
}
.app-select-drawer-title {
    padding: 0.75rem 1rem;
    font-weight: 600;
    font-size: 0.95rem;
    color: var(--text-strong);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
}
.app-select-drawer-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
}
</style>
