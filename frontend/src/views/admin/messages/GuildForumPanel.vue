<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Icon } from '@iconify/vue';
import { listGuildForums, type GuildForumPost } from '../../../api/guilds';

const props = defineProps<{
    guildId: string;
    forumId: string;
    forumName: string | null;
    headerSubtitle?: string | null;
}>();

const emit = defineEmits<{
    (e: 'select-post', postId: string): void;
    /** Surfaced so the workspace can mark these ids as valid selection
     *  targets — without it the workspace machine would reject the
     *  follow-up SELECT_CHANNEL when the user clicks a post. */
    (e: 'posts-loaded', postIds: string[]): void;
}>();

const posts = ref<GuildForumPost[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);

async function load() {
    loading.value = true;
    error.value = null;
    const guildId = props.guildId;
    const forumId = props.forumId;
    try {
        // The /forums endpoint returns every forum in the guild — we filter
        // client-side because the backend lacks a per-forum lookup and adding
        // one would duplicate logic. Forum lists are small enough for this.
        const forums = await listGuildForums(guildId);
        if (props.guildId !== guildId || props.forumId !== forumId) return;
        const fresh = forums.find(f => f.id === forumId)?.posts ?? [];
        posts.value = fresh;
        emit('posts-loaded', fresh.map(p => p.id));
    } catch (err) {
        if (props.guildId !== guildId || props.forumId !== forumId) return;
        error.value = err instanceof Error ? err.message : 'Failed to load forum posts';
    } finally {
        loading.value = false;
    }
}

watch(() => [props.guildId, props.forumId] as const, () => { void load(); }, { immediate: true });

const sortedPosts = computed(() =>
    [...posts.value].sort((a, b) => Number(b.archived) - Number(a.archived) === 0
        ? a.name.localeCompare(b.name)
        : Number(a.archived) - Number(b.archived))
);
</script>

<template>
    <div class="forum-panel">
        <header class="forum-header">
            <Icon icon="material-symbols:forum-outline-rounded" width="18" height="18" class="forum-icon" />
            <span class="title">{{ forumName ?? '' }}</span>
            <span v-if="headerSubtitle" class="subtitle">{{ headerSubtitle }}</span>
        </header>
        <div class="forum-body">
            <p v-if="loading" class="muted center">{{ $t('common.loading') }}</p>
            <p v-else-if="error" class="error">{{ error }}</p>
            <p v-else-if="sortedPosts.length === 0" class="muted center">{{ $t('messages.noForumPosts') }}</p>
            <ul v-else class="post-list">
                <li
                    v-for="post in sortedPosts"
                    :key="post.id"
                    class="post-row"
                    @click="emit('select-post', post.id)"
                >
                    <Icon icon="material-symbols:topic-outline-rounded" width="16" height="16" class="post-icon" />
                    <span class="post-name">{{ post.name }}</span>
                    <span v-if="post.messageCount > 0" class="post-count">{{ post.messageCount }}</span>
                    <span v-if="post.archived" class="post-archived">{{ $t('common.archived') }}</span>
                </li>
            </ul>
        </div>
    </div>
</template>

<style scoped>
.forum-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    background: var(--bg);
}
.forum-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.6rem 1rem;
    border-bottom: 1px solid var(--border);
    height: 54px;
    flex-shrink: 0;
}
.forum-icon { color: var(--text-muted); }
.title { font-weight: 600; color: var(--text); }
.subtitle { font-size: 0.78rem; color: var(--text-muted); margin-left: 0.4rem; }
.forum-body {
    flex: 1;
    overflow-y: auto;
    padding: 0.6rem;
}
.post-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
}
.post-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.55rem 0.75rem;
    border-radius: 6px;
    cursor: pointer;
    background: var(--bg-surface);
    border: 1px solid var(--border);
    color: var(--text);
}
.post-row:hover { background: var(--bg-surface-hover); }
.post-icon { color: var(--text-muted); flex-shrink: 0; }
.post-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.post-count {
    font-variant-numeric: tabular-nums;
    background: var(--bg-surface-2);
    border-radius: 999px;
    padding: 0 0.5rem;
    font-size: 0.72rem;
    color: var(--text-muted);
}
.post-archived {
    font-size: 0.72rem;
    color: var(--text-muted);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 0 0.4rem;
}
.muted { color: var(--text-muted); }
.center { text-align: center; padding: 1.5rem 0; }
.error { color: var(--danger); padding: 0.8rem; }
</style>
