<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { Icon } from '@iconify/vue';
import { useI18n } from 'vue-i18n';
import AppTabs from '../../../components/AppTabs.vue';
import { listGuilds, type GuildSummary } from '../../../api/guilds';
import {
    applyFeatureDefaultToAll,
    listFeatureDefaults,
    setFeatureDefault,
    type FeatureDefaultItem
} from '../../../api/plugin-features';
import {
    listBuiltinFeatureState,
    setBuiltinFeatureState,
    type BuiltinFeatureState
} from '../../../api/builtin-features';
import { guildFeatures as builtinRegistry } from '../../../modules/guild-features/registry';
import { useApiError } from '../../../composables/use-api-error';

/**
 * "All Servers" dashboard with two top-level tabs:
 *
 *   總覽 (overview)   — bird's-eye counts: guilds, plugins, features.
 *   Bot 功能          — defaults editor for both built-in (in-process)
 *                       guild features and plugin-provided guild
 *                       features. Toggling the default override here
 *                       affects new guilds; existing per-guild rows
 *                       only flip after the operator hits "apply to
 *                       all servers" (plugin features) or sets a
 *                       per-guild override on the guild detail page.
 *
 * Lookup precedence the backend encodes:
 *   - built-in:  per-guild row → operator default (NULL row) → true (built-ins default ON)
 *   - plugin:    per-guild row (plugin_guild_features) → operator override (plugin_feature_defaults) → manifest enabled_by_default
 */

const { t: $t } = useI18n();
const { handle: handleApiError } = useApiError();

type Tab = 'overview' | 'bot-features';
const activeTab = ref<Tab>('overview');

const guilds = ref<GuildSummary[]>([]);
const pluginFeatures = ref<FeatureDefaultItem[]>([]);
const builtinFeatures = ref<BuiltinFeatureState[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);
const busy = ref<Set<string>>(new Set());
const lastApplyResult = ref<Record<string, { updated: number } | null>>({});

const builtinByKey = computed(() => {
    const m = new Map<string, BuiltinFeatureState>();
    for (const b of builtinFeatures.value) m.set(b.featureKey, b);
    return m;
});

const builtinMeta = computed(() =>
    builtinRegistry
        .map(reg => ({
            key: reg.name,
            label: $t(reg.labelKey),
            icon: reg.icon,
            state: builtinByKey.value.get(reg.name)
        }))
        .filter(item => item.state)
);

const pluginGroups = computed(() => {
    const byPlugin = new Map<number, {
        pluginName: string;
        pluginKey: string;
        pluginEnabled: boolean;
        pluginStatus: 'active' | 'inactive';
        items: FeatureDefaultItem[]
    }>();
    for (const f of pluginFeatures.value) {
        const cur = byPlugin.get(f.pluginId);
        if (cur) cur.items.push(f);
        else byPlugin.set(f.pluginId, {
            pluginName: f.pluginName, pluginKey: f.pluginKey,
            pluginEnabled: f.pluginEnabled, pluginStatus: f.pluginStatus,
            items: [f]
        });
    }
    return [...byPlugin.values()].sort((a, b) => a.pluginName.localeCompare(b.pluginName));
});

// Overview metrics
const overviewMetrics = computed(() => {
    const totalPluginFeatures = pluginFeatures.value.length;
    const enabledByDefaultPlugin = pluginFeatures.value.filter(f => f.effectiveDefault).length;
    const overriddenPlugin = pluginFeatures.value.filter(f => f.override !== null).length;
    const builtinDefaultOn = builtinFeatures.value.filter(b => b.effectiveDefault).length;
    const builtinOverridden = builtinFeatures.value.reduce((sum, b) => sum + b.perGuild.length, 0);
    return {
        guildCount: guilds.value.length,
        pluginCount: pluginGroups.value.length,
        totalPluginFeatures,
        enabledByDefaultPlugin,
        overriddenPlugin,
        builtinTotal: builtinFeatures.value.length,
        builtinDefaultOn,
        builtinOverridden
    };
});

function pluginKey(item: FeatureDefaultItem): string {
    return `${item.pluginId}|${item.featureKey}`;
}

async function refresh() {
    loading.value = true;
    error.value = null;
    try {
        const [g, pf, bf] = await Promise.all([
            listGuilds(),
            listFeatureDefaults(),
            listBuiltinFeatureState()
        ]);
        guilds.value = g;
        pluginFeatures.value = pf;
        builtinFeatures.value = bf;
    } catch (err) {
        if (handleApiError(err) !== 'unhandled') return;
        error.value = err instanceof Error ? err.message : 'load failed';
    } finally {
        loading.value = false;
    }
}

async function onTogglePluginDefault(item: FeatureDefaultItem) {
    const k = `plugin:${pluginKey(item)}`;
    if (busy.value.has(k)) return;
    busy.value.add(k);
    const next = !item.effectiveDefault;
    try {
        await setFeatureDefault(item.pluginId, item.featureKey, next);
        item.override = next;
        item.effectiveDefault = next;
    } catch (err) {
        if (handleApiError(err) !== 'unhandled') return;
        error.value = err instanceof Error ? err.message : 'save default failed';
    } finally {
        busy.value.delete(k);
    }
}

async function onApplyPluginToAll(item: FeatureDefaultItem) {
    const k = `plugin:${pluginKey(item)}`;
    if (busy.value.has(k)) return;
    if (!confirm(`將「${item.featureName}」的預設值 (${item.effectiveDefault ? '啟用' : '停用'}) 套用到所有伺服器?\n這會覆蓋每個伺服器目前的設定。`)) return;
    busy.value.add(k);
    try {
        const result = await applyFeatureDefaultToAll(item.pluginId, item.featureKey);
        lastApplyResult.value = { ...lastApplyResult.value, [k]: { updated: result.updated } };
        await refresh();
    } catch (err) {
        if (handleApiError(err) !== 'unhandled') return;
        error.value = err instanceof Error ? err.message : 'apply failed';
    } finally {
        busy.value.delete(k);
    }
}

async function onToggleBuiltinDefault(featureKey: string, current: boolean) {
    const k = `builtin:${featureKey}`;
    if (busy.value.has(k)) return;
    busy.value.add(k);
    try {
        await setBuiltinFeatureState(featureKey, !current, null);
        const slot = builtinByKey.value.get(featureKey);
        if (slot) {
            slot.default = { enabled: !current, updatedAt: new Date().toISOString() };
            slot.effectiveDefault = !current;
        }
    } catch (err) {
        if (handleApiError(err) !== 'unhandled') return;
        error.value = err instanceof Error ? err.message : 'toggle failed';
    } finally {
        busy.value.delete(k);
    }
}

const tabs = computed(() => [
    { key: 'overview', label: '總覽', icon: 'material-symbols:dashboard-outline-rounded' },
    { key: 'bot-features', label: 'Bot 功能', icon: 'material-symbols:tune-rounded' }
]);

onMounted(refresh);
</script>

<template>
    <div class="all-servers-shell">
        <AppTabs v-model="activeTab" :tabs="tabs">
            <!-- Overview -->
            <section v-if="activeTab === 'overview'" class="overview">
                <header class="page-header">
                    <h2>所有伺服器 — 總覽</h2>
                    <button type="button" class="btn ghost" :disabled="loading" @click="refresh">
                        <Icon icon="material-symbols:refresh-rounded" />
                        重新整理
                    </button>
                </header>
                <p v-if="error" class="error">{{ error }}</p>
                <p v-if="loading" class="muted">載入中…</p>
                <div v-else class="metric-grid">
                    <div class="metric">
                        <div class="metric-label">伺服器</div>
                        <div class="metric-value">{{ overviewMetrics.guildCount }}</div>
                    </div>
                    <div class="metric">
                        <div class="metric-label">已註冊 Plugin</div>
                        <div class="metric-value">{{ overviewMetrics.pluginCount }}</div>
                    </div>
                    <div class="metric">
                        <div class="metric-label">內建功能</div>
                        <div class="metric-value">
                            {{ overviewMetrics.builtinDefaultOn }} / {{ overviewMetrics.builtinTotal }}
                            <span class="metric-sub">預設啟用</span>
                        </div>
                    </div>
                    <div class="metric">
                        <div class="metric-label">內建功能單伺服器覆寫</div>
                        <div class="metric-value">{{ overviewMetrics.builtinOverridden }}</div>
                    </div>
                    <div class="metric">
                        <div class="metric-label">Plugin Features</div>
                        <div class="metric-value">
                            {{ overviewMetrics.enabledByDefaultPlugin }} / {{ overviewMetrics.totalPluginFeatures }}
                            <span class="metric-sub">預設啟用</span>
                        </div>
                    </div>
                    <div class="metric">
                        <div class="metric-label">Plugin Features 覆寫</div>
                        <div class="metric-value">{{ overviewMetrics.overriddenPlugin }}</div>
                    </div>
                </div>
            </section>

            <!-- Bot Features -->
            <section v-else-if="activeTab === 'bot-features'" class="bot-features">
                <header class="page-header">
                    <div>
                        <h2>所有伺服器 — Bot 功能預設</h2>
                        <p class="muted">
                            設定每個 guild feature 在新加入伺服器時的預設啟用值。既有伺服器的設定不會自動跟隨改動 —
                            內建功能可在伺服器頁覆寫;Plugin Features 需點下方「套用到所有伺服器」一鍵套用。
                        </p>
                    </div>
                    <button type="button" class="btn ghost" :disabled="loading" @click="refresh">
                        <Icon icon="material-symbols:refresh-rounded" />
                        重新整理
                    </button>
                </header>

                <p v-if="error" class="error">{{ error }}</p>
                <p v-if="loading" class="muted">載入中…</p>

                <template v-else>
                    <!-- Built-in features -->
                    <section class="feature-section">
                        <h3 class="section-title">
                            <Icon icon="material-symbols:settings-outline-rounded" />
                            內建功能
                        </h3>
                        <p v-if="builtinMeta.length === 0" class="muted empty">沒有內建功能。</p>
                        <ul v-else class="feature-list">
                            <li v-for="item in builtinMeta" :key="item.key" class="feature-row">
                                <Icon :icon="item.icon" class="feature-icon" />
                                <div class="feature-meta">
                                    <div class="feature-name">{{ item.label }}</div>
                                    <div class="feature-stats muted">
                                        <span>已覆寫的伺服器:{{ item.state!.perGuild.length }}</span>
                                        <span class="dot">·</span>
                                        <span>原預設:啟用</span>
                                        <template v-if="item.state!.default">
                                            <span class="dot">·</span>
                                            <span>已被覆蓋為 {{ item.state!.default!.enabled ? '啟用' : '停用' }}</span>
                                        </template>
                                    </div>
                                </div>
                                <div class="feature-controls">
                                    <label class="toggle-wrap">
                                        <span class="toggle-label">{{ item.state!.effectiveDefault ? '預設啟用' : '預設停用' }}</span>
                                        <button
                                            type="button"
                                            role="switch"
                                            :class="['toggle', { on: item.state!.effectiveDefault }]"
                                            :aria-checked="item.state!.effectiveDefault ? 'true' : 'false'"
                                            :disabled="busy.has(`builtin:${item.key}`)"
                                            @click="onToggleBuiltinDefault(item.key, item.state!.effectiveDefault)"
                                        >
                                            <span class="slider" aria-hidden="true"></span>
                                        </button>
                                    </label>
                                </div>
                            </li>
                        </ul>
                    </section>

                    <!-- Plugin features by plugin -->
                    <section class="feature-section">
                        <h3 class="section-title">
                            <Icon icon="material-symbols:extension-outline-rounded" />
                            Plugin Features
                        </h3>
                        <p v-if="pluginGroups.length === 0" class="muted empty">
                            目前沒有 plugin 宣告任何 guild feature。
                        </p>
                        <div v-for="group in pluginGroups" :key="group.pluginKey" class="plugin-group">
                            <header class="plugin-header">
                                <h4>
                                    {{ group.pluginName }}
                                    <span class="plugin-key muted">({{ group.pluginKey }})</span>
                                </h4>
                                <span :class="['status-pill', group.pluginStatus]">
                                    {{ group.pluginStatus === 'active' ? 'active' : 'inactive' }}
                                </span>
                                <span v-if="!group.pluginEnabled" class="status-pill disabled">disabled</span>
                            </header>
                            <ul class="feature-list">
                                <li v-for="item in group.items" :key="item.featureKey" class="feature-row">
                                    <Icon v-if="item.featureIcon" :icon="item.featureIcon" class="feature-icon" />
                                    <Icon v-else icon="material-symbols:extension-outline" class="feature-icon" />
                                    <div class="feature-meta">
                                        <div class="feature-name">{{ item.featureName }}</div>
                                        <div v-if="item.featureDescription" class="feature-desc muted">
                                            {{ item.featureDescription }}
                                        </div>
                                        <div class="feature-stats muted">
                                            <span>已啟用 {{ item.enabledGuildCount }} guild</span>
                                            <span class="dot">·</span>
                                            <span>已停用 {{ item.disabledGuildCount }} guild</span>
                                            <span class="dot">·</span>
                                            <span>
                                                Manifest 預設:{{ item.manifestDefault ? '啟用' : '停用' }}
                                                <template v-if="item.override !== null">
                                                    (覆蓋為 {{ item.override ? '啟用' : '停用' }})
                                                </template>
                                            </span>
                                        </div>
                                        <div v-if="lastApplyResult[`plugin:${pluginKey(item)}`]" class="apply-result">
                                            ✓ 已套用到 {{ lastApplyResult[`plugin:${pluginKey(item)}`]?.updated }} guild
                                        </div>
                                    </div>
                                    <div class="feature-controls">
                                        <label class="toggle-wrap">
                                            <span class="toggle-label">{{ item.effectiveDefault ? '預設啟用' : '預設停用' }}</span>
                                            <button
                                                type="button"
                                                role="switch"
                                                :class="['toggle', { on: item.effectiveDefault }]"
                                                :aria-checked="item.effectiveDefault ? 'true' : 'false'"
                                                :disabled="busy.has(`plugin:${pluginKey(item)}`)"
                                                @click="onTogglePluginDefault(item)"
                                            >
                                                <span class="slider" aria-hidden="true"></span>
                                            </button>
                                        </label>
                                        <button
                                            type="button"
                                            class="btn small"
                                            :disabled="busy.has(`plugin:${pluginKey(item)}`)"
                                            @click="onApplyPluginToAll(item)"
                                            title="把目前的預設值套到所有伺服器(會覆蓋既有設定)"
                                        >
                                            <Icon icon="material-symbols:checklist-rounded" />
                                            套用到所有伺服器
                                        </button>
                                    </div>
                                </li>
                            </ul>
                        </div>
                    </section>
                </template>
            </section>
        </AppTabs>
    </div>
</template>

<style scoped>
.all-servers-shell { width: 100%; max-width: 1080px; margin: 0 auto; }
.page-header {
    display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem;
    margin-bottom: 1rem;
}
.page-header h2 { margin: 0 0 0.35rem 0; font-size: 1.1rem; }
.muted { color: var(--text-muted); font-size: 0.85rem; margin: 0; }
.empty { padding: 1.5rem; text-align: center; }
.error {
    color: var(--danger);
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.35);
    border-radius: var(--radius-sm);
    padding: 0.55rem 0.75rem;
}

.metric-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 0.85rem;
}
.metric {
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg-surface);
    padding: 0.75rem 0.85rem;
}
.metric-label { color: var(--text-muted); font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.04em; }
.metric-value { font-size: 1.4rem; font-weight: 600; color: var(--text-strong); margin-top: 0.25rem; }
.metric-sub { font-size: 0.7rem; color: var(--text-muted); font-weight: 400; margin-left: 0.35rem; }

.feature-section {
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg-surface);
    padding: 0.85rem;
    margin-top: 1rem;
}
.section-title {
    display: flex; align-items: center; gap: 0.45rem;
    font-size: 0.95rem;
    margin: 0 0 0.6rem 0;
    color: var(--text-strong);
}
.plugin-group {
    border-top: 1px solid var(--border);
    padding-top: 0.6rem;
    margin-top: 0.6rem;
}
.plugin-group:first-of-type { border-top: none; padding-top: 0; margin-top: 0; }
.plugin-header {
    display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.35rem;
}
.plugin-header h4 { margin: 0; font-size: 0.92rem; flex: 1; }
.plugin-key { font-weight: 400; font-size: 0.78rem; }
.status-pill {
    font-size: 0.7rem;
    padding: 0.1rem 0.55rem;
    border-radius: var(--radius-pill);
    background: var(--bg-surface-2);
    border: 1px solid var(--border);
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
}
.status-pill.active { color: var(--accent); border-color: rgba(56, 189, 248, 0.35); }
.status-pill.inactive { color: var(--warning, #f59e0b); border-color: rgba(245, 158, 11, 0.35); }
.status-pill.disabled { color: var(--danger); border-color: rgba(239, 68, 68, 0.35); }

.feature-list { list-style: none; margin: 0; padding: 0; }
.feature-row {
    display: flex; gap: 0.85rem; padding: 0.7rem 0;
    align-items: flex-start;
    border-bottom: 1px solid var(--border);
}
.feature-row:last-child { border-bottom: none; }
.feature-icon {
    width: 22px; height: 22px;
    flex-shrink: 0; margin-top: 0.15rem;
    color: var(--text-muted);
}
.feature-meta { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 0.25rem; }
.feature-name { font-weight: 500; color: var(--text-strong); }
.feature-desc { font-size: 0.82rem; line-height: 1.35; }
.feature-stats { display: flex; flex-wrap: wrap; gap: 0.35rem; font-size: 0.75rem; }
.feature-stats .dot { opacity: 0.4; }
.apply-result { font-size: 0.78rem; color: var(--accent); margin-top: 0.2rem; }

.feature-controls {
    display: flex; flex-direction: column; align-items: flex-end; gap: 0.45rem;
    flex-shrink: 0;
}
.toggle-wrap { display: flex; align-items: center; gap: 0.5rem; cursor: pointer; }
.toggle-label { font-size: 0.78rem; color: var(--text-muted); }
.toggle {
    position: relative; width: 32px; height: 18px;
    flex-shrink: 0; cursor: pointer; border: none; padding: 0; background: none;
}
.toggle:disabled { cursor: not-allowed; opacity: 0.6; }
.slider {
    position: absolute; inset: 0;
    background: var(--border-strong);
    border-radius: 999px;
    transition: background 0.15s;
}
.slider::before {
    content: '';
    position: absolute; top: 2px; left: 2px;
    width: 14px; height: 14px;
    background: var(--bg-surface);
    border-radius: 50%;
    transition: transform 0.15s;
}
.toggle.on .slider { background: var(--accent); }
.toggle.on .slider::before { transform: translateX(14px); }

.btn {
    display: inline-flex; align-items: center; gap: 0.35rem;
    padding: 0.4rem 0.7rem;
    border: 1px solid var(--border-strong);
    background: var(--bg-surface);
    color: var(--text);
    border-radius: var(--radius-sm);
    cursor: pointer;
    font-size: 0.82rem;
    /* Without flex-shrink:0 the button collapses when the sibling
       description in `.page-header` is long — characters inside the
       inline-flex layout get squeezed before whitespace, so the icon
       and label overlap (`btn` looks "squashed"). */
    flex-shrink: 0;
    white-space: nowrap;
}
.btn:hover:not(:disabled) { background: var(--bg-surface-hover); }
.btn:disabled { cursor: not-allowed; opacity: 0.55; }
.btn.ghost { background: transparent; }
.btn.small { padding: 0.3rem 0.55rem; font-size: 0.78rem; }
</style>
