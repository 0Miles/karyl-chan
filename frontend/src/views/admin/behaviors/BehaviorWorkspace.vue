<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, useTemplateRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { Icon } from '@iconify/vue';
import Sortable from 'sortablejs';
import BehaviorCard from './BehaviorCard.vue';
import {
    listBehaviors,
    reorderBehaviors,
    deleteTarget,
    addGroupMember,
    removeGroupMember,
    listGroupMembers,
    renameGroupTarget,
    type BehaviorRow,
    type BehaviorAudienceKind,
    type BehaviorTargetSummary,
    type BehaviorGroupMember,
} from '../../../api/behavior';
import { listPlugins, type PluginRecord } from '../../../api/plugins';

/**
 * BehaviorWorkspace v2 — M1-D1
 *
 * 依 D-ui §1.3/§1.4 實作：
 * - 列出當前 audience target 下的所有 behaviors（依 sortOrder ASC）
 * - system behaviors 固定釘頂（不在 sortable container）
 * - custom behaviors 可拖曳排序
 * - 各卡片依 source 顯示不同 form
 * - 不內建 AddBehavior 邏輯（由 BehaviorsPage 透過 AddBehaviorModal 處理）
 */

const { t } = useI18n();

const props = defineProps<{
    target: BehaviorTargetSummary;
    targets: BehaviorTargetSummary[];
    canManageCatalog?: boolean;
}>();

const emit = defineEmits<{
    (e: 'target-deleted', id: number): void;
    (e: 'group-member-changed', id: number, count: number): void;
    (e: 'group-renamed', id: number, name: string): void;
    (e: 'add-behavior'): void;
}>();

// ── behaviors 資料 ────────────────────────────────────────────────────────────

const behaviors = ref<BehaviorRow[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);
const newlyCreatedId = ref<number | null>(null);
const listRef = useTemplateRef<HTMLElement>('listRef');
let sortable: Sortable | null = null;

// 依 audienceKind 對應到 API filter
function audienceKindFromTarget(target: BehaviorTargetSummary): BehaviorAudienceKind {
    if (target.kind === 'all_dms') return 'all';
    if (target.kind === 'user') return 'user';
    return 'group';
}

async function load(target: BehaviorTargetSummary) {
    loading.value = true;
    error.value = null;
    try {
        // 先篩 audienceKind，再在前端依 audienceUserId/audienceGroupName 進一步過濾
        const audienceKind = audienceKindFromTarget(target);
        const all = await listBehaviors({ audienceKind });

        if (audienceKind === 'user' && target.userId) {
            behaviors.value = all.filter(b => b.audienceUserId === target.userId);
        } else if (audienceKind === 'group' && target.groupName) {
            behaviors.value = all.filter(b => b.audienceGroupName === target.groupName);
        } else {
            behaviors.value = all;
        }
    } catch (err) {
        error.value = err instanceof Error ? err.message : String(err);
    } finally {
        loading.value = false;
    }
    if (target.kind === 'group') void loadMembers(target.id);
}

watch(() => props.target.id, () => {
    teardownSortable();
    void load(props.target);
}, { immediate: true });

// ── plugin list ───────────────────────────────────────────────────────────────

const plugins = ref<PluginRecord[]>([]);
async function loadPlugins() {
    try { plugins.value = await listPlugins(); }
    catch { plugins.value = []; }
}
void loadPlugins();

// ── sortable ──────────────────────────────────────────────────────────────────

const systemBehaviors = computed(() => behaviors.value.filter(b => b.source === 'system'));
const customBehaviors = computed(() => behaviors.value.filter(b => b.source === 'custom'));
const pluginBehaviors = computed(() => behaviors.value.filter(b => b.source === 'plugin'));

function teardownSortable() {
    if (sortable) { sortable.destroy(); sortable = null; }
}

async function ensureSortable() {
    teardownSortable();
    if (!listRef.value) return;
    sortable = Sortable.create(listRef.value, {
        animation: 150,
        handle: '.drag-handle',
        ghostClass: 'sortable-ghost',
        onEnd: async (evt) => {
            const { oldIndex, newIndex } = evt;
            if (oldIndex == null || newIndex == null || oldIndex === newIndex) return;
            const list = customBehaviors.value.slice();
            const [moved] = list.splice(oldIndex, 1);
            list.splice(newIndex, 0, moved);
            const previous = behaviors.value;
            behaviors.value = [
                ...systemBehaviors.value,
                ...pluginBehaviors.value,
                ...list,
            ];
            try {
                await reorderBehaviors(list.map(b => b.id));
            } catch (err) {
                error.value = err instanceof Error ? err.message : String(err);
                behaviors.value = previous;
            }
        }
    });
}

watch(behaviors, async () => {
    await nextTick();
    void ensureSortable();
});

onBeforeUnmount(teardownSortable);

// ── event handlers ────────────────────────────────────────────────────────────

function onUpdated(row: BehaviorRow) {
    behaviors.value = behaviors.value.map(b => b.id === row.id ? row : b);
}

function onDeleted(id: number) {
    behaviors.value = behaviors.value.filter(b => b.id !== id);
}

async function onDeleteTarget() {
    if (props.target.kind === 'all_dms') return;
    const label = props.target.kind === 'user'
        ? props.target.profile?.globalName ?? props.target.profile?.username ?? props.target.userId ?? '?'
        : props.target.groupName ?? '?';
    if (!window.confirm(t('behaviors.workspace.deleteTargetConfirm', { label }))) return;
    try {
        await deleteTarget(props.target.id);
        emit('target-deleted', props.target.id);
    } catch (err) {
        error.value = err instanceof Error ? err.message : String(err);
    }
}

// ── group member section ──────────────────────────────────────────────────────

const members = ref<BehaviorGroupMember[]>([]);
const memberInput = ref('');
const memberError = ref<string | null>(null);
const renameDraft = ref('');
const renaming = ref(false);

async function loadMembers(targetId: number) {
    try { members.value = await listGroupMembers(targetId); }
    catch (err) { memberError.value = err instanceof Error ? err.message : String(err); }
}

watch(() => props.target, (next) => {
    if (next.kind === 'group') renameDraft.value = next.groupName ?? '';
}, { immediate: true });

async function onAddMember() {
    memberError.value = null;
    const id = memberInput.value.trim();
    if (!/^\d{17,20}$/.test(id)) {
        memberError.value = t('behaviors.workspace.memberIdInvalid');
        return;
    }
    try {
        const m = await addGroupMember(props.target.id, id);
        members.value = [...members.value.filter(x => x.userId !== m.userId), m]
            .sort((a, b) => a.userId.localeCompare(b.userId));
        memberInput.value = '';
        emit('group-member-changed', props.target.id, members.value.length);
    } catch (err) {
        memberError.value = err instanceof Error ? err.message : String(err);
    }
}

async function onRemoveMember(userId: string) {
    try {
        await removeGroupMember(props.target.id, userId);
        members.value = members.value.filter(m => m.userId !== userId);
        emit('group-member-changed', props.target.id, members.value.length);
    } catch (err) {
        memberError.value = err instanceof Error ? err.message : String(err);
    }
}

async function onRename() {
    const next = renameDraft.value.trim();
    if (!next || next === props.target.groupName) return;
    renaming.value = true;
    try {
        await renameGroupTarget(props.target.id, next);
        emit('group-renamed', props.target.id, next);
    } catch (err) {
        memberError.value = err instanceof Error ? err.message : String(err);
    } finally {
        renaming.value = false;
    }
}

const headerTitle = computed(() => {
    if (props.target.kind === 'all_dms') return t('behaviors.sidebar.allDms');
    if (props.target.kind === 'user') {
        return props.target.profile?.globalName ?? props.target.profile?.username ?? props.target.userId ?? '?';
    }
    return props.target.groupName ?? '?';
});
</script>

<template>
    <section class="workspace">
        <header class="ws-head">
            <h2 class="title">{{ headerTitle }}</h2>
            <span class="kind-badge">
                <template v-if="target.kind === 'all_dms'">{{ t('behaviors.workspace.kindAllDms') }}</template>
                <template v-else-if="target.kind === 'user'">{{ t('behaviors.workspace.kindUser') }}</template>
                <template v-else>{{ t('behaviors.workspace.kindGroup') }}</template>
            </span>
            <span class="spacer" />
            <button type="button" class="primary" :disabled="loading" @click="emit('add-behavior')">
                <Icon icon="material-symbols:add-rounded" width="16" height="16" />
                {{ t('behaviors.workspace.addBehavior') }}
            </button>
            <button
                v-if="target.kind !== 'all_dms' && canManageCatalog"
                type="button"
                class="danger ghost"
                :title="t('behaviors.workspace.deleteTargetTooltip')"
                @click="onDeleteTarget"
            >
                <Icon icon="material-symbols:delete-outline-rounded" width="18" height="18" />
            </button>
        </header>

        <!-- group rename + members -->
        <section v-if="target.kind === 'group' && canManageCatalog" class="group-section">
            <div class="rename-row">
                <label class="field">
                    <span class="label">{{ t('behaviors.workspace.groupNameLabel') }}</span>
                    <div class="rename-controls">
                        <input v-model="renameDraft" type="text" maxlength="80" />
                        <button
                            type="button"
                            class="primary small"
                            :disabled="renaming || !renameDraft.trim() || renameDraft.trim() === target.groupName"
                            @click="onRename"
                        >{{ t('common.save') }}</button>
                    </div>
                </label>
            </div>
            <details class="members-details">
                <summary>{{ t('behaviors.workspace.membersToggle', { count: members.length }) }}</summary>
                <form class="add-member-row" @submit.prevent="onAddMember">
                    <input
                        v-model="memberInput"
                        type="text"
                        :placeholder="t('behaviors.workspace.memberIdPlaceholder')"
                        inputmode="numeric"
                        pattern="\d*"
                    />
                    <button type="submit" class="primary small">{{ t('common.add') }}</button>
                </form>
                <p v-if="memberError" class="error">{{ memberError }}</p>
                <ul class="member-list">
                    <li v-for="m in members" :key="m.userId">
                        <img v-if="m.profile?.avatarUrl" :src="m.profile.avatarUrl" alt="" class="m-avatar" />
                        <div v-else class="m-avatar fallback">?</div>
                        <span class="m-name">{{ m.profile?.globalName ?? m.profile?.username ?? m.userId }}</span>
                        <span class="m-id">{{ m.userId }}</span>
                        <button type="button" class="icon-btn danger" :title="t('common.remove')" @click="onRemoveMember(m.userId)">
                            <Icon icon="material-symbols:close-rounded" width="16" height="16" />
                        </button>
                    </li>
                    <li v-if="members.length === 0" class="muted empty">
                        {{ t('behaviors.workspace.membersEmpty') }}
                    </li>
                </ul>
            </details>
        </section>

        <p v-if="loading && behaviors.length === 0" class="muted loading">{{ t('common.loading') }}</p>
        <p v-else-if="!loading && behaviors.length === 0" class="muted empty">
            {{ t('behaviors.workspace.empty') }}
        </p>
        <p v-if="error" class="error" role="alert">{{ error }}</p>

        <!-- system behaviors（固定釘頂，不可拖曳）-->
        <div v-if="systemBehaviors.length > 0" class="card-list">
            <BehaviorCard
                v-for="b in systemBehaviors"
                :key="b.id"
                :behavior="b"
                :plugins="plugins"
                @updated="onUpdated"
            />
        </div>

        <!-- plugin behaviors（固定，不可拖曳）-->
        <div v-if="pluginBehaviors.length > 0" class="card-list">
            <BehaviorCard
                v-for="b in pluginBehaviors"
                :key="b.id"
                :behavior="b"
                :plugins="plugins"
                @updated="onUpdated"
            />
        </div>

        <!-- custom behaviors（可拖曳排序）-->
        <div ref="listRef" class="card-list">
            <BehaviorCard
                v-for="b in customBehaviors"
                :key="b.id"
                :behavior="b"
                :plugins="plugins"
                :initially-open="newlyCreatedId === b.id"
                @updated="onUpdated"
                @deleted="onDeleted"
            />
        </div>
    </section>
</template>

<style scoped>
.workspace {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding: 0.75rem;
    overflow-y: auto;
}
.ws-head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-shrink: 0;
}
.title { margin: 0; font-size: 1.05rem; color: var(--text-strong); }
.kind-badge {
    font-size: 0.72rem;
    padding: 0.12rem 0.45rem;
    border-radius: 999px;
    background: var(--bg-page);
    border: 1px solid var(--border);
    color: var(--text-muted);
}
.spacer { flex: 1; }
button.primary {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.45rem 0.85rem;
    background: var(--accent);
    color: var(--text-on-accent);
    border: 1px solid var(--accent);
    border-radius: var(--radius-sm);
    cursor: pointer;
    font: inherit;
}
button.primary.small { padding: 0.3rem 0.6rem; font-size: 0.85rem; }
button.primary:disabled { opacity: 0.55; cursor: not-allowed; }
button.danger.ghost {
    background: none;
    border: 1px solid rgba(239, 68, 68, 0.4);
    color: var(--danger);
    padding: 0.4rem;
    width: 36px;
    height: 36px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-sm);
    cursor: pointer;
}
.group-section {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.75rem;
    background: var(--bg-page);
    border: 1px solid var(--border);
    border-radius: var(--radius-base);
}
.rename-row .field { display: flex; flex-direction: column; gap: 0.25rem; }
.label { font-size: 0.75rem; color: var(--text-muted); font-weight: 600; }
.rename-controls { display: flex; gap: 0.4rem; }
.rename-controls input {
    flex: 1;
    padding: 0.45rem 0.6rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg-surface);
    color: var(--text);
    font: inherit;
}
.members-details summary {
    cursor: pointer;
    font-size: 0.85rem;
    color: var(--text-muted);
    padding: 0.25rem 0;
}
.add-member-row { display: flex; gap: 0.4rem; margin-top: 0.4rem; }
.add-member-row input {
    flex: 1;
    padding: 0.45rem 0.6rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg-surface);
    color: var(--text);
    font: inherit;
}
.member-list {
    list-style: none;
    margin: 0.5rem 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
}
.member-list li {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.3rem 0.4rem;
    border-radius: var(--radius-sm);
    background: var(--bg-surface);
    border: 1px solid var(--border);
}
.m-avatar {
    width: 24px; height: 24px; border-radius: 50%; object-fit: cover; flex-shrink: 0;
}
.m-avatar.fallback {
    background: var(--accent);
    color: var(--text-on-accent);
    display: flex; align-items: center; justify-content: center;
    font-size: 0.7rem; font-weight: 600;
}
.m-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text); }
.m-id { font-size: 0.72rem; color: var(--text-muted); font-family: monospace; }
.icon-btn {
    background: none; border: 1px solid transparent; color: var(--text-muted);
    padding: 0.2rem; border-radius: var(--radius-sm); cursor: pointer;
    display: inline-flex; align-items: center; justify-content: center;
}
.icon-btn.danger:hover { color: var(--danger); border-color: rgba(239,68,68,0.35); }
.card-list { display: flex; flex-direction: column; gap: 0.5rem; }
.muted { color: var(--text-muted); }
.loading, .empty { padding: 1rem; text-align: center; }
.error { color: var(--danger); margin: 0; font-size: 0.9rem; }
:deep(.sortable-ghost) { opacity: 0.4; }
</style>
