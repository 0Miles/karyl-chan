<script setup lang="ts">
import { ref } from 'vue';
import { animatedAvatarUrl, isAnimatedAvatar } from '../../../modules/discord-chat';
import { useUnreadStore } from '../../../modules/discord-chat/stores/unreadStore';
import { useMuteStore } from '../../../modules/discord-chat/stores/muteStore';
import UnreadPill from '../../../components/UnreadPill.vue';
import type { DmChannelSummary } from '../../../api/dm';
import type { GuildSummary } from '../../../api/guilds';
import ModeSelect from './ModeSelect.vue';
import { Icon } from '@iconify/vue';

const unreadStore = useUnreadStore();
const muteStore = useMuteStore();

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
    <header class="sidebar-header">
        <ModeSelect :mode="mode" :guilds="guilds" @mode-change="emit('mode-change', $event)" />
        <button type="button" class="ghost" @click="emit('toggle-start')">
            <Icon icon="material-symbols:add-rounded" width="20" height="20" />
        </button>
    </header>
    <form v-if="showStartForm" class="start-form" @submit.prevent="emit('submit-start')">
        <input
            :value="newRecipientId"
            :placeholder="$t('messages.recipientId')"
            @input="emit('update:newRecipientId', ($event.target as HTMLInputElement).value)"
        />
        <button type="submit" :disabled="!newRecipientId?.trim()">{{ $t('common.start') }}</button>
    </form>
    <div v-if="loading && channels.length === 0" class="loading muted">{{ $t('common.loading') }}</div>
    <p v-else-if="channels.length === 0" class="muted empty">{{ emptyHint ?? $t('messages.noDms') }}</p>
    <ul class="channel-list">
        <li
            v-for="channel in channels"
            :key="channel.id"
            :class="{ active: channel.id === selectedId, muted: muteStore.isMuted(channel.id) }"
            @click="emit('select', channel.id)"
            @mouseenter="hoveredChannelId = channel.id"
            @mouseleave="hoveredChannelId = null"
        >
            <img v-if="rowAvatarSrc(channel)" :src="rowAvatarSrc(channel) ?? ''" alt="" class="avatar" />
            <div v-else class="avatar avatar-fallback">{{ (channel.recipient.globalName ?? channel.recipient.username).charAt(0).toUpperCase() }}</div>
            <div class="meta">
                <div class="row">
                    <span class="name" :class="{ 'has-unread': unreadStore.hasChannelUnread(channel.id) && !muteStore.isMuted(channel.id) }">
                        {{ channel.recipient.globalName ?? channel.recipient.username }}
                    </span>
                    <Icon v-if="muteStore.isMuted(channel.id)" icon="material-symbols:notifications-off-outline-rounded" width="14" height="14" class="mute-icon" />
                    <span class="timestamp">{{ formatTimestamp(channel.lastMessageAt) }}</span>
                </div>
                <div class="preview-row">
                    <span class="preview">{{ channel.lastMessagePreview ?? '' }}</span>
                    <UnreadPill v-if="!muteStore.isMuted(channel.id)" :count="unreadStore.getChannelCount(channel.id)" />
                </div>
            </div>
        </li>
    </ul>
</template>

<style scoped>
.sidebar {
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    min-height: 0;
}
.sidebar-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.6rem 0.75rem;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
    height: 54px;
}
@media (max-width: 768px) {
    .sidebar {
        border-right: none;
        height: 100%;
    }
    .sidebar-header{
        height: auto;
    }
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
.row { display: flex; justify-content: space-between; align-items: baseline; gap: 0.25rem; }
.name { font-weight: 500; color: var(--text-strong); flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.name.has-unread { font-weight: 700; }
.mute-icon { color: var(--text-muted); flex-shrink: 0; }
.timestamp { font-size: 0.75rem; color: var(--text-muted); flex-shrink: 0; }
/* Muted DMs: fade the row so the user sees they're explicitly silenced
   without removing them from the list. */
.channel-list li.muted { opacity: 0.55; }
.channel-list li.muted:hover { opacity: 0.85; }
.channel-list li.muted.active { opacity: 1; }
.preview-row {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    min-width: 0;
}
.preview {
    flex: 1;
    font-size: 0.8rem;
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
}
.muted { color: var(--text-muted); font-size: 0.9rem; }
.empty { padding: 1rem; }
.loading {
    padding: 1rem;
    text-align: center;
}
</style>
