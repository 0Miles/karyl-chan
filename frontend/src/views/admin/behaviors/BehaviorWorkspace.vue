<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, useTemplateRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { Icon } from '@iconify/vue';
import Sortable from 'sortablejs';
import BehaviorCard from './BehaviorCard.vue';
import AppConfirmDialog from '../../../components/AppConfirmDialog.vue';
import AppButton from '../../../components/AppButton.vue';
import {
    listBehaviors,
    reorderBehaviors,
    deleteBehavior,
    deleteScopeTab,
    type BehaviorRow,
    type ScopeTabRow,
} from '../../../api/behavior';
import { useUserSummaries } from '../../../composables/use-user-summaries';

const { t } = useI18n();

const props = defineProps<{
    tab: ScopeTabRow;
    canManageCatalog?: boolean;
}>();

const emit = defineEmits<{
    (e: 'tab-deleted'): void;
    (e: 'add-behavior'): void;
    (e: 'behavior-deleted'): void;
}>();

// ── behaviors data ───────────────────────────────────────────────────────────

const behaviors = ref<BehaviorRow[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);
const newlyCreatedId = ref<number | null>(null);
const listRef = useTemplateRef<HTMLElement>('listRef');
let sortable: Sortable | null = null;

async function load(tab: ScopeTabRow) {
    loading.value = true;
    error.value = null;
    try {
        behaviors.value = await listBehaviors({ scopeTabId: tab.id });
    } catch (err) {
        error.value = err instanceof Error ? err.message : String(err);
    } finally {
        loading.value = false;
    }
}

watch(() => props.tab.id, () => {
    teardownSortable();
    void load(props.tab);
}, { immediate: true });

// ── sortable ─────────────────────────────────────────────────────────────────

const systemBehaviors = computed(() => behaviors.value.filter(b => b.source === 'system'));
const customBehaviors = computed(() => behaviors.value.filter(b => b.source === 'custom'));

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

watch(() => customBehaviors.value.length, async () => {
    await nextTick();
    void ensureSortable();
});

onBeforeUnmount(teardownSortable);

// ── event handlers ───────────────────────────────────────────────────────────

function onUpdated(row: BehaviorRow) {
    behaviors.value = behaviors.value.map(b => b.id === row.id ? row : b);
}

function onDeleted(id: number) {
    behaviors.value = behaviors.value.filter(b => b.id !== id);
    emit('behavior-deleted');
}

const deleteTabDialogOpen = ref(false);
const deleteTabDeleting = ref(false);
const deleteTabError = ref<string | null>(null);

const deleteTabLabel = computed(() => {
    const tab = props.tab;
    if (tab.tabType === 'specific_user') {
        return getWorkspaceDisplayName(tab.userId ?? '') ?? tab.userId ?? '?';
    }
    if (tab.tabType === 'specific_group') return tab.groupName ?? '?';
    if (tab.tabType === 'specific_guild') return tab.label || tab.guildId || '?';
    if (tab.tabType === 'specific_channel') return tab.label || tab.channelId || '?';
    return '';
});

function onDeleteTab() {
    if (props.tab.isFixed) return;
    if (loading.value) return;
    deleteTabError.value = null;
    deleteTabDialogOpen.value = true;
}

async function doDeleteTab() {
    if (deleteTabDeleting.value) return;
    deleteTabDeleting.value = true;
    deleteTabError.value = null;
    try {
        await deleteScopeTab(props.tab.id);
        deleteTabDialogOpen.value = false;
        emit('tab-deleted');
    } catch (err) {
        deleteTabError.value = err instanceof Error ? err.message : String(err);
    } finally {
        deleteTabDeleting.value = false;
    }
}

// Resolve display name for user tabs.
const workspaceUserIds = computed(() =>
    props.tab.tabType === 'specific_user' && props.tab.userId ? [props.tab.userId] : []
);
const { getDisplayName: getWorkspaceDisplayName } = useUserSummaries(workspaceUserIds);

const headerTitle = computed(() => {
    const tab = props.tab;
    switch (tab.tabType) {
        case 'global_all': return t('behaviors.sidebar.globalAll');
        case 'all_dms': return t('behaviors.sidebar.allDms');
        case 'all_bot_dms': return t('behaviors.sidebar.allBotDms');
        case 'all_guilds': return t('behaviors.sidebar.allGuilds');
        case 'specific_guild': return tab.label || tab.guildId || '?';
        case 'specific_channel': return tab.label || tab.channelId || '?';
        case 'specific_user': {
            const name = tab.userId ? getWorkspaceDisplayName(tab.userId) : null;
            return name ?? tab.userId ?? '?';
        }
        case 'specific_group': return tab.groupName ?? '?';
    }
});

const kindBadge = computed(() => {
    switch (props.tab.tabType) {
        case 'global_all': return t('behaviors.workspace.kindGlobalAll');
        case 'all_dms': return t('behaviors.workspace.kindAllDms');
        case 'all_bot_dms': return t('behaviors.workspace.kindAllBotDms');
        case 'all_guilds': return t('behaviors.workspace.kindAllGuilds');
        case 'specific_guild': return t('behaviors.workspace.kindGuild');
        case 'specific_channel': return t('behaviors.workspace.kindChannel');
        case 'specific_user': return t('behaviors.workspace.kindUser');
        case 'specific_group': return t('behaviors.workspace.kindGroup');
    }
});
</script>

<template>
    <section class="workspace">
        <header class="ws-head">
            <h2 class="title">{{ headerTitle }}</h2>
            <span class="kind-badge">{{ kindBadge }}</span>
            <span class="spacer" />
            <AppButton
                variant="primary"
                size="sm"
                icon="material-symbols:add-rounded"
                :disabled="loading"
                @click="emit('add-behavior')"
            >{{ t('behaviors.workspace.addBehavior') }}</AppButton>
            <AppButton
                v-if="!tab.isFixed && canManageCatalog"
                variant="danger"
                size="sm"
                icon="material-symbols:delete-outline-rounded"
                :disabled="loading"
                :title="t('behaviors.workspace.deleteTabTooltip')"
                style="padding: 0.4rem; min-width: 0;"
                @click="onDeleteTab"
            />
        </header>

        <p v-if="loading && behaviors.length === 0" class="muted loading">{{ t('common.loading') }}</p>
        <p v-else-if="!loading && behaviors.length === 0" class="muted empty">
            {{ t('behaviors.workspace.empty') }}
        </p>
        <p v-if="error" class="error" role="alert">{{ error }}</p>

        <!-- system behaviors -->
        <div v-if="systemBehaviors.length > 0" class="card-list">
            <BehaviorCard
                v-for="b in systemBehaviors"
                :key="b.id"
                :behavior="b"
                @updated="onUpdated"
            />
        </div>

        <!-- custom behaviors (drag-sortable) -->
        <div ref="listRef" class="card-list">
            <BehaviorCard
                v-for="b in customBehaviors"
                :key="b.id"
                :behavior="b"
                :initially-open="newlyCreatedId === b.id"
                @updated="onUpdated"
                @deleted="onDeleted"
            />
        </div>
    </section>

    <AppConfirmDialog
        :visible="deleteTabDialogOpen"
        :title="t('behaviors.workspace.deleteTabTitle')"
        :message="t('behaviors.workspace.deleteTabConfirm', { label: deleteTabLabel })"
        :confirm-label="t('common.delete')"
        confirm-variant="danger"
        :loading="deleteTabDeleting"
        :error="deleteTabError ?? undefined"
        @close="deleteTabDialogOpen = false"
        @confirm="doDeleteTab"
    />
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
.card-list { display: flex; flex-direction: column; gap: 0.5rem; }
.muted { color: var(--text-muted); }
.loading, .empty { padding: 1rem; text-align: center; }
.error { color: var(--danger); margin: 0; font-size: 0.9rem; }
:deep(.sortable-ghost) { opacity: 0.4; }
</style>
