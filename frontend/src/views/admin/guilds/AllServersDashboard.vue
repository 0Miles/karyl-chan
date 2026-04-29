<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { Icon } from '@iconify/vue';
import {
    applyFeatureDefaultToAll,
    listFeatureDefaults,
    setFeatureDefault,
    type FeatureDefaultItem
} from '../../../api/plugin-features';
import { useApiError } from '../../../composables/use-api-error';

/**
 * "All Servers" dashboard. Shows every plugin × feature pair across
 * the bot, lets the operator pick the default-enabled state for each
 * (overriding the plugin manifest's enabled_by_default), and offers an
 * "apply to all guilds" button that bulk-flips every existing
 * plugin_guild_features row to match the current effective default.
 *
 * Read precedence:
 *   1. operator override (plugin_feature_defaults row, if any)
 *   2. manifest enabled_by_default (false if author omitted)
 *
 * The toggle UI mutates the operator override; existing per-guild rows
 * stay as-is until apply-to-all is invoked.
 */

const { handle: handleApiError } = useApiError();

const features = ref<FeatureDefaultItem[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);
// Track which (pluginId|featureKey) is mid-mutation so we can disable
// its toggle and apply button without flickering the whole list.
const busy = ref<Set<string>>(new Set());
const lastApplyResult = ref<Record<string, { updated: number } | null>>({});

const grouped = computed(() => {
    const byPlugin = new Map<number, { pluginName: string; pluginKey: string; pluginEnabled: boolean; pluginStatus: 'active' | 'inactive'; items: FeatureDefaultItem[] }>();
    for (const f of features.value) {
        const cur = byPlugin.get(f.pluginId);
        if (cur) {
            cur.items.push(f);
        } else {
            byPlugin.set(f.pluginId, {
                pluginName: f.pluginName,
                pluginKey: f.pluginKey,
                pluginEnabled: f.pluginEnabled,
                pluginStatus: f.pluginStatus,
                items: [f]
            });
        }
    }
    return [...byPlugin.values()].sort((a, b) => a.pluginName.localeCompare(b.pluginName));
});

function key(item: FeatureDefaultItem): string {
    return `${item.pluginId}|${item.featureKey}`;
}

async function refresh() {
    loading.value = true;
    error.value = null;
    try {
        features.value = await listFeatureDefaults();
    } catch (err) {
        if (handleApiError(err) !== 'unhandled') return;
        error.value = err instanceof Error ? err.message : 'load failed';
    } finally {
        loading.value = false;
    }
}

async function onToggleDefault(item: FeatureDefaultItem) {
    const k = key(item);
    if (busy.value.has(k)) return;
    busy.value.add(k);
    const next = !item.effectiveDefault;
    try {
        await setFeatureDefault(item.pluginId, item.featureKey, next);
        // Optimistic in-place patch so the user sees the new state
        // without a full refetch round-trip.
        item.override = next;
        item.effectiveDefault = next;
    } catch (err) {
        if (handleApiError(err) !== 'unhandled') return;
        error.value = err instanceof Error ? err.message : 'save default failed';
    } finally {
        busy.value.delete(k);
    }
}

async function onApplyToAll(item: FeatureDefaultItem) {
    const k = key(item);
    if (busy.value.has(k)) return;
    if (!confirm(`將「${item.featureName}」的預設值 (${item.effectiveDefault ? '啟用' : '停用'}) 套用到所有伺服器?\n這會覆蓋每個伺服器目前的設定。`)) {
        return;
    }
    busy.value.add(k);
    try {
        const result = await applyFeatureDefaultToAll(item.pluginId, item.featureKey);
        lastApplyResult.value = { ...lastApplyResult.value, [k]: { updated: result.updated } };
        // Refetch to get updated enabledGuildCount / disabledGuildCount.
        await refresh();
    } catch (err) {
        if (handleApiError(err) !== 'unhandled') return;
        error.value = err instanceof Error ? err.message : 'apply failed';
    } finally {
        busy.value.delete(k);
    }
}

onMounted(refresh);
</script>

<template>
    <article class="all-servers">
        <header class="page-header">
            <div>
                <h2>所有伺服器 — Bot 功能預設</h2>
                <p class="muted">
                    每個 plugin 提供的 guild feature 在這裡設定預設啟用值。
                    新加入 bot 的伺服器會繼承此預設;既有伺服器需手動點「套用到所有伺服器」才會覆蓋。
                </p>
            </div>
            <button type="button" class="btn ghost" :disabled="loading" @click="refresh">
                <Icon icon="material-symbols:refresh-rounded" />
                重新整理
            </button>
        </header>

        <p v-if="error" class="error">{{ error }}</p>
        <p v-if="loading" class="muted">載入中…</p>

        <p v-else-if="features.length === 0" class="muted empty">
            目前沒有 plugin 宣告任何 guild feature。Plugin 啟用後 manifest 會自動同步到這裡。
        </p>

        <section v-for="group in grouped" :key="group.pluginKey" class="plugin-group">
            <header class="plugin-header">
                <h3>
                    {{ group.pluginName }}
                    <span class="plugin-key muted">({{ group.pluginKey }})</span>
                </h3>
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
                            <span>已啟用 {{ item.enabledGuildCount }} 個 guild</span>
                            <span class="dot">·</span>
                            <span>已停用 {{ item.disabledGuildCount }} 個 guild</span>
                            <span class="dot">·</span>
                            <span>
                                Manifest 預設:{{ item.manifestDefault ? '啟用' : '停用' }}
                                <template v-if="item.override !== null">
                                    (已被覆蓋為 {{ item.override ? '啟用' : '停用' }})
                                </template>
                            </span>
                        </div>
                        <div v-if="lastApplyResult[`${item.pluginId}|${item.featureKey}`]" class="apply-result">
                            ✓ 已套用到 {{ lastApplyResult[`${item.pluginId}|${item.featureKey}`]?.updated }} 個 guild
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
                                :disabled="busy.has(`${item.pluginId}|${item.featureKey}`)"
                                @click="onToggleDefault(item)"
                            >
                                <span class="slider" aria-hidden="true"></span>
                            </button>
                        </label>
                        <button
                            type="button"
                            class="btn small"
                            :disabled="busy.has(`${item.pluginId}|${item.featureKey}`)"
                            @click="onApplyToAll(item)"
                            title="把目前的預設值套到所有伺服器(會覆蓋既有設定)"
                        >
                            <Icon icon="material-symbols:checklist-rounded" />
                            套用到所有伺服器
                        </button>
                    </div>
                </li>
            </ul>
        </section>
    </article>
</template>

<style scoped>
.all-servers {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    width: 100%;
    max-width: 1080px;
    margin: 0 auto;
}
.page-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 1rem;
}
.page-header h2 { margin: 0 0 0.35rem 0; font-size: 1.1rem; }
.muted { color: var(--text-muted); font-size: 0.85rem; margin: 0; }
.empty { padding: 2rem; text-align: center; }
.error {
    color: var(--danger);
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.35);
    border-radius: var(--radius-sm);
    padding: 0.55rem 0.75rem;
}

.plugin-group {
    border: 1px solid var(--border);
    border-radius: var(--radius);
    overflow: hidden;
    background: var(--bg-surface);
}
.plugin-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.6rem 0.85rem;
    border-bottom: 1px solid var(--border);
    background: var(--bg-surface-2);
}
.plugin-header h3 { margin: 0; font-size: 0.95rem; flex: 1; }
.plugin-key { font-weight: 400; font-size: 0.78rem; }
.status-pill {
    font-size: 0.7rem;
    padding: 0.1rem 0.55rem;
    border-radius: var(--radius-pill);
    background: var(--bg-surface);
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
    display: flex;
    gap: 0.85rem;
    padding: 0.85rem;
    align-items: flex-start;
    border-bottom: 1px solid var(--border);
}
.feature-row:last-child { border-bottom: none; }
.feature-icon {
    width: 22px;
    height: 22px;
    flex-shrink: 0;
    margin-top: 0.15rem;
    color: var(--text-muted);
}
.feature-meta { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 0.3rem; }
.feature-name { font-weight: 500; color: var(--text-strong); }
.feature-desc { font-size: 0.82rem; line-height: 1.35; }
.feature-stats { display: flex; flex-wrap: wrap; gap: 0.35rem; font-size: 0.75rem; }
.feature-stats .dot { opacity: 0.4; }
.apply-result {
    font-size: 0.78rem;
    color: var(--accent);
    margin-top: 0.2rem;
}

.feature-controls {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 0.45rem;
    flex-shrink: 0;
}
.toggle-wrap {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    cursor: pointer;
}
.toggle-label { font-size: 0.78rem; color: var(--text-muted); }
.toggle {
    position: relative;
    width: 32px;
    height: 18px;
    flex-shrink: 0;
    cursor: pointer;
    border: none;
    padding: 0;
    background: none;
}
.toggle:disabled { cursor: not-allowed; opacity: 0.6; }
.slider {
    position: absolute;
    inset: 0;
    background: var(--border-strong);
    border-radius: 999px;
    transition: background 0.15s;
}
.slider::before {
    content: '';
    position: absolute;
    top: 2px;
    left: 2px;
    width: 14px;
    height: 14px;
    background: var(--bg-surface);
    border-radius: 50%;
    transition: transform 0.15s;
}
.toggle.on .slider { background: var(--accent); }
.toggle.on .slider::before { transform: translateX(14px); }

.btn {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
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
