<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { Icon } from '@iconify/vue';
import type { AudienceEntry } from '../../../api/behavior';
import { useUserSummaries } from '../../../composables/use-user-summaries';

const { t } = useI18n();

/**
 * BehaviorSidebar v2 — 使用 AudienceEntry（audience-summary 推導）
 *
 * 移除 v1 BehaviorTargetSummary 依賴。
 * - all 釘頂
 * - user / group 依後端回傳順序
 * - 「+ 新增」= 開 AddBehaviorModal（emit 'add'）
 */

const props = defineProps<{
    audiences: AudienceEntry[];
    selectedKey: string | null;
    loading?: boolean;
    canAdd?: boolean;
}>();

const emit = defineEmits<{
    (e: 'select', key: string): void;
    (e: 'add'): void;
}>();

const allEntry = computed(() => props.audiences.find(a => a.kind === 'all') ?? null);
const otherEntries = computed(() => props.audiences.filter(a => a.kind !== 'all'));

// Batch-resolve user display names via the shared user-summary store.
const userIds = computed(() =>
    props.audiences.filter(a => a.kind === 'user' && a.userId).map(a => a.userId!)
);
const { getDisplayName } = useUserSummaries(userIds);

function labelFor(entry: AudienceEntry): string {
    if (entry.kind === 'all') return t('behaviors.sidebar.allDms');
    if (entry.kind === 'user') {
        const name = entry.userId ? getDisplayName(entry.userId) : null;
        return name ?? entry.userId ?? '?';
    }
    return entry.groupName ?? '?';
}
</script>

<template>
    <header class="sidebar-header">
        <span class="title">{{ t('behaviors.sidebar.title') }}</span>
        <button
            v-if="canAdd"
            type="button"
            class="ghost"
            :title="t('behaviors.sidebar.addTooltip')"
            :aria-label="t('behaviors.sidebar.addTooltip')"
            @click="emit('add')"
        >
            <Icon icon="material-symbols:add-rounded" width="20" height="20" />
        </button>
    </header>

    <!-- 對象 (Audience) 分類標題 -->
    <div class="section-label">{{ t('behaviors.sidebar.audienceLabel') }}</div>

    <div v-if="loading && audiences.length === 0" class="loading muted">
        {{ t('common.loading') }}
    </div>

    <ul v-else class="target-list">
        <!-- all 釘頂 -->
        <li
            v-if="allEntry"
            :class="['target-row', 'pinned', { active: selectedKey === allEntry.key }]"
            @click="emit('select', allEntry.key)"
        >
            <div class="avatar avatar-fallback all-dms" aria-hidden="true">
                <Icon icon="material-symbols:forum-outline-rounded" width="18" height="18" />
            </div>
            <div class="meta">
                <div class="name">{{ labelFor(allEntry) }}</div>
                <div class="sub">{{ t('behaviors.sidebar.allDmsHint') }}</div>
            </div>
        </li>

        <!-- user / group audiences -->
        <li
            v-for="entry in otherEntries"
            :key="entry.key"
            :class="['target-row', { active: selectedKey === entry.key }]"
            @click="emit('select', entry.key)"
        >
            <template v-if="entry.kind === 'user'">
                <div class="avatar avatar-fallback">
                    {{ labelFor(entry).charAt(0).toUpperCase() }}
                </div>
                <div class="meta">
                    <div class="name">{{ labelFor(entry) }}</div>
                    <div class="sub">{{ t('behaviors.sidebar.userKindHint') }}</div>
                </div>
            </template>
            <template v-else>
                <div class="avatar avatar-fallback group">
                    <Icon icon="material-symbols:groups-outline-rounded" width="18" height="18" />
                </div>
                <div class="meta">
                    <div class="name">{{ labelFor(entry) }}</div>
                    <div class="sub">
                        {{ t('behaviors.sidebar.behaviorCount', { count: entry.behaviorCount }) }}
                    </div>
                </div>
            </template>
        </li>
    </ul>
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

.section-label {
    padding: 0.45rem 0.75rem 0.2rem;
    font-size: 0.72rem;
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
}

.target-list {
    list-style: none;
    margin: 0;
    padding: 0;
}
.target-row {
    display: flex;
    gap: 0.6rem;
    padding: 0.55rem 0.75rem;
    cursor: pointer;
    border-bottom: 1px solid var(--border);
    align-items: center;
}
.target-row:hover { background: var(--bg-surface-hover); }
.target-row.active { background: var(--bg-surface-active); }
.target-row.pinned { background: var(--bg-surface-hover); }
.target-row.pinned.active { background: var(--bg-surface-active); }
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
.avatar-fallback.all-dms {
    background: var(--accent-bg);
    color: var(--accent-text-strong);
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
.muted { color: var(--text-muted); font-size: 0.9rem; }
.loading { padding: 1rem; text-align: center; }
</style>
