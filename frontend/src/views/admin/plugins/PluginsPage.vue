<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { Icon } from '@iconify/vue';
import { listPlugins, type PluginRecord } from '../../../api/plugins';
import PluginCard from './PluginCard.vue';

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
            <button type="button" class="group-head group-toggle" @click="offlineOpen = !offlineOpen">
                <span class="group-dot offline" />
                <span class="group-label">{{ t('admin.plugins.offlineCount', { n: inactivePlugins.length }) }}</span>
                <Icon
                    :icon="offlineOpen ? 'material-symbols:expand-less-rounded' : 'material-symbols:expand-more-rounded'"
                    width="16"
                    height="16"
                    class="group-chevron"
                />
            </button>
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
.group-toggle {
    background: none;
    border: none;
    cursor: pointer;
    color: var(--text-muted);
    text-align: left;
}
.group-toggle:hover .group-label { color: var(--text); }
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
