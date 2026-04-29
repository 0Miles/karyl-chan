<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { Icon } from '@iconify/vue';
import {
    listGuildFeatures,
    setGuildFeatureEnabled,
    type GuildFeatureItem
} from '../../../api/plugin-features';
import { useApiError } from '../../../composables/use-api-error';

/**
 * Per-guild plugin features panel. Lists every plugin × feature
 * declared in any active plugin's manifest, with the current per-guild
 * enabled state and a toggle. Sits inside the guild's "features" sub-
 * tab next to the in-process discordx features (picture-only / todo /
 * etc.); plugins live in a separate panel because their lifecycle and
 * settings are different shape.
 */

const props = defineProps<{ guildId: string }>();
const { handle: handleApiError } = useApiError();

const features = ref<GuildFeatureItem[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);
const busy = ref<Set<string>>(new Set());

function key(item: GuildFeatureItem): string {
    return `${item.pluginId}|${item.featureKey}`;
}

async function refresh() {
    if (!props.guildId) return;
    loading.value = true;
    error.value = null;
    try {
        features.value = await listGuildFeatures(props.guildId);
    } catch (err) {
        if (handleApiError(err) !== 'unhandled') return;
        error.value = err instanceof Error ? err.message : 'load failed';
    } finally {
        loading.value = false;
    }
}

async function onToggle(item: GuildFeatureItem) {
    const k = key(item);
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

onMounted(refresh);
watch(() => props.guildId, refresh);
</script>

<template>
    <article class="plugin-features-panel">
        <header class="panel-header">
            <div>
                <h3>Plugin Features</h3>
                <p class="muted">由 plugin 提供的 guild feature。預設值在「所有伺服器」頁設定;這裡僅覆寫此單一伺服器。</p>
            </div>
            <button type="button" class="btn ghost small" :disabled="loading" @click="refresh">
                <Icon icon="material-symbols:refresh-rounded" />
                重新整理
            </button>
        </header>

        <p v-if="error" class="error">{{ error }}</p>
        <p v-if="loading" class="muted">載入中…</p>

        <p v-else-if="features.length === 0" class="muted empty">
            目前沒有 plugin 提供 guild feature。
        </p>

        <ul v-else class="feature-list">
            <li v-for="item in features" :key="key(item)" class="feature-row">
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
                    :disabled="busy.has(key(item)) || !item.pluginEnabled"
                    :title="item.enabled ? '停用此功能' : '啟用此功能'"
                    @click="onToggle(item)"
                >
                    <span class="slider" aria-hidden="true"></span>
                </button>
            </li>
        </ul>
    </article>
</template>

<style scoped>
.plugin-features-panel {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
}
.panel-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; }
.panel-header h3 { margin: 0 0 0.25rem 0; font-size: 1rem; }
.muted { color: var(--text-muted); font-size: 0.85rem; margin: 0; }
.empty { padding: 1.5rem; text-align: center; }
.error {
    color: var(--danger);
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.35);
    border-radius: var(--radius-sm);
    padding: 0.55rem 0.75rem;
}
.warn {
    color: var(--warning, #f59e0b);
    font-size: 0.78rem;
    margin-top: 0.2rem;
}
.feature-list {
    list-style: none;
    margin: 0;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    overflow: hidden;
    background: var(--bg-surface);
}
.feature-row {
    display: flex;
    gap: 0.85rem;
    padding: 0.75rem;
    align-items: flex-start;
    border-bottom: 1px solid var(--border);
}
.feature-row:last-child { border-bottom: none; }
.feature-icon { width: 20px; height: 20px; flex-shrink: 0; margin-top: 0.15rem; color: var(--text-muted); }
.feature-meta { flex: 1; min-width: 0; }
.feature-name { font-weight: 500; color: var(--text-strong); }
.feature-desc { font-size: 0.82rem; line-height: 1.35; margin-top: 0.2rem; }
.plugin-tag { font-weight: 400; font-size: 0.78rem; }

.toggle {
    position: relative;
    width: 32px;
    height: 18px;
    flex-shrink: 0;
    cursor: pointer;
    border: none;
    padding: 0;
    background: none;
    margin-top: 0.15rem;
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
