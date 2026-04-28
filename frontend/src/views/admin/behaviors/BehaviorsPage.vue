<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { SidebarLayout } from '../../../layouts';
import { useBreakpoint } from '../../../composables/use-breakpoint';
import { useAppShell } from '../../../composables/use-app-shell';
import BehaviorSidebar from './BehaviorSidebar.vue';
import BehaviorWorkspace from './BehaviorWorkspace.vue';
import AddTargetModal from './AddTargetModal.vue';
import { listTargets, type BehaviorTargetSummary } from '../../../api/behavior';

const { t } = useI18n();
const { isMobile } = useBreakpoint();
const { closeOverlay } = useAppShell();

const targets = ref<BehaviorTargetSummary[]>([]);
const selectedId = ref<number | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);
const modalOpen = ref(false);

const selectedTarget = computed(() => targets.value.find(t => t.id === selectedId.value) ?? null);

async function load() {
    loading.value = true;
    error.value = null;
    try {
        targets.value = await listTargets();
        // Default to "all DMs" (id=1) if nothing selected yet, or if the
        // previously selected one is gone (e.g., just deleted).
        if (selectedId.value == null || !targets.value.some(t => t.id === selectedId.value)) {
            const fallback = targets.value.find(t => t.kind === 'all_dms') ?? targets.value[0];
            selectedId.value = fallback?.id ?? null;
        }
    } catch (err) {
        error.value = err instanceof Error ? err.message : String(err);
    } finally {
        loading.value = false;
    }
}

onMounted(() => { void load(); });

function onSelect(id: number) {
    selectedId.value = id;
    if (isMobile.value) closeOverlay();
}

function onTargetCreated(target: BehaviorTargetSummary) {
    targets.value = [...targets.value, target];
    selectedId.value = target.id;
}

function onTargetDeleted(id: number) {
    targets.value = targets.value.filter(t => t.id !== id);
    if (selectedId.value === id) {
        const fallback = targets.value.find(t => t.kind === 'all_dms') ?? targets.value[0];
        selectedId.value = fallback?.id ?? null;
    }
}

function onMemberCountChanged(id: number, count: number) {
    targets.value = targets.value.map(t => t.id === id ? { ...t, memberCount: count } : t);
}

function onGroupRenamed(id: number, name: string) {
    targets.value = targets.value.map(t => t.id === id ? { ...t, groupName: name } : t);
}
</script>

<template>
    <SidebarLayout>
        <template #sidebar>
            <BehaviorSidebar
                :targets="targets"
                :selected-id="selectedId"
                :loading="loading"
                @select="onSelect"
                @add="modalOpen = true"
            />
        </template>

        <BehaviorWorkspace
            v-if="selectedTarget"
            :key="selectedTarget.id"
            :target="selectedTarget"
            :targets="targets"
            @target-deleted="onTargetDeleted"
            @group-member-changed="onMemberCountChanged"
            @group-renamed="onGroupRenamed"
        />
        <div v-else-if="loading" class="placeholder muted">{{ t('common.loading') }}</div>
        <div v-else class="placeholder muted">{{ t('behaviors.page.pickTarget') }}</div>

        <AddTargetModal
            :visible="modalOpen"
            @close="modalOpen = false"
            @created="onTargetCreated"
        />
    </SidebarLayout>
</template>

<style scoped>
.placeholder {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 2rem;
    text-align: center;
}
.muted { color: var(--text-muted); }
</style>
