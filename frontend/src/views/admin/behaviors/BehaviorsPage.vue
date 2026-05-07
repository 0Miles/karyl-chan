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
import AddBehaviorModal from './AddBehaviorModal.vue';
import {
    listAudiences,
    type AudienceEntry,
    type BehaviorRow,
    type BehaviorAudienceKind,
} from '../../../api/behavior';

/**
 * BehaviorsPage v2 — sidebar 切到 audience-summary endpoint
 *
 * 移除 v1 target 依賴（listTargets / createUserTarget / AddTargetModal）。
 * sidebar 資料來自 GET /api/behaviors/audience-summary，前端聚合 DISTINCT。
 */

const { t } = useI18n();
const { isMobile } = useBreakpoint();
const { closeOverlay } = useAppShell();
const currentUser = useCurrentUserStore();

const canManageCatalog = computed(() => {
    const caps = currentUser.user?.capabilities ?? [];
    return hasAdminCapability(caps, 'behavior.manage');
});

const audiences = ref<AudienceEntry[]>([]);
// 預設選 'all'，讓 BehaviorWorkspace 可與 listAudiences 並行 mount 載入
const selectedKey = ref<string>('all');
const loading = ref(false);
const error = ref<string | null>(null);

// AddBehaviorModal 開關
const addBehaviorModalOpen = ref(false);

// 當 audiences 尚未載入時，提供 synthetic 'all' entry 讓 workspace 可並行 mount
const SYNTHETIC_ALL_AUDIENCE: AudienceEntry = { kind: 'all', key: 'all', behaviorCount: 0 };

const selectedAudience = computed((): AudienceEntry =>
    audiences.value.find(a => a.key === selectedKey.value) ?? SYNTHETIC_ALL_AUDIENCE
);

const selectedAudienceKind = computed<BehaviorAudienceKind>(() =>
    selectedAudience.value.kind
);

async function load() {
    loading.value = true;
    error.value = null;
    try {
        audiences.value = await listAudiences();
        // 確認選中的 key 仍然存在；若不在清單裡（audience 剛被刪）則改選 all
        if (!audiences.value.some(a => a.key === selectedKey.value)) {
            const fallback = audiences.value.find(a => a.kind === 'all') ?? audiences.value[0];
            selectedKey.value = fallback?.key ?? 'all';
        }
    } catch (err) {
        error.value = err instanceof Error ? err.message : String(err);
    } finally {
        loading.value = false;
    }
}

onMounted(() => { void load(); });

function onSelect(key: string) {
    selectedKey.value = key;
    if (isMobile.value) closeOverlay();
}

// audience-deleted：workspace 已完成刪除，重新 load sidebar
async function onAudienceDeleted() {
    await load();
}

// behavior 建立後重新載入 audience-summary（count 可能改變）
async function onBehaviorCreated(_row: BehaviorRow) {
    addBehaviorModalOpen.value = false;
    await load();
}

// workspace 通知有 behavior 被刪（count 更新）
async function onBehaviorDeleted() {
    await load();
}
</script>

<template>
    <SidebarLayout>
        <template #sidebar>
            <BehaviorSidebar
                :audiences="audiences"
                :selected-key="selectedKey"
                :loading="loading"
                :can-add="canManageCatalog"
                @select="onSelect"
                @add="addBehaviorModalOpen = true"
            />
        </template>

        <BehaviorWorkspace
            :key="selectedAudience.key"
            :audience="selectedAudience"
            :can-manage-catalog="canManageCatalog"
            @audience-deleted="onAudienceDeleted"
            @add-behavior="addBehaviorModalOpen = true"
            @behavior-deleted="onBehaviorDeleted"
        />

        <!-- 新增 Behavior modal（v2 wizard，同時負責新增 audience）-->
        <AddBehaviorModal
            :visible="addBehaviorModalOpen"
            :default-audience-kind="selectedAudienceKind"
            :default-audience-user-id="selectedAudience.userId"
            :default-audience-group-name="selectedAudience.groupName"
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
