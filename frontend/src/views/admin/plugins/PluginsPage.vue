<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { Icon } from '@iconify/vue';
import { listPlugins, type PluginRecord } from '../../../api/plugins';
import PluginCard from './PluginCard.vue';

const { t } = useI18n();

const plugins = ref<PluginRecord[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);

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

        <div v-if="plugins.length > 0" class="card-list">
            <PluginCard
                v-for="p in plugins"
                :key="p.id"
                :plugin="p"
                @updated="onUpdated"
                @scopes-updated="onScopesUpdated"
            />
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
</style>
