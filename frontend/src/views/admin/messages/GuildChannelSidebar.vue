<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import {
    listGuildActiveThreads,
    type GuildActiveThread,
    type GuildChannelCategory,
    type GuildSummary,
    type GuildTextChannel
} from '../../../api/guilds';
import { useI18n } from 'vue-i18n';
import { useUnreadStore } from '../../../modules/discord-chat/stores/unreadStore';
import { useMuteStore } from '../../../modules/discord-chat/stores/muteStore';
import { useUserContextMenuStore } from '../../../modules/discord-chat/stores/userContextMenuStore';
import type { VoiceChannelMember } from '../../../api/guilds';
import UnreadPill from '../../../components/UnreadPill.vue';
import ModeSelect from './ModeSelect.vue';
import MessageContextMenu, { type ContextMenuAction } from '../../../libs/messages/MessageContextMenu.vue';
import { Icon } from '@iconify/vue';

const { t: $t } = useI18n();

const unreadStore = useUnreadStore();
const muteStore = useMuteStore();
const userMenu = useUserContextMenuStore();

// Channel right-click — surfaces mute/unmute, mark-as-read, and copy
// helpers per row. Local state (no shared store) because this menu only
// ever fires from this sidebar.
const channelMenu = ref<{ x: number; y: number; channelId: string } | null>(null);
function onChannelContext(event: MouseEvent, channelId: string) {
    event.preventDefault();
    event.stopPropagation();
    channelMenu.value = { x: event.clientX, y: event.clientY, channelId };
}
const channelMenuActions = computed<ContextMenuAction[]>(() => {
    if (!channelMenu.value) return [];
    const id = channelMenu.value.channelId;
    const actions: ContextMenuAction[] = [];
    if (unreadStore.hasChannelUnread(id) || unreadStore.getChannelMentionCount(id) > 0) {
        actions.push({ key: 'mark-read', label: $t('channelMenu.markAsRead'), icon: 'material-symbols:mark-chat-read-outline-rounded' });
    }
    const level = muteStore.getLevel(id);
    if (level === 'all') {
        actions.push({ key: 'mute-mentions', label: $t('channelMenu.muteMentionsOnly'), icon: 'material-symbols:notifications-paused-outline-rounded' });
        actions.push({ key: 'mute-all', label: $t('channelMenu.muteAll'), icon: 'material-symbols:notifications-off-outline-rounded' });
    } else if (level === 'mentions-only') {
        actions.push({ key: 'mute-all', label: $t('channelMenu.muteAll'), icon: 'material-symbols:notifications-off-outline-rounded' });
        actions.push({ key: 'unmute', label: $t('channelMenu.unmute'), icon: 'material-symbols:notifications-active-outline-rounded' });
    } else {
        actions.push({ key: 'mute-mentions', label: $t('channelMenu.muteMentionsOnly'), icon: 'material-symbols:notifications-paused-outline-rounded' });
        actions.push({ key: 'unmute', label: $t('channelMenu.unmute'), icon: 'material-symbols:notifications-active-outline-rounded' });
    }
    actions.push({ key: 'copy-link', label: $t('channelMenu.copyLink'), icon: 'material-symbols:link-rounded' });
    actions.push({ key: 'copy-id', label: $t('channelMenu.copyId'), icon: 'material-symbols:fingerprint-rounded' });
    return actions;
});
async function copyToClipboard(text: string) {
    try { await navigator.clipboard.writeText(text); } catch { /* ignore */ }
}
function onChannelMenuPick(actionKey: string) {
    const ctx = channelMenu.value;
    if (!ctx) return;
    const id = ctx.channelId;
    switch (actionKey) {
        case 'mark-read': unreadStore.markRead(id); break;
        case 'mute-mentions': muteStore.setLevel(id, 'mentions-only'); break;
        case 'mute-all': muteStore.setLevel(id, 'none'); break;
        case 'unmute': muteStore.setLevel(id, 'all'); break;
        case 'copy-link':
            // Discord canonical channel link. `props.guildId` may be null
            // very briefly during guild switches; skip in that case.
            if (props.guildId) void copyToClipboard(`https://discord.com/channels/${props.guildId}/${id}`);
            break;
        case 'copy-id': void copyToClipboard(id); break;
    }
}

function onVoiceMemberContext(event: MouseEvent, channelId: string, member: VoiceChannelMember) {
    if (!props.guildId) return;
    event.preventDefault();
    event.stopPropagation();
    const target = event.currentTarget as HTMLElement | null;
    if (!target) return;
    userMenu.open({
        userId: member.id,
        anchor: target,
        x: event.clientX,
        y: event.clientY,
        guildId: props.guildId,
        displayName: member.nickname ?? member.globalName ?? member.username,
        // The voice-state flags (server muted/deafened) aren't tracked on
        // the cached member row yet — passing the channel alone unlocks
        // mute/deafen/move/disconnect; the toggles act idempotently.
        voice: { channelId }
    });
}

const props = defineProps<{
    guilds: GuildSummary[];
    mode: string;
    categories: GuildChannelCategory[];
    selectedId: string | null;
    loading?: boolean;
    /** Guild whose active threads we should load. */
    guildId?: string | null;
}>();

const emit = defineEmits<{
    (e: 'mode-change', mode: string): void;
    (e: 'select', channelId: string): void;
}>();

const collapsed = ref(new Set<string>());

function toggleCategory(id: string | null) {
    const key = id ?? '__none__';
    if (collapsed.value.has(key)) collapsed.value.delete(key);
    else collapsed.value.add(key);
    collapsed.value = new Set(collapsed.value);
}

function isCategoryCollapsed(id: string | null): boolean {
    return collapsed.value.has(id ?? '__none__');
}

// Active threads — keyed by parent channel id so we can render them
// inline below their parent. Refetches on guild change. Archived
// threads are deliberately not loaded; they're a less-common surface
// and would clutter the sidebar.
const threadsByParent = ref<Record<string, GuildActiveThread[]>>({});

async function loadThreads() {
    if (!props.guildId) return;
    const guildId = props.guildId;
    try {
        const result = await listGuildActiveThreads(guildId);
        if (props.guildId !== guildId) return;
        const grouped: Record<string, GuildActiveThread[]> = {};
        for (const t of result) {
            const key = t.parentId ?? '__none__';
            if (!grouped[key]) grouped[key] = [];
            grouped[key].push(t);
        }
        for (const key of Object.keys(grouped)) {
            grouped[key].sort((a, b) => a.name.localeCompare(b.name));
        }
        threadsByParent.value = grouped;
    } catch {
        /* threads are a nicety; silently fail */
    }
}

function threadsFor(channelId: string): GuildActiveThread[] {
    return threadsByParent.value[channelId] ?? [];
}

// Picks the channel-row glyph from the channel kind. `text` keeps the
// classic `#` so it isn't visually disrupted by an icon swap; voice/
// stage/forum get distinct iconify glyphs to mirror Discord's tree.
function channelIcon(channel: GuildTextChannel): string | null {
    switch (channel.kind) {
        case 'voice': return 'material-symbols:volume-up-outline-rounded';
        case 'stage': return 'material-symbols:campaign-outline-rounded';
        case 'forum': return 'material-symbols:forum-outline-rounded';
        default: return null;
    }
}

onMounted(() => { void loadThreads(); });
watch(() => props.guildId, () => {
    threadsByParent.value = {};
    void loadThreads();
});
</script>

<template>
    <header class="sidebar-header">
        <ModeSelect :mode="mode" :guilds="guilds" @mode-change="emit('mode-change', $event)" />
    </header>
    <div v-if="loading && categories.length === 0" class="loading muted">{{ $t('common.loading') }}</div>
    <p v-else-if="categories.length === 0" class="muted empty">{{ $t('messages.noTextChannels') }}</p>
    <div class="channel-tree">
        <div v-for="cat in categories" :key="cat.id ?? '__none__'" class="category">
            <button
                    v-if="cat.name"
                    type="button"
                    class="category-header"
                    @click="toggleCategory(cat.id)">
                <span class="chevron" :class="{ collapsed: isCategoryCollapsed(cat.id) }">›</span>
                {{ cat.name.toUpperCase() }}
            </button>
            <ul v-if="!isCategoryCollapsed(cat.id)" class="channel-list">
                <template v-for="channel in cat.channels" :key="channel.id">
                <li
                    :class="['channel-row', `kind-${channel.kind}`, {
                        active: channel.id === selectedId,
                        unread: (muteStore.showsCount(channel.id) && unreadStore.hasChannelUnread(channel.id))
                            || (muteStore.showsMention(channel.id) && unreadStore.getChannelMentionCount(channel.id) > 0),
                        muted: muteStore.isMuted(channel.id)
                    }]"
                    @click="emit('select', channel.id)"
                    @contextmenu="onChannelContext($event, channel.id)">
                    <span v-if="channel.kind === 'text'" class="hash">#</span>
                    <Icon v-else :icon="channelIcon(channel) ?? ''" width="14" height="14" class="kind-icon" />
                    <span class="name">{{ channel.name }}</span>
                    <span
                        v-if="(channel.kind === 'voice' || channel.kind === 'stage') && channel.voiceMembers && channel.voiceMembers.length > 0"
                        class="voice-count"
                    >{{ channel.voiceMembers.length }}</span>
                    <Icon v-if="muteStore.isMuted(channel.id)" icon="material-symbols:notifications-off-outline-rounded" width="14" height="14" class="mute-icon" />
                    <!-- Mention pill stays visible when 'mentions-only';
                         only hidden in the fully-silent 'none' level. -->
                    <UnreadPill v-if="muteStore.showsMention(channel.id)" class="channel-pill" :count="unreadStore.getChannelMentionCount(channel.id)" />
                </li>
                <li
                    v-if="(channel.kind === 'voice' || channel.kind === 'stage') && channel.voiceMembers && channel.voiceMembers.length > 0"
                    class="voice-members-wrap"
                >
                    <ul class="voice-members">
                        <li
                            v-for="m in channel.voiceMembers"
                            :key="m.id"
                            class="voice-member"
                            :title="m.username"
                            @contextmenu="onVoiceMemberContext($event, channel.id, m)"
                        >
                            <img v-if="m.avatarUrl" :src="m.avatarUrl" alt="" class="voice-avatar" />
                            <span class="voice-name">{{ m.nickname ?? m.globalName ?? m.username }}</span>
                        </li>
                    </ul>
                </li>
                <li
                    v-for="thread in threadsFor(channel.id)"
                    :key="thread.id"
                    :class="['thread-row', { active: thread.id === selectedId }]"
                    @click="emit('select', thread.id)"
                    @contextmenu="onChannelContext($event, thread.id)"
                >
                    <Icon icon="material-symbols:forum-outline-rounded" width="12" height="12" class="thread-icon" />
                    <span class="name">{{ thread.name }}</span>
                </li>
                </template>
            </ul>
        </div>
    </div>
    <MessageContextMenu
        :visible="channelMenu !== null"
        :x="channelMenu?.x ?? 0"
        :y="channelMenu?.y ?? 0"
        :actions="channelMenuActions"
        @pick="onChannelMenuPick"
        @close="channelMenu = null"
    />
</template>

<style scoped>
.sidebar {
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    min-height: 0;
}
.sidebar-header {
    display: flex;
    align-items: center;
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
.channel-tree {
    flex: 1;
    overflow-y: auto;
}
.category-header {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    width: 100%;
    padding: 0.55rem 0.75rem 0.25rem;
    background: none;
    border: none;
    color: var(--text-muted);
    font: inherit;
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 0.05em;
    cursor: pointer;
    text-align: left;
}
.category-header:hover { color: var(--text); }
.chevron {
    font-size: 0.8rem;
    transition: transform 0.15s;
    transform: rotate(90deg);
}
.chevron.collapsed { transform: rotate(0deg); }
.channel-list {
    list-style: none;
    margin: 0;
    padding: .7rem .2rem;
}
.channel-list li {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.3rem 0.75rem 0.3rem 1.25rem;
    cursor: pointer;
    border-radius: 4px;
    margin: 0 0.25rem;
}
.channel-list li:hover { background: var(--bg-surface-hover); }
.channel-list li.active { background: var(--bg-surface-active); }
.hash { color: var(--text-muted); font-weight: 600; font-size: 0.9rem; flex-shrink: 0; }
.kind-icon { color: var(--text-muted); flex-shrink: 0; }
.channel-list li.active .kind-icon,
.channel-list li:hover .kind-icon { color: var(--text); }
.name {
    font-size: 0.875rem;
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.channel-list li.active .name,
.channel-list li:hover .name { color: var(--text); }
.channel-list li.unread .name {
    color: var(--text-strong);
    font-weight: 700;
}
.channel-list li.unread .hash { color: var(--text-strong); }
.channel-list li.muted { opacity: 0.55; }
.channel-list li.muted:hover { opacity: 0.85; }
.channel-list li.muted.active { opacity: 1; }
.channel-pill { margin-left: auto; }
.mute-icon { margin-left: auto; color: var(--text-muted); }
.thread-row {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.2rem 0.6rem 0.2rem 1.6rem;
    color: var(--text-muted);
    font-size: 0.78rem;
    cursor: pointer;
}
.thread-row:hover { background: var(--bg-surface-hover); color: var(--text); }
.thread-row.active { background: var(--bg-surface-active); color: var(--text); }
.thread-icon { color: var(--text-muted); flex-shrink: 0; }

.voice-count {
    margin-left: auto;
    font-variant-numeric: tabular-nums;
    background: var(--bg-surface-2);
    border-radius: 999px;
    padding: 0 0.45rem;
    font-size: 0.72rem;
    color: var(--text-muted);
}
.voice-members-wrap {
    display: block;
    padding: 0;
    margin: 0;
    cursor: default;
    background: transparent;
}
.voice-members-wrap:hover { background: transparent; }
.voice-members {
    list-style: none;
    margin: 0;
    padding: 0 0.6rem 0.2rem 2.4rem;
}
.voice-members .voice-member {
    /* Reset the .channel-list li shared rules so member rows are
     * passive labels instead of clickable channel rows. */
    padding: 0.1rem 0;
    margin: 0;
    cursor: default;
    border-radius: 0;
    background: transparent;
}
.voice-members .voice-member:hover { background: transparent; }
.voice-member {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.1rem 0;
    color: var(--text-muted);
    font-size: 0.78rem;
}
.voice-avatar {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    object-fit: cover;
}
.voice-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.muted { color: var(--text-muted); font-size: 0.9rem; }
.empty { padding: 1rem; }
.loading { padding: 1rem; text-align: center; }
</style>
