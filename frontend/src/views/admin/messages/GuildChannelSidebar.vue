<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import {
    listGuildActiveThreads,
    listGuildForums,
    listGuildVoiceChannels,
    type GuildActiveThread,
    type GuildChannelCategory,
    type GuildForum,
    type GuildSummary,
    type GuildVoiceCategory
} from '../../../api/guilds';
import { useUnreadStore } from '../../../modules/discord-chat/stores/unreadStore';
import { useMuteStore } from '../../../modules/discord-chat/stores/muteStore';
import UnreadPill from '../../../components/UnreadPill.vue';
import ModeSelect from './ModeSelect.vue';
import { Icon } from '@iconify/vue';

const unreadStore = useUnreadStore();
const muteStore = useMuteStore();

const props = defineProps<{
    guilds: GuildSummary[];
    mode: string;
    categories: GuildChannelCategory[];
    selectedId: string | null;
    loading?: boolean;
    /** Guild whose voice channels we should load. When omitted (e.g.
     *  callers that only want text channels), the voice section is
     *  suppressed entirely. */
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

// Voice channels load lazily and refresh when the guild changes. We
// don't track them through any store yet — the sidebar is the only
// consumer, and the data is small enough to refetch on focus.
const voiceCategories = ref<GuildVoiceCategory[]>([]);
const voiceLoading = ref(false);
const voiceError = ref<string | null>(null);

async function loadVoice() {
    if (!props.guildId) return;
    voiceLoading.value = true;
    voiceError.value = null;
    const guildId = props.guildId;
    try {
        const result = await listGuildVoiceChannels(guildId);
        if (props.guildId !== guildId) return;
        voiceCategories.value = result;
    } catch (err) {
        if (props.guildId !== guildId) return;
        voiceError.value = err instanceof Error ? err.message : 'Failed to load voice channels';
    } finally {
        voiceLoading.value = false;
    }
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

const forums = ref<GuildForum[]>([]);
async function loadForums() {
    if (!props.guildId) return;
    const guildId = props.guildId;
    try {
        const result = await listGuildForums(guildId);
        if (props.guildId !== guildId) return;
        forums.value = result;
    } catch {
        /* forums are a nicety; silently fail */
    }
}

onMounted(() => { void loadVoice(); void loadThreads(); void loadForums(); });
watch(() => props.guildId, () => {
    voiceCategories.value = [];
    threadsByParent.value = {};
    forums.value = [];
    void loadVoice();
    void loadThreads();
    void loadForums();
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
                    :class="{
                        active: channel.id === selectedId,
                        unread: (muteStore.showsCount(channel.id) && unreadStore.hasChannelUnread(channel.id))
                            || (muteStore.showsMention(channel.id) && unreadStore.getChannelMentionCount(channel.id) > 0),
                        muted: muteStore.isMuted(channel.id)
                    }"
                    @click="emit('select', channel.id)">
                    <span class="hash">#</span>
                    <span class="name">{{ channel.name }}</span>
                    <Icon v-if="muteStore.isMuted(channel.id)" icon="material-symbols:notifications-off-outline-rounded" width="14" height="14" class="mute-icon" />
                    <!-- Mention pill stays visible when 'mentions-only';
                         only hidden in the fully-silent 'none' level. -->
                    <UnreadPill v-if="muteStore.showsMention(channel.id)" class="channel-pill" :count="unreadStore.getChannelMentionCount(channel.id)" />
                </li>
                <li
                    v-for="thread in threadsFor(channel.id)"
                    :key="thread.id"
                    :class="['thread-row', { active: thread.id === selectedId }]"
                    @click="emit('select', thread.id)"
                >
                    <Icon icon="material-symbols:forum-outline-rounded" width="12" height="12" class="thread-icon" />
                    <span class="name">{{ thread.name }}</span>
                </li>
                </template>
            </ul>
        </div>
        <section v-if="forums.length > 0" class="voice-section">
            <h4 class="voice-section-title">{{ $t('messages.forumChannels') }}</h4>
            <div v-for="forum in forums" :key="'fo-' + forum.id" class="category">
                <h5 class="voice-category-header">{{ forum.name.toUpperCase() }}</h5>
                <ul v-if="forum.posts.length > 0" class="voice-list">
                    <li
                        v-for="post in forum.posts"
                        :key="post.id"
                        :class="['thread-row', { active: post.id === selectedId }]"
                        @click="emit('select', post.id)"
                    >
                        <Icon icon="material-symbols:topic-outline-rounded" width="12" height="12" class="thread-icon" />
                        <span class="name">{{ post.name }}</span>
                    </li>
                </ul>
                <p v-else class="muted forum-empty">{{ $t('messages.noForumPosts') }}</p>
            </div>
        </section>
        <section v-if="voiceCategories.length > 0" class="voice-section">
            <h4 class="voice-section-title">{{ $t('messages.voiceChannels') }}</h4>
            <div v-for="cat in voiceCategories" :key="'v-' + (cat.id ?? '__none__')" class="category">
                <h5 v-if="cat.name" class="voice-category-header">{{ cat.name.toUpperCase() }}</h5>
                <ul class="voice-list">
                    <li v-for="channel in cat.channels" :key="channel.id" class="voice-channel">
                        <div class="voice-channel-row">
                            <Icon
                                :icon="channel.type === 'stage' ? 'material-symbols:campaign-outline-rounded' : 'material-symbols:volume-up-outline-rounded'"
                                width="14" height="14"
                                class="voice-icon"
                            />
                            <span class="name">{{ channel.name }}</span>
                            <span v-if="channel.members.length > 0" class="voice-count">{{ channel.members.length }}</span>
                        </div>
                        <ul v-if="channel.members.length > 0" class="voice-members">
                            <li v-for="m in channel.members" :key="m.id" class="voice-member" :title="m.username">
                                <img v-if="m.avatarUrl" :src="m.avatarUrl" alt="" class="voice-avatar" />
                                <span class="voice-name">{{ m.nickname ?? m.globalName ?? m.username }}</span>
                            </li>
                        </ul>
                    </li>
                </ul>
            </div>
        </section>
        <p v-else-if="voiceError" class="muted voice-error">{{ voiceError }}</p>
    </div>
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

.voice-section { margin-top: 0.4rem; padding: 0.4rem 0; border-top: 1px solid var(--border); }
.voice-section-title {
    margin: 0 0 0.3rem;
    padding: 0 0.6rem;
    font-size: 0.7rem;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-weight: 600;
}
.voice-category-header {
    margin: 0.3rem 0 0.15rem;
    padding: 0 0.6rem;
    font-size: 0.7rem;
    color: var(--text-muted);
    font-weight: 500;
}
.voice-list { list-style: none; margin: 0; padding: 0; }
.voice-channel { padding: 0.1rem 0; }
.voice-channel-row {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.25rem 0.6rem;
    color: var(--text);
    font-size: 0.85rem;
}
.voice-icon { color: var(--text-muted); }
.voice-count {
    margin-left: auto;
    font-variant-numeric: tabular-nums;
    background: var(--bg-surface-2);
    border-radius: 999px;
    padding: 0 0.45rem;
    font-size: 0.72rem;
    color: var(--text-muted);
}
.voice-members { list-style: none; margin: 0; padding: 0 0.6rem 0.2rem 1.6rem; }
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
.voice-error { padding: 0.6rem; font-size: 0.78rem; color: var(--danger); }
.forum-empty { padding: 0.2rem 0.6rem; font-size: 0.78rem; color: var(--text-muted); }
.muted { color: var(--text-muted); font-size: 0.9rem; }
.empty { padding: 1rem; }
.loading { padding: 1rem; text-align: center; }
</style>
