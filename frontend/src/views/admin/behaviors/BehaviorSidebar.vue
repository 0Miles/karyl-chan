<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { Icon } from '@iconify/vue';
import type { ScopeTabRow } from '../../../api/behavior';
import { useUserSummaries } from '../../../composables/use-user-summaries';

const { t } = useI18n();

const props = defineProps<{
    tabs: ScopeTabRow[];
    selectedTabId: number | null;
    loading?: boolean;
    canAdd?: boolean;
}>();

const emit = defineEmits<{
    (e: 'select', tabId: number): void;
    (e: 'add'): void;
}>();

// ── Section grouping ─────────────────────────────────────────────────────────

const topTabs = computed(() =>
    props.tabs.filter(t => ['global_all', 'all_dms', 'all_bot_dms'].includes(t.tabType))
);

const guildTabs = computed(() =>
    props.tabs.filter(t => ['all_guilds', 'specific_guild', 'specific_channel'].includes(t.tabType))
);

const dmTabs = computed(() =>
    props.tabs.filter(t => ['specific_user', 'specific_group'].includes(t.tabType))
);

// ── Collapsible state ────────────────────────────────────────────────────────

const guildOpen = ref(true);
const dmOpen = ref(true);

// ── User display name resolution ─────────────────────────────────────────────

const userIds = computed(() =>
    props.tabs.filter(t => t.tabType === 'specific_user' && t.userId).map(t => t.userId!)
);
const { getDisplayName } = useUserSummaries(userIds);

// ── Label helpers ────────────────────────────────────────────────────────────

function iconFor(tab: ScopeTabRow): string {
    switch (tab.tabType) {
        case 'global_all': return 'material-symbols:public-rounded';
        case 'all_dms': return 'material-symbols:forum-outline-rounded';
        case 'all_bot_dms': return 'material-symbols:smart-toy-outline-rounded';
        case 'all_guilds': return 'material-symbols:dns-outline-rounded';
        case 'specific_guild': return 'material-symbols:shield-outline-rounded';
        case 'specific_channel': return 'material-symbols:tag-rounded';
        case 'specific_user': return 'material-symbols:person-outline-rounded';
        case 'specific_group': return 'material-symbols:groups-outline-rounded';
    }
}

function labelFor(tab: ScopeTabRow): string {
    switch (tab.tabType) {
        case 'global_all': return t('behaviors.sidebar.globalAll');
        case 'all_dms': return t('behaviors.sidebar.allDms');
        case 'all_bot_dms': return t('behaviors.sidebar.allBotDms');
        case 'all_guilds': return t('behaviors.sidebar.allGuilds');
        case 'specific_guild': return tab.label || tab.guildId || '?';
        case 'specific_channel': return tab.label || tab.channelId || '?';
        case 'specific_user': {
            const name = tab.userId ? getDisplayName(tab.userId) : null;
            return name ?? tab.label ?? tab.userId ?? '?';
        }
        case 'specific_group': return tab.label || tab.groupName || '?';
    }
}

function subtextFor(tab: ScopeTabRow): string {
    const count = tab.behaviorCount;
    switch (tab.tabType) {
        case 'global_all': return t('behaviors.sidebar.globalAllHint');
        case 'all_dms': return t('behaviors.sidebar.allDmsHint');
        case 'all_bot_dms': return t('behaviors.sidebar.allBotDmsHint');
        case 'all_guilds': return t('behaviors.sidebar.allGuildsHint');
        default:
            return t('behaviors.sidebar.behaviorCount', { count });
    }
}

function avatarClassFor(tab: ScopeTabRow): string {
    if (tab.tabType === 'global_all') return 'avatar-fallback all-scope';
    if (tab.tabType === 'all_dms' || tab.tabType === 'all_bot_dms') return 'avatar-fallback all-dms';
    if (tab.tabType.startsWith('specific_guild') || tab.tabType === 'all_guilds' || tab.tabType === 'specific_channel') return 'avatar-fallback guild';
    if (tab.tabType === 'specific_group') return 'avatar-fallback group';
    return 'avatar-fallback';
}
</script>

<template>
    <header class="sidebar-header">
        <span class="title">{{ t('behaviors.sidebar.title') }}</span>
        <button
            v-if="canAdd"
            type="button"
            class="ghost"
            :title="t('behaviors.sidebar.addTabTooltip')"
            :aria-label="t('behaviors.sidebar.addTabTooltip')"
            @click="emit('add')"
        >
            <Icon icon="material-symbols:add-rounded" width="20" height="20" />
        </button>
    </header>

    <div v-if="loading && tabs.length === 0" class="loading muted">
        {{ t('common.loading') }}
    </div>

    <template v-else>
        <!-- Top-level fixed tabs -->
        <ul class="tab-list">
            <li
                v-for="tab in topTabs"
                :key="tab.id"
                :class="['tab-row', 'pinned', { active: selectedTabId === tab.id }]"
                @click="emit('select', tab.id)"
            >
                <div :class="['avatar', avatarClassFor(tab)]" aria-hidden="true">
                    <Icon :icon="iconFor(tab)" width="18" height="18" />
                </div>
                <div class="meta">
                    <div class="name">{{ labelFor(tab) }}</div>
                    <div class="sub">{{ subtextFor(tab) }}</div>
                </div>
            </li>
        </ul>

        <!-- Guild section -->
        <div class="section-header" @click="guildOpen = !guildOpen">
            <Icon
                :icon="guildOpen ? 'material-symbols:expand-more-rounded' : 'material-symbols:chevron-right-rounded'"
                width="18" height="18"
            />
            <span class="section-label">{{ t('behaviors.sidebar.guildSection') }}</span>
        </div>
        <ul v-show="guildOpen" class="tab-list">
            <li
                v-for="tab in guildTabs"
                :key="tab.id"
                :class="['tab-row', { active: selectedTabId === tab.id, pinned: tab.isFixed }]"
                @click="emit('select', tab.id)"
            >
                <div :class="['avatar', avatarClassFor(tab)]" aria-hidden="true">
                    <Icon :icon="iconFor(tab)" width="18" height="18" />
                </div>
                <div class="meta">
                    <div class="name">{{ labelFor(tab) }}</div>
                    <div class="sub">{{ subtextFor(tab) }}</div>
                </div>
            </li>
            <li v-if="guildTabs.length === 0" class="empty-hint">
                {{ t('behaviors.sidebar.noGuildTabs') }}
            </li>
        </ul>

        <!-- Bot DM section -->
        <div class="section-header" @click="dmOpen = !dmOpen">
            <Icon
                :icon="dmOpen ? 'material-symbols:expand-more-rounded' : 'material-symbols:chevron-right-rounded'"
                width="18" height="18"
            />
            <span class="section-label">{{ t('behaviors.sidebar.dmSection') }}</span>
        </div>
        <ul v-show="dmOpen" class="tab-list">
            <li
                v-for="tab in dmTabs"
                :key="tab.id"
                :class="['tab-row', { active: selectedTabId === tab.id }]"
                @click="emit('select', tab.id)"
            >
                <div :class="['avatar', avatarClassFor(tab)]" aria-hidden="true">
                    <Icon :icon="iconFor(tab)" width="18" height="18" />
                </div>
                <div class="meta">
                    <div class="name">{{ labelFor(tab) }}</div>
                    <div class="sub">{{ subtextFor(tab) }}</div>
                </div>
            </li>
            <li v-if="dmTabs.length === 0" class="empty-hint">
                {{ t('behaviors.sidebar.noDmTabs') }}
            </li>
        </ul>
    </template>
</template>

<style scoped>
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
    .sidebar-header { height: auto; }
}
.title {
    font-weight: 600;
    color: var(--text-strong);
}
.ghost {
    flex-shrink: 0;
    background: none;
    border: 1px solid var(--border);
    border-radius: var(--radius-base);
    width: 32px;
    height: 32px;
    cursor: pointer;
    color: var(--text);
    display: inline-flex;
    align-items: center;
    justify-content: center;
}
.ghost:hover { background: var(--bg-surface-hover); }

.section-header {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.45rem 0.75rem 0.2rem;
    cursor: pointer;
    user-select: none;
    color: var(--text-muted);
}
.section-header:hover { color: var(--text); }
.section-label {
    font-size: 0.72rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
}

.tab-list {
    list-style: none;
    margin: 0;
    padding: 0;
}
.tab-row {
    display: flex;
    gap: 0.6rem;
    padding: 0.55rem 0.75rem;
    cursor: pointer;
    border-bottom: 1px solid var(--border);
    align-items: center;
}
.tab-row:hover { background: var(--bg-surface-hover); }
.tab-row.active { background: var(--bg-surface-active); }
.tab-row.pinned { background: var(--bg-surface-hover); }
.tab-row.pinned.active { background: var(--bg-surface-active); }
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
.avatar-fallback.all-scope {
    background: var(--accent-bg);
    color: var(--accent-text-strong);
}
.avatar-fallback.all-dms {
    background: var(--accent-bg);
    color: var(--accent-text-strong);
}
.avatar-fallback.guild {
    background: var(--success-bg, var(--accent-bg));
    color: var(--success-text, var(--accent-text-strong));
}
.avatar-fallback.group {
    background: var(--warn-bg);
    color: var(--warn-text);
}
.meta { flex: 1; min-width: 0; }
.name {
    font-weight: 500;
    color: var(--text-strong);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.sub {
    font-size: 0.78rem;
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.empty-hint {
    padding: 0.5rem 0.75rem;
    font-size: 0.82rem;
    color: var(--text-muted);
    font-style: italic;
}
.muted { color: var(--text-muted); font-size: 0.9rem; }
.loading { padding: 1rem; text-align: center; }
</style>
