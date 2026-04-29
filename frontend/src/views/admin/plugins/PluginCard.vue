<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { Icon } from '@iconify/vue';
import { setPluginEnabled, type PluginRecord } from '../../../api/plugins';

const props = defineProps<{
    plugin: PluginRecord;
}>();

const emit = defineEmits<{
    (e: 'updated', plugin: { id: number; pluginKey: string; enabled: boolean }): void;
}>();

const { t } = useI18n();

const open = ref(false);
const saving = ref(false);
const error = ref<string | null>(null);

// Same single-source pattern that finally fixed the behaviors toggle:
// drive the visual state from a local ref that we update optimistically
// on click and reconcile from the prop on success/failure.
const enabledLocal = ref(props.plugin.enabled);
// Watch the prop in case the parent reloads the list and hands us a
// fresh PluginRecord with a different `enabled`.
import { watch } from 'vue';
watch(() => props.plugin.enabled, (next) => { enabledLocal.value = next; });

const statusColor = computed(() =>
    props.plugin.status === 'active' ? 'var(--success, #16a34a)' : 'var(--text-muted)'
);
const statusLabel = computed(() =>
    props.plugin.status === 'active'
        ? t('admin.plugins.statusActive')
        : t('admin.plugins.statusInactive')
);

const lastHeartbeat = computed(() => {
    if (!props.plugin.lastHeartbeatAt) return t('admin.plugins.neverHeartbeat');
    const d = new Date(props.plugin.lastHeartbeatAt);
    const ageSec = Math.floor((Date.now() - d.getTime()) / 1000);
    if (ageSec < 60) return t('admin.plugins.heartbeatJustNow');
    if (ageSec < 3600) return t('admin.plugins.heartbeatMinutesAgo', { n: Math.floor(ageSec / 60) });
    if (ageSec < 86400) return t('admin.plugins.heartbeatHoursAgo', { n: Math.floor(ageSec / 3600) });
    return d.toLocaleString();
});

const dmBehaviorCount = computed(() => props.plugin.manifest?.dm_behaviors?.length ?? 0);
const guildFeatureCount = computed(() => props.plugin.manifest?.guild_features?.length ?? 0);
const commandCount = computed(() => props.plugin.manifest?.commands?.length ?? 0);
const rpcScopes = computed(() => props.plugin.manifest?.rpc_methods_used ?? []);
const description = computed(() => props.plugin.manifest?.plugin.description ?? '');

async function onToggleEnabled() {
    if (saving.value) return;
    const next = !enabledLocal.value;
    enabledLocal.value = next;
    saving.value = true;
    error.value = null;
    try {
        const updated = await setPluginEnabled(props.plugin.id, next);
        emit('updated', updated);
    } catch (err) {
        error.value = err instanceof Error ? err.message : String(err);
        enabledLocal.value = props.plugin.enabled;
    } finally {
        saving.value = false;
    }
}
</script>

<template>
    <article :class="['card', { 'is-disabled': !enabledLocal }]">
        <header class="card-head">
            <button
                type="button"
                class="title-btn"
                @click="open = !open"
                :aria-expanded="open"
            >
                <Icon
                    :icon="open ? 'material-symbols:expand-less-rounded' : 'material-symbols:expand-more-rounded'"
                    width="18"
                    height="18"
                />
                <span class="title">{{ plugin.name }}</span>
                <span class="key">{{ plugin.pluginKey }}</span>
                <span class="version">v{{ plugin.version }}</span>
            </button>
            <span class="status-dot" :style="{ background: statusColor }" :title="statusLabel" />
            <span class="status-text">{{ statusLabel }}</span>
            <button
                type="button"
                role="switch"
                :class="['toggle', { on: enabledLocal }]"
                :title="enabledLocal ? t('admin.plugins.toggleEnabled') : t('admin.plugins.toggleDisabled')"
                :aria-checked="enabledLocal ? 'true' : 'false'"
                :disabled="saving"
                @click.stop="onToggleEnabled"
            >
                <span class="slider" aria-hidden="true"></span>
            </button>
        </header>

        <div v-if="open" class="card-body">
            <p v-if="description" class="desc">{{ description }}</p>

            <div class="stats-row">
                <span class="stat" v-if="dmBehaviorCount > 0">
                    <Icon icon="material-symbols:forum-outline" width="14" height="14" />
                    {{ t('admin.plugins.dmBehaviorsCount', { n: dmBehaviorCount }) }}
                </span>
                <span class="stat" v-if="guildFeatureCount > 0">
                    <Icon icon="material-symbols:hub-outline" width="14" height="14" />
                    {{ t('admin.plugins.guildFeaturesCount', { n: guildFeatureCount }) }}
                </span>
                <span class="stat" v-if="commandCount > 0">
                    <Icon icon="material-symbols:terminal" width="14" height="14" />
                    {{ t('admin.plugins.commandsCount', { n: commandCount }) }}
                </span>
            </div>

            <dl class="meta">
                <div class="meta-row">
                    <dt>{{ t('admin.plugins.url') }}</dt>
                    <dd><code>{{ plugin.url }}</code></dd>
                </div>
                <div class="meta-row">
                    <dt>{{ t('admin.plugins.lastHeartbeat') }}</dt>
                    <dd>{{ lastHeartbeat }}</dd>
                </div>
                <div class="meta-row" v-if="rpcScopes.length > 0">
                    <dt>{{ t('admin.plugins.rpcScopes') }}</dt>
                    <dd>
                        <code v-for="s in rpcScopes" :key="s" class="scope-chip">{{ s }}</code>
                    </dd>
                </div>
            </dl>

            <details v-if="plugin.manifest" class="manifest-fold">
                <summary>{{ t('admin.plugins.manifestRaw') }}</summary>
                <pre>{{ JSON.stringify(plugin.manifest, null, 2) }}</pre>
            </details>

            <p v-if="error" class="error" role="alert">{{ error }}</p>
        </div>
    </article>
</template>

<style scoped>
.card {
    border: 1px solid var(--border);
    border-radius: var(--radius-base);
    background: var(--bg-surface);
    overflow: hidden;
}
.card.is-disabled .title { color: var(--text-muted); }
.card-head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem;
    background: var(--bg-page);
    border-bottom: 1px solid transparent;
}
.card-head:has(+ .card-body) { border-bottom-color: var(--border); }
.title-btn {
    flex: 1;
    min-width: 0;
    background: none;
    border: none;
    text-align: left;
    cursor: pointer;
    color: var(--text);
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.25rem 0.1rem;
    overflow: hidden;
}
.title-btn:hover { color: var(--text-strong); }
.title {
    font-weight: 600;
    color: var(--text-strong);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.key {
    font-family: var(--font-mono, monospace);
    font-size: 0.78rem;
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
}
.version {
    font-size: 0.72rem;
    color: var(--text-faint);
    flex-shrink: 0;
}
.status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
}
.status-text {
    font-size: 0.78rem;
    color: var(--text-muted);
    flex-shrink: 0;
}
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

.card-body {
    padding: 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
}
.desc {
    margin: 0;
    color: var(--text);
    white-space: pre-wrap;
    line-height: 1.5;
}
.stats-row {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
}
.stat {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.78rem;
    color: var(--text-muted);
    background: var(--bg-page);
    padding: 0.18rem 0.5rem;
    border-radius: 999px;
    border: 1px solid var(--border);
}
.meta {
    margin: 0;
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 0.3rem 0.6rem;
    font-size: 0.85rem;
}
.meta-row { display: contents; }
.meta dt { color: var(--text-muted); }
.meta dd { margin: 0; color: var(--text); display: flex; flex-wrap: wrap; gap: 0.25rem; }
.meta code {
    font-family: var(--font-mono, monospace);
    font-size: 0.78rem;
    background: var(--bg-page);
    padding: 0.1rem 0.35rem;
    border-radius: var(--radius-sm);
}
.scope-chip { background: var(--bg-page); }
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
.error { color: var(--danger); margin: 0; font-size: 0.85rem; }
</style>
