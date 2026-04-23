<script setup lang="ts">
import { ref } from 'vue';
import type { GuildChannelCategory, GuildSummary } from '../../../api/guilds';
import ModeSelect from './ModeSelect.vue';

defineProps<{
    guilds: GuildSummary[];
    mode: string;
    categories: GuildChannelCategory[];
    selectedId: string | null;
    loading?: boolean;
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
</script>

<template>
    <aside class="sidebar">
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
                    @click="toggleCategory(cat.id)"
                >
                    <span class="chevron" :class="{ collapsed: isCategoryCollapsed(cat.id) }">›</span>
                    {{ cat.name.toUpperCase() }}
                </button>
                <ul v-if="!isCategoryCollapsed(cat.id)" class="channel-list">
                    <li
                        v-for="channel in cat.channels"
                        :key="channel.id"
                        :class="{ active: channel.id === selectedId }"
                        @click="emit('select', channel.id)"
                    >
                        <span class="hash">#</span>
                        <span class="name">{{ channel.name }}</span>
                    </li>
                </ul>
            </div>
        </div>
    </aside>
</template>

<style scoped>
.sidebar {
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    overflow: hidden;
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
    padding: 0.6rem 0.75rem;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
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
.muted { color: var(--text-muted); font-size: 0.9rem; }
.empty { padding: 1rem; }
.loading { padding: 1rem; text-align: center; }
</style>
