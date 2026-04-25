<script setup lang="ts">
import { computed } from 'vue';
import { useMessageContext } from './context';

const props = defineProps<{
    kind: 'user' | 'channel' | 'role' | 'everyone' | 'here' | 'slashCommand';
    id?: string;
    name?: string;
}>();

const ctx = useMessageContext();

const display = computed(() => {
    switch (props.kind) {
        case 'user': {
            const u = props.id ? ctx.resolveUser?.(props.id) : null;
            return { text: `@${u?.name ?? props.id ?? 'unknown'}`, color: u?.color ?? null };
        }
        case 'channel': {
            const c = props.id ? ctx.resolveChannel?.(props.id) : null;
            return { text: `#${c?.name ?? props.id ?? 'unknown'}`, color: null };
        }
        case 'role': {
            const r = props.id ? ctx.resolveRole?.(props.id) : null;
            return { text: `@${r?.name ?? props.id ?? 'role'}`, color: r?.color ?? null };
        }
        case 'everyone':
            return { text: '@everyone', color: null };
        case 'here':
            return { text: '@here', color: null };
        case 'slashCommand':
            return { text: `/${props.name ?? ''}`, color: null };
    }
});

const isUser = computed(() => props.kind === 'user' && !!props.id);

function onClick(event: MouseEvent) {
    if (!isUser.value || !props.id || !ctx.onUserClick) return;
    const anchor = event.currentTarget as HTMLElement | null;
    if (!anchor) return;
    event.preventDefault();
    event.stopPropagation();
    ctx.onUserClick(props.id, anchor);
}

function onContextMenu(event: MouseEvent) {
    if (!isUser.value || !props.id || !ctx.onUserContextMenu) return;
    const anchor = event.currentTarget as HTMLElement | null;
    if (!anchor) return;
    event.preventDefault();
    event.stopPropagation();
    const u = ctx.resolveUser?.(props.id);
    ctx.onUserContextMenu(props.id, anchor, { x: event.clientX, y: event.clientY }, u?.name ?? null);
}

// Touch long-press → user context menu. Only meaningful for user
// mentions; channel/role/everyone chips don't have a per-target menu.
const LONG_PRESS_MS = 450;
let longPressTimer: ReturnType<typeof setTimeout> | null = null;
function onTouchStart(event: TouchEvent) {
    if (!isUser.value || !props.id || !ctx.onUserContextMenu) return;
    if (event.touches.length !== 1) return;
    const anchor = event.currentTarget as HTMLElement | null;
    if (!anchor) return;
    const touch = event.touches[0];
    const userId = props.id;
    if (longPressTimer) clearTimeout(longPressTimer);
    longPressTimer = setTimeout(() => {
        longPressTimer = null;
        const u = ctx.resolveUser?.(userId);
        ctx.onUserContextMenu?.(userId, anchor, { x: touch.clientX, y: touch.clientY }, u?.name ?? null);
    }, LONG_PRESS_MS);
}
function onTouchEnd() {
    if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
    }
}
</script>

<template>
    <span
        :class="['mention', { clickable: isUser }]"
        :style="display.color ? { color: display.color } : undefined"
        @click.stop="onClick"
        @contextmenu.stop="onContextMenu"
        @touchstart.stop.passive="onTouchStart"
        @touchend.stop="onTouchEnd"
        @touchmove.stop="onTouchEnd"
        @touchcancel.stop="onTouchEnd"
    >{{ display.text }}</span>
</template>

<style scoped>
.mention {
    display: inline;
    background: var(--accent-bg);
    color: var(--accent-text);
    padding: 0 2px;
    border-radius: 3px;
    font-weight: 500;
    cursor: default;
}
.mention.clickable {
    cursor: pointer;
}
.mention.clickable:hover {
    background: var(--accent);
    color: var(--text-on-accent);
}
</style>
