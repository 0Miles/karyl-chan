<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { Icon } from '@iconify/vue';
import { useI18n } from 'vue-i18n';
import {
    listGuildFeatures,
    setGuildFeatureEnabled,
    type GuildFeatureItem
} from '../../../api/plugin-features';
import {
    listBuiltinFeatureState,
    setBuiltinFeatureState,
    type BuiltinFeatureState
} from '../../../api/builtin-features';
import { guildFeatures as builtinRegistry } from '../../../modules/guild-features/registry';
import { useApiError } from '../../../composables/use-api-error';

/**
 * Per-guild Bot Features panel. Lists every built-in (in-process) +
 * plugin-provided guild feature with a single on/off switch per row
 * scoped to this guild.
 *
 *   Built-in: per-guild row falls back to operator default (set in
 *             "All Servers" → Bot 功能) → built-ins default ON.
 *   Plugin:   per-guild plugin_guild_features.enabled → operator
 *             override on plugin_feature_defaults → manifest default.
 *
 * Configuration for each individual built-in feature lives on its own
 * sub-tab; this panel only flips the master switch.
 */

const props = defineProps<{ guildId: string }>();
const { t: $t } = useI18n();
const { handle: handleApiError } = useApiError();

const pluginFeatures = ref<GuildFeatureItem[]>([]);
const builtinStates = ref<BuiltinFeatureState[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);
const busy = ref<Set<string>>(new Set());

function pluginKey(item: GuildFeatureItem): string {
    return `plugin:${item.pluginId}|${item.featureKey}`;
}
function builtinRowKey(featureKey: string): string {
    return `builtin:${featureKey}`;
}

const builtinByKey = computed(() => {
    const m = new Map<string, BuiltinFeatureState>();
    for (const b of builtinStates.value) m.set(b.featureKey, b);
    return m;
});

interface BuiltinRow {
    key: string;
    label: string;
    icon: string;
    /** effective enabled for this guild: per-guild override → default → true */
    enabled: boolean;
    /** explicit per-guild row exists */
    overridden: boolean;
    /** the operator default (post-override resolution) for context */
    defaultEnabled: boolean;
}

const builtinRows = computed<BuiltinRow[]>(() =>
    builtinRegistry.map(reg => {
        const slot = builtinByKey.value.get(reg.name);
        const perGuild = slot?.perGuild.find(g => g.guildId === props.guildId);
        const def = slot?.effectiveDefault ?? true;
        return {
            key: reg.name,
            label: $t(reg.labelKey),
            icon: reg.icon,
            enabled: perGuild ? perGuild.enabled : def,
            overridden: !!perGuild,
            defaultEnabled: def
        };
    })
);

async function refresh() {
    if (!props.guildId) return;
    loading.value = true;
    error.value = null;
    try {
        const [pf, bs] = await Promise.all([
            listGuildFeatures(props.guildId),
            listBuiltinFeatureState()
        ]);
        pluginFeatures.value = pf;
        builtinStates.value = bs;
    } catch (err) {
        if (handleApiError(err) !== 'unhandled') return;
        error.value = err instanceof Error ? err.message : 'load failed';
    } finally {
        loading.value = false;
    }
}

async function onTogglePlugin(item: GuildFeatureItem) {
    const k = pluginKey(item);
    if (busy.value.has(k)) return;
    busy.value.add(k);
    const next = !item.enabled;
    try {
        await setGuildFeatureEnabled(item.pluginId, props.guildId, item.featureKey, next);
        item.enabled = next;
    } catch (err) {
        if (handleApiError(err) !== 'unhandled') return;
        error.value = err instanceof Error ? err.message : 'toggle failed';
    } finally {
        busy.value.delete(k);
    }
}

async function onToggleBuiltin(row: BuiltinRow) {
    const k = builtinRowKey(row.key);
    if (busy.value.has(k)) return;
    busy.value.add(k);
    const next = !row.enabled;
    try {
        await setBuiltinFeatureState(row.key, next, props.guildId);
        await refresh();
    } catch (err) {
        if (handleApiError(err) !== 'unhandled') return;
        error.value = err instanceof Error ? err.message : 'toggle failed';
    } finally {
        busy.value.delete(k);
    }
}

onMounted(refresh);
watch(() => props.guildId, refresh);
</script>

<template>
    <article class="bot-features-panel">
        <header class="panel-header">
            <div>
                <h3>Bot 功能(此伺服器)</h3>
                <p class="muted">
                    在此切換每個內建或 Plugin 功能在此伺服器的開關。內建功能的詳細設定可在對應的子分頁進行調整;
                    若想統一改變所有伺服器的預設值,請到「所有伺服器 → Bot 功能」頁面。
                </p>
            </div>
            <button type="button" class="btn ghost small" :disabled="loading" @click="refresh">
                <Icon icon="material-symbols:refresh-rounded" />
                重新整理
            </button>
        </header>

        <p v-if="error" class="error">{{ error }}</p>
        <p v-if="loading" class="muted">載入中…</p>

        <template v-else>
            <section class="feature-section">
                <h4 class="section-title">
                    <Icon icon="material-symbols:settings-outline-rounded" />
                    內建功能
                </h4>
                <ul class="feature-list">
                    <li v-for="row in builtinRows" :key="row.key" class="feature-row">
                        <Icon :icon="row.icon" class="feature-icon" />
                        <div class="feature-meta">
                            <div class="feature-name">{{ row.label }}</div>
                            <div class="feature-stats muted">
                                <template v-if="row.overridden">
                                    <span>此伺服器已覆寫:{{ row.enabled ? '啟用' : '停用' }}</span>
                                    <span class="dot">·</span>
                                    <span>預設:{{ row.defaultEnabled ? '啟用' : '停用' }}</span>
                                </template>
                                <template v-else>
                                    <span>使用預設:{{ row.defaultEnabled ? '啟用' : '停用' }}</span>
                                </template>
                            </div>
                        </div>
                        <button
                            type="button"
                            role="switch"
                            :class="['toggle', { on: row.enabled }]"
                            :aria-checked="row.enabled ? 'true' : 'false'"
                            :disabled="busy.has(builtinRowKey(row.key))"
                            :title="row.enabled ? '停用此功能' : '啟用此功能'"
                            @click="onToggleBuiltin(row)"
                        >
                            <span class="slider" aria-hidden="true"></span>
                        </button>
                    </li>
                </ul>
            </section>

            <section class="feature-section">
                <h4 class="section-title">
                    <Icon icon="material-symbols:extension-outline-rounded" />
                    Plugin Features
                </h4>
                <p v-if="pluginFeatures.length === 0" class="muted empty">
                    目前沒有 plugin 提供 guild feature。
                </p>
                <ul v-else class="feature-list">
                    <li v-for="item in pluginFeatures" :key="pluginKey(item)" class="feature-row">
                        <Icon v-if="item.icon" :icon="item.icon" class="feature-icon" />
                        <Icon v-else icon="material-symbols:extension-outline" class="feature-icon" />
                        <div class="feature-meta">
                            <div class="feature-name">
                                {{ item.name }}
                                <span class="plugin-tag muted">({{ item.pluginName }})</span>
                            </div>
                            <div v-if="item.description" class="feature-desc muted">{{ item.description }}</div>
                            <div v-if="!item.pluginEnabled || item.pluginStatus !== 'active'" class="warn">
                                ⚠ Plugin 目前 {{ !item.pluginEnabled ? '已停用' : '不在線' }};即使 toggle 開啟也不會收到事件。
                            </div>
                        </div>
                        <button
                            type="button"
                            role="switch"
                            :class="['toggle', { on: item.enabled }]"
                            :aria-checked="item.enabled ? 'true' : 'false'"
                            :disabled="busy.has(pluginKey(item)) || !item.pluginEnabled"
                            :title="item.enabled ? '停用此功能' : '啟用此功能'"
                            @click="onTogglePlugin(item)"
                        >
                            <span class="slider" aria-hidden="true"></span>
                        </button>
                    </li>
                </ul>
            </section>
        </template>
    </article>
</template>

<style scoped>
.bot-features-panel { display: flex; flex-direction: column; gap: 0.75rem; }
.panel-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; }
.panel-header h3 { margin: 0 0 0.25rem 0; font-size: 1rem; }
.muted { color: var(--text-muted); font-size: 0.85rem; margin: 0; }
.empty { padding: 1rem; text-align: center; }
.error {
    color: var(--danger);
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.35);
    border-radius: var(--radius-sm);
    padding: 0.55rem 0.75rem;
}
.warn { color: var(--warning, #f59e0b); font-size: 0.78rem; margin-top: 0.2rem; }

.feature-section {
    border: 1px solid var(--border);
    border-radius: var(--radius);
    overflow: hidden;
    background: var(--bg-surface);
}
.section-title {
    display: flex; align-items: center; gap: 0.45rem;
    font-size: 0.92rem;
    margin: 0;
    padding: 0.55rem 0.75rem;
    color: var(--text-strong);
    background: var(--bg-surface-2);
    border-bottom: 1px solid var(--border);
}
.feature-list { list-style: none; margin: 0; padding: 0; }
.feature-row {
    display: flex; gap: 0.85rem;
    padding: 0.7rem 0.75rem;
    align-items: flex-start;
    border-bottom: 1px solid var(--border);
}
.feature-row:last-child { border-bottom: none; }
.feature-icon {
    width: 20px; height: 20px; flex-shrink: 0; margin-top: 0.15rem;
    color: var(--text-muted);
}
.feature-meta { flex: 1; min-width: 0; }
.feature-name { font-weight: 500; color: var(--text-strong); }
.feature-desc { font-size: 0.82rem; line-height: 1.35; margin-top: 0.2rem; }
.feature-stats {
    display: flex; flex-wrap: wrap; gap: 0.35rem;
    font-size: 0.75rem; margin-top: 0.2rem;
}
.feature-stats .dot { opacity: 0.4; }
.plugin-tag { font-weight: 400; font-size: 0.78rem; }
.toggle {
    position: relative; width: 32px; height: 18px;
    flex-shrink: 0; cursor: pointer; border: none; padding: 0; background: none;
    margin-top: 0.15rem;
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
}
.btn:hover:not(:disabled) { background: var(--bg-surface-hover); }
.btn:disabled { cursor: not-allowed; opacity: 0.55; }
.btn.ghost { background: transparent; }
.btn.small { padding: 0.3rem 0.55rem; font-size: 0.78rem; }
</style>
