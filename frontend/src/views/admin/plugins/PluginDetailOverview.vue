<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { Icon } from '@iconify/vue';
import { getPluginConfig, setPluginConfig, type PluginConfigField, type PluginDetailRecord } from '../../../api/plugins';

const props = defineProps<{
    plugin: PluginDetailRecord;
}>();

const { t } = useI18n();

const manifest = computed(() => props.plugin.manifest);
const hasConfigSchema = computed(() => (manifest.value?.config_schema?.length ?? 0) > 0);

// Config editor (same lazy-load pattern as PluginCard)
const configSchema = ref<PluginConfigField[]>([]);
const configValues = reactive<Record<string, string>>({});
const configLoaded = ref(false);
const configLoading = ref(false);
const configSaving = ref(false);
const configError = ref<string | null>(null);
const configSavedAt = ref<number | null>(null);

async function loadConfig() {
    if (configLoaded.value || configLoading.value) return;
    configLoading.value = true;
    configError.value = null;
    try {
        const r = await getPluginConfig(props.plugin.id);
        configSchema.value = r.schema;
        for (const v of r.values) {
            configValues[v.key] = v.value ?? '';
        }
        for (const f of r.schema) {
            if (!(f.key in configValues)) {
                configValues[f.key] = (f.default as string | undefined) ?? '';
            }
        }
        configLoaded.value = true;
    } catch (err) {
        configError.value = err instanceof Error ? err.message : String(err);
    } finally {
        configLoading.value = false;
    }
}

async function saveConfig() {
    if (configSaving.value) return;
    configSaving.value = true;
    configError.value = null;
    try {
        await setPluginConfig(props.plugin.id, { ...configValues });
        configSavedAt.value = Date.now();
    } catch (err) {
        configError.value = err instanceof Error ? err.message : String(err);
    } finally {
        configSaving.value = false;
    }
}

watch(() => props.plugin.id, () => {
    configLoaded.value = false;
});

onMounted(() => {
    if (hasConfigSchema.value) void loadConfig();
});
</script>

<template>
    <div class="tab-panel">
        <!-- Meta grid -->
        <section class="section">
            <dl class="meta">
                <div class="meta-row">
                    <dt>{{ t('admin.plugins.detail.overviewMeta.pluginKey') }}</dt>
                    <dd><code>{{ plugin.pluginKey }}</code></dd>
                </div>
                <div class="meta-row">
                    <dt>{{ t('admin.plugins.url') }}</dt>
                    <dd><code>{{ plugin.url }}</code></dd>
                </div>
                <div v-if="manifest?.plugin.author" class="meta-row">
                    <dt>{{ t('admin.plugins.detail.overviewMeta.author') }}</dt>
                    <dd>{{ manifest.plugin.author }}</dd>
                </div>
                <div v-if="manifest?.plugin.homepage" class="meta-row">
                    <dt>{{ t('admin.plugins.detail.overviewMeta.homepage') }}</dt>
                    <dd>
                        <a :href="manifest.plugin.homepage" target="_blank" rel="noopener" class="link">
                            {{ manifest.plugin.homepage }}
                        </a>
                    </dd>
                </div>
                <div class="meta-row">
                    <dt>{{ t('admin.plugins.lastHeartbeat') }}</dt>
                    <dd>{{ plugin.lastHeartbeatAt ?? t('admin.plugins.neverHeartbeat') }}</dd>
                </div>
            </dl>
        </section>

        <!-- Config editor -->
        <section v-if="hasConfigSchema" class="section config-section">
            <div class="section-header">
                <h3 class="section-title">外掛設定</h3>
                <span v-if="configSavedAt && (Date.now() - configSavedAt < 4000)" class="saved-badge">已儲存</span>
            </div>
            <p v-if="configLoading" class="muted">{{ t('common.loading') }}</p>
            <p v-if="configError" class="error" role="alert">{{ configError }}</p>
            <div v-else-if="configLoaded" class="config-grid">
                <label
                    v-for="field in configSchema"
                    :key="field.key"
                    :class="['config-field', { full: field.type === 'textarea' }]"
                >
                    <span class="config-label">
                        {{ field.label }}
                        <span v-if="field.required" class="req" aria-hidden="true">*</span>
                        <span v-if="field.description" class="hint">{{ field.description }}</span>
                    </span>
                    <textarea
                        v-if="field.type === 'textarea'"
                        v-model="configValues[field.key]"
                        rows="3"
                        spellcheck="false"
                    />
                    <select
                        v-else-if="field.type === 'select' && field.options"
                        v-model="configValues[field.key]"
                    >
                        <option value="">—</option>
                        <option v-for="opt in field.options" :key="opt.value" :value="opt.value">
                            {{ opt.label }}
                        </option>
                    </select>
                    <input
                        v-else-if="field.type === 'boolean'"
                        type="checkbox"
                        :checked="configValues[field.key] === 'true'"
                        @change="(e) => { configValues[field.key] = (e.target as HTMLInputElement).checked ? 'true' : 'false'; }"
                    />
                    <input
                        v-else
                        v-model="configValues[field.key]"
                        :type="field.type === 'secret' ? 'password' : (field.type === 'number' ? 'number' : 'text')"
                        :placeholder="field.type === 'secret' ? '留空 = 不變更' : ''"
                        autocomplete="off"
                        spellcheck="false"
                    />
                </label>
                <div class="config-actions">
                    <button type="button" class="primary" :disabled="configSaving" @click="saveConfig">
                        {{ configSaving ? '儲存中…' : '儲存設定' }}
                    </button>
                </div>
            </div>
        </section>

        <!-- Raw manifest -->
        <details v-if="manifest" class="manifest-fold">
            <summary>{{ t('admin.plugins.manifestRaw') }}</summary>
            <pre>{{ JSON.stringify(manifest, null, 2) }}</pre>
        </details>
    </div>
</template>

<style scoped>
.tab-panel {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    padding: 0.5rem 0;
}
.section {
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-base);
    padding: 0.8rem 1rem;
}
.section-header {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    margin-bottom: 0.75rem;
}
.section-title {
    margin: 0;
    font-size: 0.92rem;
    font-weight: 600;
    color: var(--text-strong);
    flex: 1;
}
.saved-badge { color: var(--accent); font-size: 0.78rem; }
.meta {
    margin: 0;
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 0.35rem 0.75rem;
    font-size: 0.85rem;
}
.meta-row { display: contents; }
.meta dt { color: var(--text-muted); }
.meta dd { margin: 0; color: var(--text); }
.meta code {
    font-family: var(--font-mono, monospace);
    font-size: 0.78rem;
    background: var(--bg-page);
    padding: 0.1rem 0.35rem;
    border-radius: var(--radius-sm);
}
.link { color: var(--accent); text-decoration: none; }
.link:hover { text-decoration: underline; }

.config-section { margin-top: 0; }
.config-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: 0.6rem 0.85rem;
}
.config-field { display: flex; flex-direction: column; gap: 0.25rem; }
.config-field.full { grid-column: 1 / -1; }
.config-label {
    display: flex; flex-direction: column;
    font-size: 0.82rem;
    color: var(--text-strong);
    font-weight: 500;
}
.config-label .req { color: var(--danger); margin-left: 0.2rem; font-weight: 400; }
.config-label .hint { color: var(--text-muted); font-weight: 400; font-size: 0.75rem; margin-top: 0.1rem; }
.config-field input[type="text"],
.config-field input[type="number"],
.config-field input[type="password"],
.config-field textarea,
.config-field select {
    padding: 0.35rem 0.5rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg-surface);
    color: var(--text);
    font-size: 0.85rem;
    font-family: inherit;
}
.config-field input[type="checkbox"] { align-self: flex-start; margin-top: 0.2rem; }
.config-actions {
    grid-column: 1 / -1;
    display: flex; justify-content: flex-end;
}
.config-actions .primary {
    padding: 0.4rem 0.85rem;
    background: var(--accent);
    color: var(--text-on-accent);
    border: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
    font-size: 0.85rem;
}
.config-actions .primary:disabled { opacity: 0.55; cursor: not-allowed; }

.manifest-fold summary { cursor: pointer; color: var(--text-muted); font-size: 0.85rem; }
.manifest-fold pre {
    margin-top: 0.4rem;
    padding: 0.5rem;
    background: var(--bg-page);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    font-size: 0.75rem;
    overflow: auto;
    max-height: 24rem;
    color: var(--text);
}
.muted { color: var(--text-muted); font-size: 0.85rem; }
.error { color: var(--danger); margin: 0; font-size: 0.85rem; }
</style>
