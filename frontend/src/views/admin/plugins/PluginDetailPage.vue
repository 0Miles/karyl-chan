<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, RouterLink } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { Icon } from '@iconify/vue';
import AppTabs, { type TabDef } from '../../../components/AppTabs.vue';
import PluginDetailOverview from './PluginDetailOverview.vue';
import PluginDetailBehaviors from './PluginDetailBehaviors.vue';
import PluginDetailCommands from './PluginDetailCommands.vue';
import PluginDetailFeatures from './PluginDetailFeatures.vue';
import PluginDetailScopes from './PluginDetailScopes.vue';
import PluginDetailSecurity from './PluginDetailSecurity.vue';
import { getPluginByKey, type PluginDetailRecord } from '../../../api/plugins';

const { t } = useI18n();
const route = useRoute();

const pluginKey = computed(() => route.params.pluginKey as string);

const plugin = ref<PluginDetailRecord | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);

const activeTab = ref('overview');

const tabs = computed<TabDef[]>(() => [
    { key: 'overview',  label: t('admin.plugins.detail.tabOverview') },
    { key: 'behaviors', label: t('admin.plugins.detail.tabBehaviors') },
    { key: 'commands',  label: t('admin.plugins.detail.tabCommands') },
    { key: 'features',  label: t('admin.plugins.detail.tabFeatures') },
    { key: 'scopes',    label: t('admin.plugins.detail.tabScopes') },
    { key: 'security',  label: t('admin.plugins.detail.tabSecurity') },
]);

const statusColor = computed(() =>
    plugin.value?.status === 'active' ? 'var(--success, #16a34a)' : 'var(--text-muted)'
);

const lastHeartbeat = computed(() => {
    if (!plugin.value?.lastHeartbeatAt) return t('admin.plugins.neverHeartbeat');
    const d = new Date(plugin.value.lastHeartbeatAt);
    const ageSec = Math.floor((Date.now() - d.getTime()) / 1000);
    if (ageSec < 60) return t('admin.plugins.heartbeatJustNow');
    if (ageSec < 3600) return t('admin.plugins.heartbeatMinutesAgo', { n: Math.floor(ageSec / 60) });
    if (ageSec < 86400) return t('admin.plugins.heartbeatHoursAgo', { n: Math.floor(ageSec / 3600) });
    return d.toLocaleString();
});

const behaviorCount = computed(() => {
    const m = plugin.value?.manifest;
    return (m?.behaviors?.length ?? m?.dm_behaviors?.length ?? 0);
});
const featureCount = computed(() => plugin.value?.manifest?.guild_features?.length ?? 0);
const commandCount = computed(() => plugin.value?.pluginCommands?.length ?? 0);

async function load() {
    loading.value = true;
    error.value = null;
    try {
        plugin.value = await getPluginByKey(pluginKey.value);
    } catch (err) {
        error.value = err instanceof Error ? err.message : String(err);
    } finally {
        loading.value = false;
    }
}

function onCommandToggled(payload: { id: number; adminEnabled: boolean }) {
    if (!plugin.value) return;
    plugin.value = {
        ...plugin.value,
        pluginCommands: plugin.value.pluginCommands.map(c =>
            c.id === payload.id ? { ...c, adminEnabled: payload.adminEnabled } : c
        ),
    };
}

onMounted(load);
</script>

<template>
    <div class="page">
        <header class="page-header">
            <RouterLink :to="{ name: 'plugins' }" class="back-link">
                <Icon icon="material-symbols:arrow-back-rounded" width="16" height="16" />
                {{ t('admin.plugins.detail.backLink') }}
            </RouterLink>
        </header>

        <p v-if="loading && !plugin" class="muted">{{ t('common.loading') }}</p>
        <p v-else-if="error" class="error" role="alert">{{ error }}</p>

        <template v-if="plugin">
            <div class="plugin-hero">
                <div class="hero-icon">
                    <Icon icon="material-symbols:extension-rounded" width="32" height="32" />
                </div>
                <div class="hero-info">
                    <div class="hero-name-row">
                        <h1 class="hero-name">{{ plugin.name }}</h1>
                        <span class="hero-version">v{{ plugin.version }}</span>
                    </div>
                    <code class="hero-key">{{ plugin.pluginKey }}</code>
                    <p v-if="plugin.manifest?.plugin.description" class="hero-desc">
                        {{ plugin.manifest.plugin.description }}
                    </p>
                    <div class="status-row">
                        <span class="status-dot" :style="{ background: statusColor }" />
                        <span class="status-label">
                            {{ plugin.status === 'active' ? t('admin.plugins.statusActive') : t('admin.plugins.statusInactive') }}
                        </span>
                        <span class="heartbeat-sep">·</span>
                        <span class="heartbeat-label">{{ t('admin.plugins.lastHeartbeat') }}: {{ lastHeartbeat }}</span>
                    </div>
                    <div class="stats-chips">
                        <span v-if="behaviorCount > 0" class="chip">
                            <Icon icon="material-symbols:forum-outline" width="13" height="13" />
                            {{ t('admin.plugins.dmBehaviorsCount', { n: behaviorCount }) }}
                        </span>
                        <span v-if="featureCount > 0" class="chip">
                            <Icon icon="material-symbols:hub-outline" width="13" height="13" />
                            {{ t('admin.plugins.guildFeaturesCount', { n: featureCount }) }}
                        </span>
                        <span v-if="commandCount > 0" class="chip">
                            <Icon icon="material-symbols:terminal" width="13" height="13" />
                            {{ t('admin.plugins.commandsCount', { n: commandCount }) }}
                        </span>
                    </div>
                </div>
            </div>

            <AppTabs v-model="activeTab" :tabs="tabs">
                <PluginDetailOverview v-if="activeTab === 'overview'" :plugin="plugin" />
                <PluginDetailBehaviors v-else-if="activeTab === 'behaviors'" :plugin="plugin" />
                <PluginDetailCommands
                    v-else-if="activeTab === 'commands'"
                    :plugin="plugin"
                    @command-toggled="onCommandToggled"
                />
                <PluginDetailFeatures v-else-if="activeTab === 'features'" :plugin="plugin" />
                <PluginDetailScopes v-else-if="activeTab === 'scopes'" :plugin="plugin" @reload="load" />
                <PluginDetailSecurity v-else-if="activeTab === 'security'" :plugin="plugin" />
            </AppTabs>
        </template>
    </div>
</template>

<style scoped>
.page {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    padding: 0.75rem;
    height: 100%;
    overflow-y: auto;
}

.page-header {
    display: flex;
    align-items: center;
}

.back-link {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    color: var(--text-muted);
    text-decoration: none;
    font-size: 0.85rem;
    transition: color 0.12s;
}
.back-link:hover { color: var(--text); }

/* Plugin hero section */
.plugin-hero {
    display: flex;
    gap: 0.85rem;
    align-items: flex-start;
    padding: 0.9rem 1rem;
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-base);
}
.hero-icon {
    width: 48px;
    height: 48px;
    background: color-mix(in srgb, var(--source-plugin, #7c3aed) 14%, var(--bg-page));
    border: 1px solid color-mix(in srgb, var(--source-plugin, #7c3aed) 30%, transparent);
    border-radius: var(--radius-base);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--source-plugin, #7c3aed);
    flex-shrink: 0;
}
.hero-info {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    flex: 1;
    min-width: 0;
}
.hero-name-row {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
}
.hero-name {
    margin: 0;
    font-size: 1.15rem;
    font-weight: 700;
    color: var(--text-strong);
}
.hero-version {
    font-size: 0.8rem;
    color: var(--text-faint, var(--text-muted));
}
.hero-key {
    font-family: var(--font-mono, monospace);
    font-size: 0.78rem;
    color: var(--text-muted);
}
.hero-desc {
    margin: 0;
    color: var(--text);
    font-size: 0.88rem;
    line-height: 1.5;
}
.status-row {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.82rem;
}
.status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
}
.status-label { color: var(--text-muted); }
.heartbeat-sep { color: var(--text-faint, var(--text-muted)); }
.heartbeat-label { color: var(--text-muted); }

.stats-chips {
    display: flex;
    gap: 0.4rem;
    flex-wrap: wrap;
}
.chip {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.75rem;
    color: var(--text-muted);
    background: var(--bg-page);
    padding: 0.15rem 0.45rem;
    border-radius: 999px;
    border: 1px solid var(--border);
}

.muted { color: var(--text-muted); font-size: 0.9rem; }
.error { color: var(--danger); margin: 0; font-size: 0.9rem; }
</style>
