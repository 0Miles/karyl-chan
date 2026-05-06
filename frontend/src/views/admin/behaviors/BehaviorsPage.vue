<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { SidebarLayout } from '../../../layouts';
import { useBreakpoint } from '../../../composables/use-breakpoint';
import { useAppShell } from '../../../composables/use-app-shell';
import { useCurrentUserStore } from '../../../stores/currentUserStore';
import { hasAdminCapability } from '../../../libs/admin-capabilities';
import BehaviorSidebar from './BehaviorSidebar.vue';
import BehaviorWorkspace from './BehaviorWorkspace.vue';
import AddTargetModal from './AddTargetModal.vue';
import AddBehaviorModal from './AddBehaviorModal.vue';
import {
    listTargets,
    type BehaviorTargetSummary,
    type BehaviorRow,
    type BehaviorAudienceKind,
} from '../../../api/behavior';

/**
 * BehaviorsPage v2 — M1-D1
 *
 * 整合 BehaviorSidebar（audience 維度）+ BehaviorWorkspace（v2 BehaviorRow）
 * + AddTargetModal（新增 audience target）+ AddBehaviorModal（新增 behavior wizard）。
 */

const { t } = useI18n();
const { isMobile } = useBreakpoint();
const { closeOverlay } = useAppShell();
const currentUser = useCurrentUserStore();

const canManageCatalog = computed(() => {
    const caps = currentUser.user?.capabilities ?? [];
    return hasAdminCapability(caps, 'behavior.manage');
});

const targets = ref<BehaviorTargetSummary[]>([]);
const selectedId = ref<number | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);

// 兩個 modal 的開關
const addTargetModalOpen = ref(false);
const addBehaviorModalOpen = ref(false);

const selectedTarget = computed(() => targets.value.find(t => t.id === selectedId.value) ?? null);

// 從 selectedTarget 推導 audienceKind / userId / groupName（傳給 AddBehaviorModal）
const selectedAudienceKind = computed<BehaviorAudienceKind>(() => {
    const t = selectedTarget.value;
    if (!t) return 'all';
    if (t.kind === 'all_dms') return 'all';
    if (t.kind === 'user') return 'user';
    return 'group';
});

async function load() {
    loading.value = true;
    error.value = null;
    try {
        targets.value = await listTargets();
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

// BehaviorWorkspace emit 的 add-behavior 事件
function onAddBehavior() {
    addBehaviorModalOpen.value = true;
}

// AddBehaviorModal 建立成功後（目前不需要 refetch，workspace 有 key 更新）
function onBehaviorCreated(_row: BehaviorRow) {
    // workspace 監聽自身 api 呼叫；此 handler 可在未來加 toast
    addBehaviorModalOpen.value = false;
}
</script>

<template>
    <SidebarLayout>
        <template #sidebar>
            <BehaviorSidebar
                :targets="targets"
                :selected-id="selectedId"
                :loading="loading"
                :can-add-target="canManageCatalog"
                @select="onSelect"
                @add="addTargetModalOpen = true"
            />
        </template>

        <BehaviorWorkspace
            v-if="selectedTarget"
            :key="selectedTarget.id"
            :target="selectedTarget"
            :targets="targets"
            :can-manage-catalog="canManageCatalog"
            @target-deleted="onTargetDeleted"
            @group-member-changed="onMemberCountChanged"
            @group-renamed="onGroupRenamed"
            @add-behavior="onAddBehavior"
        />
        <div v-else-if="loading" class="placeholder muted">{{ t('common.loading') }}</div>
        <div v-else class="placeholder muted">{{ t('behaviors.page.pickTarget') }}</div>

        <!-- 新增 Target modal -->
        <AddTargetModal
            v-if="canManageCatalog"
            :visible="addTargetModalOpen"
            @close="addTargetModalOpen = false"
            @created="onTargetCreated"
        />

        <!-- 新增 Behavior modal（v2 wizard）-->
        <AddBehaviorModal
            :visible="addBehaviorModalOpen"
            :default-audience-kind="selectedAudienceKind"
            :default-audience-user-id="selectedTarget?.userId ?? undefined"
            :default-audience-group-name="selectedTarget?.groupName ?? undefined"
            @close="addBehaviorModalOpen = false"
            @created="onBehaviorCreated"
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
