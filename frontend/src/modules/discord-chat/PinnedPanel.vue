<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue';
import { Icon } from '@iconify/vue';
import type { Message } from '../../libs/messages/types';

/**
 * Floating panel listing pinned messages. Anchors to the pin button in
 * the conversation header, fetches lazily on first open, and dismisses
 * on outside click / Esc / explicit close. Click a row to deep-link
 * via the `?scrollTo=` query — the workspace machine takes it from
 * there and flashes the message.
 */

const props = defineProps<{
    visible: boolean;
    loading: boolean;
    error: string | null;
    messages: Message[];
}>();

const emit = defineEmits<{
    (e: 'close'): void;
    (e: 'jump', messageId: string): void;
}>();

const rootRef = ref<HTMLDivElement | null>(null);

function onWindowDown(event: MouseEvent) {
    if (!props.visible) return;
    if (rootRef.value?.contains(event.target as Node)) return;
    // Also ignore clicks on the trigger button so its own toggle
    // handler isn't immediately undone by ours. The trigger lives
    // outside this component; we recognise it by the data-attribute
    // the conversation header sets when rendering it.
    if ((event.target as HTMLElement | null)?.closest('[data-pins-trigger]')) return;
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
    window.addEventListener('keydown', onWindowKey);
});
onUnmounted(() => {
    window.removeEventListener('mousedown', onWindowDown);
    window.removeEventListener('keydown', onWindowKey);
});

// Reset scroll position to top when the panel opens — feels weird if
// the previously-viewed scroll position lingers across openings on
// different channels.
watch(() => props.visible, (visible) => {
    if (visible && rootRef.value) rootRef.value.scrollTop = 0;
});

function preview(message: Message): string {
    if (message.content) return message.content;
    if (message.attachments?.length) return `📎 ${message.attachments[0].filename ?? 'attachment'}`;
    if (message.stickers?.length) return `🏷 ${message.stickers[0].name ?? 'sticker'}`;
    if (message.embeds?.length) return '[embed]';
    return '';
}

function authorName(message: Message): string {
    const a = message.author;
    return a.globalName || a.username || a.id;
}

function timestamp(message: Message): string {
    try { return new Date(message.createdAt).toLocaleString(); } catch { return ''; }
}
</script>

<template>
    <div v-if="visible" ref="rootRef" class="pins-panel" role="dialog" aria-modal="false">
        <header class="pins-header">
            <span>{{ $t('messages.pinnedMessages') }}</span>
            <button type="button" class="pins-close" @click="emit('close')" :aria-label="$t('common.close')">
                <Icon icon="material-symbols:close-rounded" width="18" height="18" />
            </button>
        </header>
        <div class="pins-body">
            <p v-if="loading" class="pins-empty">{{ $t('common.loading') }}</p>
            <p v-else-if="error" class="pins-error">{{ error }}</p>
            <p v-else-if="messages.length === 0" class="pins-empty">{{ $t('messages.noPins') }}</p>
            <ul v-else class="pins-list">
                <li
                    v-for="message in messages"
                    :key="message.id"
                    class="pin-item"
                    @click="emit('jump', message.id)"
                >
                    <img v-if="message.author.avatarUrl" :src="message.author.avatarUrl" alt="" class="pin-avatar" />
                    <div v-else class="pin-avatar pin-avatar-fallback">{{ authorName(message).charAt(0).toUpperCase() }}</div>
                    <div class="pin-meta">
                        <div class="pin-row">
                            <span class="pin-author">{{ authorName(message) }}</span>
                            <span class="pin-ts">{{ timestamp(message) }}</span>
                        </div>
                        <div class="pin-preview">{{ preview(message) }}</div>
                    </div>
                </li>
            </ul>
        </div>
    </div>
</template>

<style scoped>
.pins-panel {
    position: absolute;
    top: var(--conv-header-height);
    right: 0.5rem;
    width: min(92vw, 380px);
    max-height: 60vh;
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.28);
    z-index: 30;
    display: flex;
    flex-direction: column;
    overflow: hidden;
}
.pins-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.55rem 0.85rem;
    border-bottom: 1px solid var(--border);
    font-weight: 600;
    color: var(--text-strong);
    font-size: 0.92rem;
}
.pins-close {
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    padding: 2px;
    border-radius: 3px;
    line-height: 0;
}
.pins-close:hover { background: var(--bg-surface-hover); color: var(--text); }
.pins-body { overflow-y: auto; }
.pins-empty, .pins-error { padding: 1.2rem; text-align: center; color: var(--text-muted); font-size: 0.9rem; }
.pins-error { color: var(--danger); }
.pins-list { list-style: none; margin: 0; padding: 0.25rem 0; }
.pin-item {
    display: flex;
    gap: 0.6rem;
    padding: 0.5rem 0.85rem;
    cursor: pointer;
    border-radius: var(--radius-sm);
}
.pin-item:hover { background: var(--bg-surface-hover); }
.pin-avatar {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    object-fit: cover;
    flex-shrink: 0;
    background: var(--bg-surface-2);
}
.pin-avatar-fallback {
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--accent);
    color: var(--text-on-accent);
    font-weight: 600;
    font-size: 0.85rem;
}
.pin-meta { flex: 1; min-width: 0; }
.pin-row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 0.5rem;
}
.pin-author { font-weight: 600; color: var(--text-strong); font-size: 0.88rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pin-ts { font-size: 0.7rem; color: var(--text-muted); flex-shrink: 0; }
.pin-preview {
    color: var(--text-muted);
    font-size: 0.85rem;
    line-height: 1.3;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
}
</style>
