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
    icon: string;
    danger?: boolean;
}
</script>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { Icon } from '@iconify/vue';

const props = defineProps<{
    visible: boolean;
    /** Where the user clicked (or long-pressed). Top-left of menu lands
     *  here unless that would push the menu off-screen, in which case
     *  we flip to the other side. */
    x: number;
    y: number;
    actions: ContextMenuAction[];
}>();

const emit = defineEmits<{
    (e: 'pick', key: string): void;
    (e: 'close'): void;
}>();

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

function onWindowDown(event: MouseEvent | PointerEvent) {
    if (!props.visible) return;
    if (rootRef.value && rootRef.value.contains(event.target as Node)) return;
    emit('close');
}
function onWindowKey(event: KeyboardEvent) {
    if (!props.visible) return;
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

function pick(action: ContextMenuAction) {
    emit('pick', action.key);
    emit('close');
}
</script>

<template>
    <Teleport to="body">
        <div
            v-if="visible"
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
                <Icon :icon="action.icon" width="16" height="16" />
                <span>{{ action.label }}</span>
            </button>
        </div>
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
</style>
