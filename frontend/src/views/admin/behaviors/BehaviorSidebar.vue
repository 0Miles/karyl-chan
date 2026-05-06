<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { Icon } from '@iconify/vue';
import type { BehaviorTargetSummary } from '../../../api/behavior';

const { t } = useI18n();

/**
 * BehaviorSidebar v2 — M1-D1
 *
 * 設計依據 D-ui §1.2（CR-9 移除 source filter；H-2 標題改「對象 (Audience)」）：
 * - 標題從「Target (scope)」改為「對象 (Audience)」
 * - 移除 source filter-chip row（CR-9 用戶覆寫）
 * - all_dms 釘頂，其餘 user/group 保持 API 回傳順序
 * - 「+ 新增」按鈕觸發 AddBehaviorModal（emit 'add'）
 */

const props = defineProps<{
    targets: BehaviorTargetSummary[];
    selectedId: number | null;
    loading?: boolean;
    canAddTarget?: boolean;
}>();

const emit = defineEmits<{
    (e: 'select', targetId: number): void;
    (e: 'add'): void;
}>();

const allDmsTarget = computed(() => props.targets.find(t => t.kind === 'all_dms') ?? null);
const otherTargets = computed(() => props.targets.filter(t => t.kind !== 'all_dms'));

function labelFor(target: BehaviorTargetSummary): string {
    if (target.kind === 'all_dms') return t('behaviors.sidebar.allDms');
    if (target.kind === 'user') {
        return target.profile?.globalName ?? target.profile?.username ?? target.userId ?? '?';
    }
    return target.groupName ?? '?';
}
</script>

<template>
    <header class="sidebar-header">
        <span class="title">{{ t('behaviors.sidebar.title') }}</span>
        <button
            v-if="canAddTarget"
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

    <div v-if="loading && targets.length === 0" class="loading muted">
        {{ t('common.loading') }}
    </div>

    <ul v-else class="target-list">
        <!-- all_dms 釘頂 -->
        <li
            v-if="allDmsTarget"
            :class="['target-row', 'pinned', { active: selectedId === allDmsTarget.id }]"
            @click="emit('select', allDmsTarget.id)"
        >
            <div class="avatar avatar-fallback all-dms" aria-hidden="true">
                <Icon icon="material-symbols:forum-outline-rounded" width="18" height="18" />
            </div>
            <div class="meta">
                <div class="name">{{ labelFor(allDmsTarget) }}</div>
                <div class="sub">{{ t('behaviors.sidebar.allDmsHint') }}</div>
            </div>
        </li>

        <!-- user / group targets -->
        <li
            v-for="target in otherTargets"
            :key="target.id"
            :class="['target-row', { active: selectedId === target.id }]"
            @click="emit('select', target.id)"
        >
            <template v-if="target.kind === 'user'">
                <img
                    v-if="target.profile?.avatarUrl"
                    :src="target.profile.avatarUrl"
                    alt=""
                    class="avatar"
                />
                <div v-else class="avatar avatar-fallback">
                    {{ labelFor(target).charAt(0).toUpperCase() }}
                </div>
                <div class="meta">
                    <div class="name">{{ labelFor(target) }}</div>
                    <div class="sub">{{ t('behaviors.sidebar.userKindHint') }}</div>
                </div>
            </template>
            <template v-else>
                <div class="avatar avatar-fallback group">
                    <Icon icon="material-symbols:groups-outline-rounded" width="18" height="18" />
                </div>
                <div class="meta">
                    <div class="name">{{ labelFor(target) }}</div>
                    <div class="sub">
                        {{ t('behaviors.sidebar.groupMemberCount', { count: target.memberCount ?? 0 }) }}
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
