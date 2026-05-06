<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { Icon } from '@iconify/vue';
import { setPluginCommandEnabled, type PluginDetailRecord } from '../../../api/plugins';

const props = defineProps<{
    plugin: PluginDetailRecord;
}>();

const emit = defineEmits<{
    (e: 'command-toggled', payload: { id: number; adminEnabled: boolean }): void;
}>();

const { t } = useI18n();

// 軌三 plugin_commands：featureKey=null
const thirdTrackCommands = computed(() =>
    props.plugin.pluginCommands.filter(c => c.featureKey === null)
);

// Parse manifestJson to get display fields
function parseManifest(json: string): Record<string, unknown> {
    try { return JSON.parse(json) as Record<string, unknown>; } catch { return {}; }
}

const savingIds = ref<Set<number>>(new Set());
const saveErrors = ref<Map<number, string>>(new Map());

async function onToggle(id: number, current: boolean) {
    if (savingIds.value.has(id)) return;
    savingIds.value = new Set([...savingIds.value, id]);
    saveErrors.value.delete(id);
    const next = !current;
    try {
        await setPluginCommandEnabled(id, next);
        emit('command-toggled', { id, adminEnabled: next });
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        saveErrors.value = new Map([...saveErrors.value, [id, msg]]);
    } finally {
        const s = new Set(savingIds.value);
        s.delete(id);
        savingIds.value = s;
    }
}
</script>

<template>
    <div class="tab-panel">
        <div class="intro-banner">
            <Icon icon="material-symbols:info-outline-rounded" width="15" height="15" class="intro-icon" />
            <p class="intro-text">{{ t('admin.plugins.detail.commands.intro') }}</p>
        </div>

        <div v-if="thirdTrackCommands.length === 0" class="empty">
            <Icon icon="material-symbols:terminal" width="28" height="28" class="empty-icon" />
            <span>{{ t('admin.plugins.detail.commands.empty') }}</span>
        </div>

        <div v-else class="command-list">
            <article v-for="cmd in thirdTrackCommands" :key="cmd.id" class="cmd-card">
                <div class="cmd-head">
                    <div class="cmd-identity">
                        <span class="cmd-name">
                            <Icon icon="material-symbols:terminal" width="13" height="13" class="cmd-icon" />
                            /{{ cmd.name }}
                        </span>
                        <p v-if="parseManifest(cmd.manifestJson).description" class="cmd-desc">
                            {{ parseManifest(cmd.manifestJson).description as string }}
                        </p>
                    </div>
                    <button
                        type="button"
                        role="switch"
                        :class="['toggle', { on: cmd.adminEnabled }]"
                        :aria-checked="cmd.adminEnabled ? 'true' : 'false'"
                        :disabled="savingIds.has(cmd.id)"
                        :title="cmd.adminEnabled
                            ? t('admin.plugins.detail.commands.toggleOff')
                            : t('admin.plugins.detail.commands.toggleOn')"
                        @click="onToggle(cmd.id, cmd.adminEnabled)"
                    >
                        <span class="slider" aria-hidden="true" />
                    </button>
                </div>

                <!-- 三軸 read-only badges -->
                <div class="axes-row">
                    <span v-if="(parseManifest(cmd.manifestJson).scope as string | undefined)" class="axis-badge">
                        Scope: {{ parseManifest(cmd.manifestJson).scope as string }}
                    </span>
                    <span
                        v-if="(parseManifest(cmd.manifestJson).integration_types as string[] | undefined)?.length"
                        class="axis-badge"
                    >
                        IntegType: {{ (parseManifest(cmd.manifestJson).integration_types as string[]).join(', ') }}
                    </span>
                    <span
                        v-if="(parseManifest(cmd.manifestJson).contexts as string[] | undefined)?.length"
                        class="axis-badge"
                    >
                        Ctx: {{ (parseManifest(cmd.manifestJson).contexts as string[]).join(', ') }}
                    </span>
                    <span
                        v-if="parseManifest(cmd.manifestJson).default_member_permissions"
                        class="axis-badge"
                    >
                        Perm: {{ parseManifest(cmd.manifestJson).default_member_permissions as string }}
                    </span>
                    <span
                        v-if="parseManifest(cmd.manifestJson).default_ephemeral !== undefined"
                        class="axis-badge"
                    >
                        Ephemeral: {{ parseManifest(cmd.manifestJson).default_ephemeral ? 'true' : 'false' }}
                    </span>
                    <span class="axis-badge lock-badge">
                        <Icon icon="material-symbols:lock-outline-rounded" width="11" height="11" />
                        manifest 鎖定
                    </span>
                </div>

                <p v-if="saveErrors.get(cmd.id)" class="cmd-error" role="alert">
                    {{ saveErrors.get(cmd.id) }}
                </p>
            </article>
        </div>
    </div>
</template>

<style scoped>
.tab-panel {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding: 0.5rem 0;
}
.intro-banner {
    display: flex;
    align-items: flex-start;
    gap: 0.4rem;
    padding: 0.6rem 0.75rem;
    background: color-mix(in srgb, var(--accent) 8%, var(--bg-surface));
    border: 1px solid color-mix(in srgb, var(--accent) 25%, transparent);
    border-radius: var(--radius-sm);
    font-size: 0.85rem;
}
.intro-icon { color: var(--accent); flex-shrink: 0; margin-top: 0.1rem; }
.intro-text { margin: 0; color: var(--text); line-height: 1.5; }

.empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.4rem;
    padding: 2rem 1rem;
    color: var(--text-muted);
    font-size: 0.9rem;
    text-align: center;
}
.empty-icon { opacity: 0.5; }

.command-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
}
.cmd-card {
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-base);
    padding: 0.7rem 0.85rem;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
}
.cmd-head {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
}
.cmd-identity { flex: 1; min-width: 0; }
.cmd-name {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    font-family: var(--font-mono, monospace);
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--text-strong);
}
.cmd-icon { color: var(--text-muted); }
.cmd-desc {
    margin: 0.2rem 0 0;
    font-size: 0.85rem;
    color: var(--text-muted);
    line-height: 1.4;
}

/* Toggle switch */
.toggle {
    position: relative;
    width: 32px;
    height: 18px;
    flex-shrink: 0;
    cursor: pointer;
    border: none;
    padding: 0;
    background: none;
    margin-top: 0.1rem;
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

.axes-row {
    display: flex;
    gap: 0.35rem;
    flex-wrap: wrap;
}
.axis-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
    font-size: 0.72rem;
    font-family: var(--font-mono, monospace);
    background: var(--bg-page);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 0.1rem 0.35rem;
    color: var(--text-muted);
}
.lock-badge {
    font-family: inherit;
    background: color-mix(in srgb, var(--text-muted) 10%, var(--bg-page));
}
.cmd-error { color: var(--danger); margin: 0; font-size: 0.82rem; }
</style>
