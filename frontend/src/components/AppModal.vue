<script setup lang="ts">
import { computed, onMounted, onUnmounted, toRef, useId } from 'vue';
import { Icon } from '@iconify/vue';
import { useBreakpoint } from '../composables/use-breakpoint';
import { useDrawer } from '../composables/use-drawer';

/**
 * Viewport-aware modal:
 * - Desktop → centered card with a translucent backdrop, fade transition.
 * - Mobile  → bottom drawer using the shared `useDrawer` styles, slide-up
 *   transition, drag-handle visual cue, safe-area inset.
 *
 * The caller owns everything inside the slot — typical usage is to drop
 * a `<form @submit.prevent>` containing fields + an actions footer
 * directly into the default slot. AppModal supplies the chrome (backdrop,
 * panel, optional title header, close button) only.
 *
 * `closeOnBackdrop` / `closeOnEscape` default to true. Escape closure on
 * desktop is wired locally; on mobile it's handled by useDrawer's escape
 * stack. Backdrop click emits `close` either way.
 */
const props = withDefaults(defineProps<{
    visible: boolean;
    /** Heading rendered in the panel's header. Hidden when blank. */
    title?: string;
    closeOnBackdrop?: boolean;
    closeOnEscape?: boolean;
    /** Width of the desktop panel; mobile drawer ignores this. */
    width?: string;
}>(), {
    title: '',
    closeOnBackdrop: true,
    closeOnEscape: true,
    width: 'min(440px, 92vw)'
});

const emit = defineEmits<{
    (e: 'close'): void;
}>();

const { isMobile } = useBreakpoint();
const visibleRef = toRef(props, 'visible');
const desktopVisible = computed(() => props.visible && !isMobile.value);
const drawerVisible = computed(() => props.visible && isMobile.value);

const titleId = useId();

// Desktop Escape handler — useDrawer already covers the mobile branch
// via its escape stack, so we only listen when the popover branch is
// active. Listening unconditionally would let a single Escape close two
// stacked drawers (e.g. user-context-menu drawer over a modal drawer).
function onWindowKey(event: KeyboardEvent) {
    if (!visibleRef.value || !props.closeOnEscape || isMobile.value) return;
    if (event.key === 'Escape') {
        event.preventDefault();
        emit('close');
    }
}
onMounted(() => window.addEventListener('keydown', onWindowKey));
onUnmounted(() => window.removeEventListener('keydown', onWindowKey));

const { backdropClass, panelClass, backdropTransition, panelTransition } = useDrawer({
    visible: drawerVisible,
    placement: 'bottom',
    closeOnEscape: props.closeOnEscape,
    onClose: () => emit('close')
});

function onBackdropClick() {
    if (props.closeOnBackdrop) emit('close');
}
</script>

<template>
    <Teleport to="body">
        <!-- Desktop branch — centered card. -->
        <Transition name="app-modal-fade">
            <div
                v-if="desktopVisible"
                class="app-modal-backdrop"
                @click.self="onBackdropClick"
            >
                <div
                    class="app-modal-panel"
                    role="dialog"
                    aria-modal="true"
                    :style="{ width }"
                    :aria-labelledby="title || $slots.header ? titleId : undefined"
                    :aria-label="title || $slots.header ? undefined : title || undefined"
                >
                    <header v-if="title || $slots.header" class="app-modal-head">
                        <span :id="titleId" class="app-modal-title">
                            <slot name="header">{{ title }}</slot>
                        </span>
                        <button
                            type="button"
                            class="app-modal-close"
                            :aria-label="'Close'"
                            @click="emit('close')"
                        >
                            <Icon icon="material-symbols:close-rounded" width="18" height="18" />
                        </button>
                    </header>
                    <div class="app-modal-body">
                        <slot />
                    </div>
                </div>
            </div>
        </Transition>
    </Teleport>

    <!-- Mobile drawer branch — slides up from the bottom edge. -->
    <Teleport to="body">
        <Transition :name="backdropTransition">
            <div
                v-if="drawerVisible"
                :class="[backdropClass, 'app-modal-drawer-backdrop']"
                @click="onBackdropClick"
            />
        </Transition>
        <Transition :name="panelTransition">
            <div
                v-if="drawerVisible"
                :class="[panelClass, 'app-modal-drawer-panel']"
                data-placement="bottom"
                role="dialog"
                aria-modal="true"
                :aria-labelledby="title || $slots.header ? titleId : undefined"
                :aria-label="title || $slots.header ? undefined : title || undefined"
            >
                <header v-if="title || $slots.header" class="app-modal-drawer-head">
                    <span :id="titleId" class="app-modal-title">
                        <slot name="header">{{ title }}</slot>
                    </span>
                    <button
                        type="button"
                        class="app-modal-close"
                        :aria-label="'Close'"
                        @click="emit('close')"
                    >
                        <Icon icon="material-symbols:close-rounded" width="18" height="18" />
                    </button>
                </header>
                <div class="app-modal-drawer-body">
                    <slot />
                </div>
            </div>
        </Transition>
    </Teleport>
</template>

<style scoped>
/* ── Desktop ────────────────────────────────────────────────────── */
.app-modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1500;
}
.app-modal-panel {
    max-height: 88vh;
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    box-shadow: 0 12px 36px rgba(0, 0, 0, 0.32);
    display: flex;
    flex-direction: column;
    overflow: hidden;
}
.app-modal-head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.6rem 0.9rem;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
}
.app-modal-title {
    flex: 1;
    font-weight: 600;
    color: var(--text-strong);
}
.app-modal-close {
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    padding: 0.5rem;
    min-width: 44px;
    min-height: 44px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
}
.app-modal-close:hover { color: var(--text); }

.app-modal-fade-enter-active,
.app-modal-fade-leave-active { transition: opacity 0.18s ease; }
.app-modal-fade-enter-from,
.app-modal-fade-leave-to { opacity: 0; }

/* ── Mobile drawer ──────────────────────────────────────────────── */
/* useDrawer injects .drawer-backdrop / .drawer-panel positioning &
   transitions; this layer adds the modal-specific chrome (rounded top,
   shadow, max-height, safe-area inset, drag-handle). */
.app-modal-drawer-backdrop {
    z-index: 1500;
}
.app-modal-drawer-panel {
    z-index: 1501;
    border-top: 1px solid var(--border);
    border-radius: 14px 14px 0 0;
    box-shadow: 0 -8px 24px rgba(0, 0, 0, 0.28);
    max-height: 88vh;
    padding-bottom: env(safe-area-inset-bottom, 0px);
}
.app-modal-drawer-panel::before {
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
.app-modal-drawer-head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.9rem 0.6rem;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
}
.app-modal-drawer-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
}

/* ── Desktop body wrapper ───────────────────────────────────────── */
/* Structural wrapper that matches the mobile .app-modal-drawer-body.
   Padding is intentionally 0 — callers are responsible for spacing
   their slot content. AppConfirmDialog and similar leaf components
   supply their own inner padding. */
.app-modal-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
}
</style>
