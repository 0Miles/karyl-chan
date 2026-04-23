<script setup lang="ts">
import { ref } from 'vue';
import { animatedAvatarUrl, isAnimatedAvatar } from '../../modules/discord-chat';
import type { DmChannelSummary } from '../../api/dm';
import type { GuildSummary } from '../../api/guilds';
import ModeSelect from './ModeSelect.vue';
import { Icon } from '@iconify/vue';

defineProps<{
    guilds: GuildSummary[];
    mode: string;
    channels: DmChannelSummary[];
    selectedId: string | null;
    loading?: boolean;
    showStartForm?: boolean;
    newRecipientId?: string;
    emptyHint?: string;
}>();

const emit = defineEmits<{
    (e: 'mode-change', mode: string): void;
    (e: 'select', channelId: string): void;
    (e: 'toggle-start'): void;
    (e: 'submit-start'): void;
    (e: 'update:newRecipientId', value: string): void;
}>();

const hoveredChannelId = ref<string | null>(null);

function rowAvatarSrc(channel: DmChannelSummary): string | null {
    const url = channel.recipient.avatarUrl;
    if (!url) return null;
    if (hoveredChannelId.value === channel.id && isAnimatedAvatar(url)) return animatedAvatarUrl(url);
    return url;
}

function formatTimestamp(iso: string | null): string {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const now = new Date();
    if (d.toDateString() === now.toDateString()) {
        return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return d.toLocaleDateString();
}
</script>

<template>
    <aside class="sidebar">
        <header class="sidebar-header">
            <ModeSelect :mode="mode" :guilds="guilds" @mode-change="emit('mode-change', $event)" />
            <button type="button" class="ghost" @click="emit('toggle-start')">
                <Icon icon="material-symbols:add-rounded" width="20" height="20" />
            </button>
        </header>
        <form v-if="showStartForm" class="start-form" @submit.prevent="emit('submit-start')">
            <input
                :value="newRecipientId"
                placeholder="Recipient user id"
                @input="emit('update:newRecipientId', ($event.target as HTMLInputElement).value)"
            />
            <button type="submit" :disabled="!newRecipientId?.trim()">Start</button>
        </form>
        <div v-if="loading && channels.length === 0" class="loading muted">Loading…</div>
        <p v-else-if="channels.length === 0" class="muted empty">{{ emptyHint ?? 'No DMs yet.' }}</p>
        <ul class="channel-list">
            <li
                v-for="channel in channels"
                :key="channel.id"
                :class="{ active: channel.id === selectedId }"
                @click="emit('select', channel.id)"
                @mouseenter="hoveredChannelId = channel.id"
                @mouseleave="hoveredChannelId = null"
            >
                <img v-if="rowAvatarSrc(channel)" :src="rowAvatarSrc(channel) ?? ''" alt="" class="avatar" />
                <div v-else class="avatar avatar-fallback">{{ (channel.recipient.globalName ?? channel.recipient.username).charAt(0).toUpperCase() }}</div>
                <div class="meta">
                    <div class="row">
                        <span class="name">{{ channel.recipient.globalName ?? channel.recipient.username }}</span>
                        <span class="timestamp">{{ formatTimestamp(channel.lastMessageAt) }}</span>
                    </div>
                    <div class="preview">{{ channel.lastMessagePreview ?? '' }}</div>
                </div>
            </li>
        </ul>
    </aside>
</template>

<style scoped>
.sidebar {
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    min-height: 0;
}
@media (max-width: 768px) {
    .sidebar {
        border-right: none;
        height: 100%;
    }
}
.sidebar-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.6rem 0.75rem;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
}
.ghost {
    flex-shrink: 0;
    background: none;
    border: 1px solid var(--border);
    border-radius: 6px;
    width: 32px;
    height: 32px;
    cursor: pointer;
    color: var(--text);
    display: inline-flex;
    align-items: center;
    justify-content: center;
}
.ghost:hover { background: var(--bg-surface-hover); }
.start-form {
    display: flex;
    gap: 0.25rem;
    padding: 0.5rem 0.75rem;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
}
.start-form input {
    flex: 1;
    padding: 0.3rem 0.5rem;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg-surface);
    color: var(--text);
    font: inherit;
}
.start-form button {
    padding: 0.3rem 0.6rem;
    background: var(--accent);
    color: var(--text-on-accent);
    border: none;
    border-radius: 4px;
    cursor: pointer;
}
.start-form button:disabled { opacity: 0.5; }
.channel-list {
    list-style: none;
    margin: 0;
    padding: 0;
}
.channel-list li {
    display: flex;
    gap: 0.6rem;
    padding: 0.5rem 0.75rem;
    cursor: pointer;
    border-bottom: 1px solid var(--border);
}
.channel-list li:hover { background: var(--bg-surface-hover); }
.channel-list li.active { background: var(--bg-surface-active); }
.avatar {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    flex-shrink: 0;
    object-fit: cover;
}
.avatar-fallback {
    background: var(--accent);
    color: var(--text-on-accent);
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 600;
}
.meta { flex: 1; min-width: 0; }
.row { display: flex; justify-content: space-between; align-items: baseline; }
.name { font-weight: 500; color: var(--text-strong); }
.timestamp { font-size: 0.75rem; color: var(--text-muted); }
.preview {
    font-size: 0.8rem;
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.muted { color: var(--text-muted); font-size: 0.9rem; }
.empty { padding: 1rem; }
.loading {
    padding: 1rem;
    text-align: center;
}
</style>
