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
import AddScopeTabModal from './AddScopeTabModal.vue';
import {
    listScopeTabs,
    type ScopeTabRow,
    type BehaviorRow,
} from '../../../api/behavior';

const { t } = useI18n();
const { isMobile } = useBreakpoint();
const { closeOverlay } = useAppShell();
const currentUser = useCurrentUserStore();

const canManageCatalog = computed(() => {
    const caps = currentUser.user?.capabilities ?? [];
    return hasAdminCapability(caps, 'behavior.manage');
});

const tabs = ref<ScopeTabRow[]>([]);
const selectedTabId = ref<number>(1);
const loading = ref(false);
const error = ref<string | null>(null);

const addBehaviorModalOpen = ref(false);
const addTabModalOpen = ref(false);

const selectedTab = computed((): ScopeTabRow | null =>
    tabs.value.find(t => t.id === selectedTabId.value) ?? null
);

async function load() {
    loading.value = true;
    error.value = null;
    try {
        tabs.value = await listScopeTabs();
        if (!tabs.value.some(t => t.id === selectedTabId.value)) {
            selectedTabId.value = tabs.value[0]?.id ?? 1;
        }
    } catch (err) {
        error.value = err instanceof Error ? err.message : String(err);
    } finally {
        loading.value = false;
    }
}

onMounted(() => {
    void load();
});

function onSelect(tabId: number) {
    selectedTabId.value = tabId;
    if (isMobile.value) closeOverlay();
}

async function onTabDeleted() {
    await load();
}

async function onBehaviorCreated(_row: BehaviorRow) {
    addBehaviorModalOpen.value = false;
    await load();
}

async function onBehaviorDeleted() {
    await load();
}

async function onTabCreated(tab: ScopeTabRow) {
    addTabModalOpen.value = false;
    await load();
    selectedTabId.value = tab.id;
}
</script>

<template>
    <SidebarLayout>
        <template #sidebar>
            <BehaviorSidebar
                :tabs="tabs"
                :selected-tab-id="selectedTabId"
                :loading="loading"
                :can-add="canManageCatalog"
                @select="onSelect"
                @add="addTabModalOpen = true"
            />
        </template>

        <BehaviorWorkspace
            v-if="selectedTab"
            :key="selectedTab.id"
            :tab="selectedTab"
            :can-manage-catalog="canManageCatalog"
            @tab-deleted="onTabDeleted"
            @add-behavior="addBehaviorModalOpen = true"
            @behavior-deleted="onBehaviorDeleted"
        />

        <AddBehaviorModal
            :visible="addBehaviorModalOpen"
            :scope-tab-id="selectedTabId"
            :scope-tab="selectedTab"
            @close="addBehaviorModalOpen = false"
            @created="onBehaviorCreated"
        />

        <AddScopeTabModal
            :visible="addTabModalOpen"
            @close="addTabModalOpen = false"
            @created="onTabCreated"
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
