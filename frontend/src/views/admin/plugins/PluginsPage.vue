<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { Icon } from '@iconify/vue';
import { deletePlugin, listPlugins, type PluginRecord } from '../../../api/plugins';
import PluginCard from './PluginCard.vue';
import AppConfirmDialog from '../../../components/AppConfirmDialog.vue';

const { t } = useI18n();

const plugins = ref<PluginRecord[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);
const offlineOpen = ref(false);

const activePlugins = computed(() => plugins.value.filter(p => p.status === 'active'));
const inactivePlugins = computed(() => plugins.value.filter(p => p.status === 'inactive'));

async function load() {
    loading.value = true;
    error.value = null;
    try {
        plugins.value = await listPlugins();
    } catch (err) {
        error.value = err instanceof Error ? err.message : String(err);
    } finally {
        loading.value = false;
    }
}

function onUpdated(updated: { id: number; pluginKey: string; enabled: boolean }) {
    plugins.value = plugins.value.map(p =>
        p.id === updated.id ? { ...p, enabled: updated.enabled } : p
    );
}

function onScopesUpdated(payload: { id: number; approvedScopes: string[]; pendingScopes: string[] }) {
    plugins.value = plugins.value.map(p =>
        p.id === payload.id
            ? { ...p, approvedScopes: payload.approvedScopes, pendingScopes: payload.pendingScopes }
            : p
    );
}

function onDeleted(id: number) {
    plugins.value = plugins.value.filter(p => p.id !== id);
}

// ── Delete-all-offline ───────────────────────────────────────────
const deleteAllModalOpen = ref(false);
const deletingAll = ref(false);
const deleteAllError = ref<string | null>(null);
const deleteAllProgress = ref<{ done: number; total: number } | null>(null);

async function confirmDeleteAllOffline() {
    if (deletingAll.value) return;
    const targets = inactivePlugins.value.slice();
    if (targets.length === 0) {
        deleteAllModalOpen.value = false;
        return;
    }
    deletingAll.value = true;
    deleteAllError.value = null;
    deleteAllProgress.value = { done: 0, total: targets.length };
    const failures: string[] = [];
    for (const p of targets) {
        try {
            await deletePlugin(p.id);
            plugins.value = plugins.value.filter(x => x.id !== p.id);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            failures.push(`${p.pluginKey}: ${msg}`);
        }
        deleteAllProgress.value = {
            done: (deleteAllProgress.value?.done ?? 0) + 1,
            total: targets.length,
        };
    }
    deletingAll.value = false;
    if (failures.length === 0) {
        deleteAllModalOpen.value = false;
        deleteAllProgress.value = null;
    } else {
        deleteAllError.value = failures.join('\n');
    }
}

function closeDeleteAllModal() {
    if (deletingAll.value) return;
    deleteAllModalOpen.value = false;
    deleteAllError.value = null;
    deleteAllProgress.value = null;
}

onMounted(load);
</script>

<template>
    <div class="page">
        <header class="page-head">
            <h1 class="title">{{ t('admin.plugins.title') }}</h1>
            <p class="subtitle">{{ t('admin.plugins.subtitle') }}</p>
            <button type="button" class="ghost" @click="load" :disabled="loading" :title="t('common.refresh')">
                <Icon icon="material-symbols:refresh" width="18" height="18" />
            </button>
        </header>

        <p v-if="loading && plugins.length === 0" class="muted">{{ t('common.loading') }}</p>
        <p v-else-if="!loading && plugins.length === 0" class="muted empty">
            <Icon icon="material-symbols:extension-outline" width="32" height="32" />
            <span>{{ t('admin.plugins.empty') }}</span>
            <small>{{ t('admin.plugins.emptyHint') }}</small>
        </p>
        <p v-if="error" class="error" role="alert">{{ error }}</p>

        <!-- Online group -->
        <div v-if="activePlugins.length > 0" class="group">
            <div class="group-head">
                <span class="group-dot online" />
                <span class="group-label">{{ t('admin.plugins.online') }}</span>
                <span class="group-count">{{ activePlugins.length }}</span>
            </div>
            <div class="card-list">
                <PluginCard
                    v-for="p in activePlugins"
                    :key="p.id"
                    :plugin="p"
                    @updated="onUpdated"
                    @scopes-updated="onScopesUpdated"
                    @deleted="onDeleted"
                />
            </div>
        </div>

        <!-- Offline group (collapsible, default collapsed) -->
        <div v-if="inactivePlugins.length > 0" class="group">
            <div class="group-head group-head-offline">
                <button type="button" class="group-toggle-btn" @click="offlineOpen = !offlineOpen">
                    <span class="group-dot offline" />
                    <span class="group-label">{{ t('admin.plugins.offlineCount', { n: inactivePlugins.length }) }}</span>
                    <Icon
                        :icon="offlineOpen ? 'material-symbols:expand-less-rounded' : 'material-symbols:expand-more-rounded'"
                        width="16"
                        height="16"
                        class="group-chevron"
                    />
                </button>
                <button
                    type="button"
                    class="delete-all-btn"
                    :disabled="deletingAll"
                    :title="t('admin.plugins.deleteAllOffline')"
                    @click="deleteAllModalOpen = true"
                >
                    <Icon icon="material-symbols:delete-sweep-outline" width="16" height="16" />
                    <span>{{ t('admin.plugins.deleteAllOffline') }}</span>
                </button>
            </div>
            <div v-if="offlineOpen" class="card-list">
                <PluginCard
                    v-for="p in inactivePlugins"
                    :key="p.id"
                    :plugin="p"
                    @updated="onUpdated"
                    @scopes-updated="onScopesUpdated"
                    @deleted="onDeleted"
                />
            </div>
        </div>

        <AppConfirmDialog
            :visible="deleteAllModalOpen"
            :title="t('admin.plugins.deleteAllConfirmTitle')"
            :message="t('admin.plugins.deleteAllConfirm', { n: inactivePlugins.length })"
            :confirm-label="t('admin.plugins.deleteAllOffline')"
            confirm-variant="danger"
            :loading="deletingAll"
            :error="deleteAllError ?? undefined"
            :progress="deleteAllProgress ? t('admin.plugins.deleteAllProgress', { done: deleteAllProgress.done, total: deleteAllProgress.total }) : undefined"
            @close="closeDeleteAllModal"
            @confirm="confirmDeleteAllOffline"
        />
    </div>
</template>

<style scoped>
.page {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding: 0.75rem;
    height: 100%;
    overflow-y: auto;
}
.page-head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
}
.title { margin: 0; font-size: 1.1rem; color: var(--text-strong); }
.subtitle {
    margin: 0;
    color: var(--text-muted);
    font-size: 0.85rem;
    flex: 1;
    min-width: 0;
}
.ghost {
    background: none;
    border: 1px solid var(--border);
    color: var(--text);
    padding: 0.4rem;
    border-radius: var(--radius-sm);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
}
.ghost:hover { background: var(--bg-surface-hover); }
.ghost:disabled { opacity: 0.55; cursor: not-allowed; }

.muted { color: var(--text-muted); }
.muted.empty {
    text-align: center;
    padding: 2rem 1rem;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.4rem;
}
.muted.empty small { color: var(--text-faint); font-size: 0.78rem; max-width: 32rem; }

.error { color: var(--danger); margin: 0; font-size: 0.9rem; }

.card-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
}

/* ── Plugin groups (online / offline) ───────────────────────────── */
.group {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
}
.group-head {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    padding: 0.2rem 0.1rem;
}
.group-toggle,
.group-toggle-btn {
    background: none;
    border: none;
    cursor: pointer;
    color: var(--text-muted);
    text-align: left;
    padding: 0;
    display: flex;
    align-items: center;
    gap: 0.45rem;
}
.group-toggle:hover .group-label,
.group-toggle-btn:hover .group-label { color: var(--text); }
.group-head-offline {
    justify-content: space-between;
}
.delete-all-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.25rem 0.6rem;
    font-size: 0.8rem;
    border: 1px solid color-mix(in srgb, var(--danger, #dc2626) 35%, transparent);
    border-radius: 999px;
    background: color-mix(in srgb, var(--danger, #dc2626) 8%, transparent);
    color: var(--danger, #dc2626);
    cursor: pointer;
}
.delete-all-btn:hover:not(:disabled) {
    background: color-mix(in srgb, var(--danger, #dc2626) 15%, transparent);
}
.delete-all-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}
.group-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
}
.group-dot.online  { background: var(--success, #16a34a); }
.group-dot.offline { background: var(--text-muted); }
.group-label {
    font-size: 0.82rem;
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
}
.group-count {
    font-size: 0.78rem;
    color: var(--text-faint, var(--text-muted));
    background: var(--bg-page);
    border: 1px solid var(--border);
    border-radius: 999px;
    padding: 0.08rem 0.45rem;
}
.group-chevron {
    margin-left: auto;
    color: var(--text-muted);
    flex-shrink: 0;
}
</style>
