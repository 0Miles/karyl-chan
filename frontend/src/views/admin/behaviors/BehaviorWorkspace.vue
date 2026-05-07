<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, useTemplateRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { Icon } from '@iconify/vue';
import Sortable from 'sortablejs';
import BehaviorCard from './BehaviorCard.vue';
import {
    listBehaviors,
    reorderBehaviors,
    deleteBehavior,
    type BehaviorRow,
    type AudienceEntry,
} from '../../../api/behavior';
import { listPlugins, type PluginRecord } from '../../../api/plugins';

/**
 * BehaviorWorkspace v2 — 改用 AudienceEntry，移除 v1 target API 依賴
 *
 * 主要變更：
 * - props.target (BehaviorTargetSummary) → props.audience (AudienceEntry)
 * - deleteTarget → 收集該 audience 下所有 behavior ID，emit 'audience-deleted' 讓 Page 負責刪除
 * - group member section（v1 addGroupMember/removeGroupMember）已移除
 *   （v2 中 group members 是 per-behavior 管理，不在 workspace 層面）
 */

const { t } = useI18n();

const props = defineProps<{
    audience: AudienceEntry;
    canManageCatalog?: boolean;
}>();

const emit = defineEmits<{
    (e: 'audience-deleted', behaviorIds: number[]): void;
    (e: 'add-behavior'): void;
    (e: 'behavior-deleted'): void;
}>();

// ── behaviors 資料 ────────────────────────────────────────────────────────────

const behaviors = ref<BehaviorRow[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);
const newlyCreatedId = ref<number | null>(null);
const listRef = useTemplateRef<HTMLElement>('listRef');
let sortable: Sortable | null = null;

async function load(audience: AudienceEntry) {
    loading.value = true;
    error.value = null;
    try {
        const all = await listBehaviors({ audienceKind: audience.kind });

        if (audience.kind === 'user' && audience.userId) {
            behaviors.value = all.filter(b => b.audienceUserId === audience.userId);
        } else if (audience.kind === 'group' && audience.groupName) {
            behaviors.value = all.filter(b => b.audienceGroupName === audience.groupName);
        } else {
            behaviors.value = all;
        }
    } catch (err) {
        error.value = err instanceof Error ? err.message : String(err);
    } finally {
        loading.value = false;
    }
}

watch(() => props.audience.key, () => {
    teardownSortable();
    void load(props.audience);
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
    emit('behavior-deleted');
}

async function onDeleteAudience() {
    if (props.audience.kind === 'all') return;
    const label = props.audience.kind === 'user'
        ? (props.audience.userId ?? '?')
        : (props.audience.groupName ?? '?');
    if (!window.confirm(t('behaviors.workspace.deleteTargetConfirm', { label }))) return;
    const ids = behaviors.value.map(b => b.id);
    emit('audience-deleted', ids);
}

const headerTitle = computed(() => {
    if (props.audience.kind === 'all') return t('behaviors.sidebar.allDms');
    if (props.audience.kind === 'user') return props.audience.userId ?? '?';
    return props.audience.groupName ?? '?';
});
</script>

<template>
    <section class="workspace">
        <header class="ws-head">
            <h2 class="title">{{ headerTitle }}</h2>
            <span class="kind-badge">
                <template v-if="audience.kind === 'all'">{{ t('behaviors.workspace.kindAllDms') }}</template>
                <template v-else-if="audience.kind === 'user'">{{ t('behaviors.workspace.kindUser') }}</template>
                <template v-else>{{ t('behaviors.workspace.kindGroup') }}</template>
            </span>
            <span class="spacer" />
            <button type="button" class="primary" :disabled="loading" @click="emit('add-behavior')">
                <Icon icon="material-symbols:add-rounded" width="16" height="16" />
                {{ t('behaviors.workspace.addBehavior') }}
            </button>
            <button
                v-if="audience.kind !== 'all' && canManageCatalog"
                type="button"
                class="danger ghost"
                :title="t('behaviors.workspace.deleteTargetTooltip')"
                @click="onDeleteAudience"
            >
                <Icon icon="material-symbols:delete-outline-rounded" width="18" height="18" />
            </button>
        </header>

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
.card-list { display: flex; flex-direction: column; gap: 0.5rem; }
.muted { color: var(--text-muted); }
.loading, .empty { padding: 1rem; text-align: center; }
.error { color: var(--danger); margin: 0; font-size: 0.9rem; }
:deep(.sortable-ghost) { opacity: 0.4; }
</style>
