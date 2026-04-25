<script lang="ts">
/**
 * Floating context menu for a single message. Positioned at the user's
 * click coordinates and clamped to the viewport so it never spills off
 * screen on small phones. Listens for outside clicks and the Esc key
 * to dismiss; the parent owns visibility via `visible` + `@close`.
 */
export interface ContextMenuAction {
    key: string;
    label: string;
    /** Iconify glyph name for vector icons. Ignored when `iconUrl` is set. */
    icon?: string;
    /** Image URL — used in place of `icon` for entries that need a photo
     *  (e.g. user avatars in the reaction menu's "who reacted" list). */
    iconUrl?: string;
    danger?: boolean;
}
</script>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, toRef } from 'vue';
import { Icon } from '@iconify/vue';
import { useBreakpoint } from '../../composables/use-breakpoint';
import { useDrawer } from '../../composables/use-drawer';

const props = defineProps<{
    visible: boolean;
    /** Where the user clicked (or long-pressed). Top-left of menu lands
     *  here on desktop unless that would push the menu off-screen, in
     *  which case we flip to the other side. Ignored on mobile, where
     *  the menu renders as a bottom drawer. */
    x: number;
    y: number;
    actions: ContextMenuAction[];
}>();

const emit = defineEmits<{
    (e: 'pick', key: string): void;
    (e: 'close'): void;
}>();

const { isMobile } = useBreakpoint();
const rootRef = ref<HTMLDivElement | null>(null);

// Final placement is computed once the menu is mounted so we can read
// its measured size — flips to the left/top edge when the click was
// near the right/bottom of the viewport.
const placement = computed(() => {
    const root = rootRef.value;
    const margin = 8;
    if (!root || !props.visible) {
        return { left: `${props.x}px`, top: `${props.y}px` };
    }
    const rect = root.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = props.x;
    let top = props.y;
    if (left + rect.width > vw - margin) left = Math.max(margin, vw - rect.width - margin);
    if (top + rect.height > vh - margin) top = Math.max(margin, vh - rect.height - margin);
    return { left: `${left}px`, top: `${top}px` };
});

// Mount the popover branch on desktop and the drawer branch on mobile.
// Two separate computed flags keep the watchers in `useDrawer` from
// firing when the menu is invisible-but-on-the-other-viewport.
const popoverVisible = computed(() => props.visible && !isMobile.value);
const drawerVisible = computed(() => props.visible && isMobile.value);

const visibleRef = toRef(props, 'visible');

function onWindowDown(event: MouseEvent | PointerEvent) {
    if (!visibleRef.value || isMobile.value) return;
    if (rootRef.value && rootRef.value.contains(event.target as Node)) return;
    emit('close');
}
function onWindowKey(event: KeyboardEvent) {
    if (!visibleRef.value) return;
    // Drawer branch handles its own Escape via useDrawer's escape stack;
    // here we only cover the desktop popover branch.
    if (isMobile.value) return;
    if (event.key === 'Escape') {
        event.preventDefault();
        emit('close');
    }
}

onMounted(() => {
    window.addEventListener('mousedown', onWindowDown);
    window.addEventListener('contextmenu', onWindowDown, { capture: true });
    window.addEventListener('keydown', onWindowKey);
});
onUnmounted(() => {
    window.removeEventListener('mousedown', onWindowDown);
    window.removeEventListener('contextmenu', onWindowDown, { capture: true } as EventListenerOptions);
    window.removeEventListener('keydown', onWindowKey);
});

const { backdropClass, panelClass, backdropTransition, panelTransition } = useDrawer({
    visible: drawerVisible,
    placement: 'bottom',
    onClose: () => emit('close')
});

function pick(action: ContextMenuAction) {
    emit('pick', action.key);
    emit('close');
}
</script>

<template>
    <Teleport to="body">
        <!-- Desktop popover branch — anchored at the click point. -->
        <div
            v-if="popoverVisible"
            ref="rootRef"
            class="ctx-menu"
            role="menu"
            :style="placement"
            @click.stop
            @contextmenu.prevent
        >
            <button
                v-for="action in actions"
                :key="action.key"
                type="button"
                role="menuitem"
                :class="['ctx-item', { danger: action.danger }]"
                @click="pick(action)"
            >
                <img v-if="action.iconUrl" :src="action.iconUrl" alt="" class="ctx-icon-img" />
                <Icon v-else-if="action.icon" :icon="action.icon" width="16" height="16" />
                <span>{{ action.label }}</span>
            </button>
        </div>
    </Teleport>

    <!-- Mobile drawer branch — full-width sheet anchored to the bottom
         of the viewport. The action grid replaces the OS context menu;
         a tap on the backdrop dismisses. -->
    <Teleport to="body">
        <Transition :name="backdropTransition">
            <div
                v-if="drawerVisible"
                :class="[backdropClass, 'ctx-drawer-backdrop']"
                @click="emit('close')"
                @contextmenu.prevent
            />
        </Transition>
        <Transition :name="panelTransition">
            <div
                v-if="drawerVisible"
                :class="[panelClass, 'ctx-drawer-panel']"
                data-placement="bottom"
                role="menu"
                @click.stop
                @contextmenu.prevent
            >
                <ul class="ctx-drawer-list">
                    <li v-for="action in actions" :key="action.key">
                        <button
                            type="button"
                            role="menuitem"
                            :class="['ctx-drawer-item', { danger: action.danger }]"
                            @click="pick(action)"
                        >
                            <img v-if="action.iconUrl" :src="action.iconUrl" alt="" class="ctx-drawer-icon-img" />
                            <Icon v-else-if="action.icon" :icon="action.icon" width="20" height="20" />
                            <span>{{ action.label }}</span>
                        </button>
                    </li>
                </ul>
            </div>
        </Transition>
    </Teleport>
</template>

<style scoped>
.ctx-menu {
    position: fixed;
    min-width: 180px;
    max-width: 240px;
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: 6px;
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.28);
    padding: 0.25rem;
    z-index: 90;
    display: flex;
    flex-direction: column;
    gap: 1px;
}
.ctx-item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.45rem 0.6rem;
    background: none;
    border: none;
    text-align: left;
    cursor: pointer;
    color: var(--text);
    font: inherit;
    font-size: 0.88rem;
    border-radius: 4px;
}
.ctx-item:hover { background: var(--bg-surface-hover); }
.ctx-item.danger { color: var(--danger); }
.ctx-item.danger:hover { background: rgba(239, 68, 68, 0.12); }
.ctx-icon-img {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    object-fit: cover;
    flex-shrink: 0;
}

/* Mobile drawer chrome — useDrawer provides .drawer-backdrop and
   .drawer-panel positioning; this layer adds the rounded top corners,
   safe-area inset, and the action list styling that distinguishes the
   sheet from a generic edge-anchored panel. */
.ctx-drawer-backdrop {
    /* Sit above the in-conversation overlays (~90 z-index) so the
       backdrop reliably catches taps targeted at messages behind it. */
    z-index: 1500;
}
.ctx-drawer-panel {
    z-index: 1501;
    border-top: 1px solid var(--border);
    border-radius: 14px 14px 0 0;
    box-shadow: 0 -8px 24px rgba(0, 0, 0, 0.28);
    max-height: 70vh;
    padding-bottom: env(safe-area-inset-bottom, 0px);
}
.ctx-drawer-list {
    list-style: none;
    margin: 0;
    padding: 0.4rem 0;
    overflow-y: auto;
    /* Drag-handle visual cue at the top of the sheet so the affordance
       reads as a bottom drawer even on a quick glance. */
}
.ctx-drawer-list::before {
    content: '';
    display: block;
    width: 36px;
    height: 4px;
    border-radius: 2px;
    background: var(--text-muted);
    opacity: 0.35;
    margin: 0 auto 0.5rem;
    flex-shrink: 0;
}
.ctx-drawer-item {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.85rem 1rem;
    background: none;
    border: none;
    text-align: left;
    color: var(--text);
    font: inherit;
    font-size: 0.95rem;
    cursor: pointer;
    /* Larger tap target than desktop — matches Android Material list-item
       baseline of 56px so the actions stay easy to hit one-handed. */
    min-height: 48px;
}
.ctx-drawer-item:active { background: var(--bg-surface-hover); }
.ctx-drawer-item.danger { color: var(--danger); }
.ctx-drawer-icon-img {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    object-fit: cover;
    flex-shrink: 0;
}
</style>
