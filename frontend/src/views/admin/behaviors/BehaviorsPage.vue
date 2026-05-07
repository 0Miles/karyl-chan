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
const selectedKey = ref<string | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);

// AddBehaviorModal 開關
const addBehaviorModalOpen = ref(false);

const selectedAudience = computed(() =>
    audiences.value.find(a => a.key === selectedKey.value) ?? null
);

const selectedAudienceKind = computed<BehaviorAudienceKind>(() =>
    selectedAudience.value?.kind ?? 'all'
);

async function load() {
    loading.value = true;
    error.value = null;
    try {
        audiences.value = await listAudiences();
        // 預設選中 all，或保持既有選擇
        if (selectedKey.value == null || !audiences.value.some(a => a.key === selectedKey.value)) {
            const fallback = audiences.value.find(a => a.kind === 'all') ?? audiences.value[0];
            selectedKey.value = fallback?.key ?? null;
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
            v-if="selectedAudience"
            :key="selectedAudience.key"
            :audience="selectedAudience"
            :can-manage-catalog="canManageCatalog"
            @audience-deleted="onAudienceDeleted"
            @add-behavior="addBehaviorModalOpen = true"
            @behavior-deleted="onBehaviorDeleted"
        />
        <div v-else-if="loading" class="placeholder muted">{{ t('common.loading') }}</div>
        <div v-else class="placeholder muted">{{ t('behaviors.page.pickTarget') }}</div>

        <!-- 新增 Behavior modal（v2 wizard，同時負責新增 audience）-->
        <AddBehaviorModal
            :visible="addBehaviorModalOpen"
            :default-audience-kind="selectedAudienceKind"
            :default-audience-user-id="selectedAudience?.userId"
            :default-audience-group-name="selectedAudience?.groupName"
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
