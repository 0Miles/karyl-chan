<script setup lang="ts">
import { ref, computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { Icon } from '@iconify/vue';
import type { PluginDetailRecord } from '../../../api/plugins';
import { setPluginBehaviorOverride } from '../../../api/plugins';

const props = defineProps<{
    plugin: PluginDetailRecord;
}>();

const { t } = useI18n();

interface ManifestOption {
    type: string;
    name: string;
    description?: string;
    required?: boolean;
    options?: ManifestOption[];
}

interface BehaviorItem {
    key: string;
    name?: string;
    description?: string;
    supports_continuous?: boolean;
    scope?: string;
    integration_types?: string[];
    contexts?: string[];
    enabled?: boolean;
    slashHints?: {
        suggested_name?: string;
        suggested_description?: string;
        options?: ManifestOption[];
    };
}

// v2 manifest 用 behaviors[]，v1 用 dm_behaviors[]
const behaviors = computed((): BehaviorItem[] => {
    const m = props.plugin.manifest;
    const raw = m?.behaviors ?? m?.dm_behaviors ?? [];
    return raw as BehaviorItem[];
});

// Optimistic toggle state：key → enabled（undefined 表示使用 manifest 值）
const overrides = ref<Map<string, boolean>>(new Map());
const toggling = ref<Set<string>>(new Set());
const toastMsg = ref<string | null>(null);
let toastTimer: ReturnType<typeof setTimeout> | null = null;

function getEnabled(beh: BehaviorItem): boolean {
    if (overrides.value.has(beh.key)) return overrides.value.get(beh.key)!;
    return beh.enabled !== false; // 預設 true
}

function showToast(msg: string) {
    toastMsg.value = msg;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastMsg.value = null; }, 2500);
}

async function handleToggle(beh: BehaviorItem) {
    const key = beh.key;
    if (toggling.value.has(key)) return;

    const newEnabled = !getEnabled(beh);

    // Optimistic update
    toggling.value.add(key);
    overrides.value.set(key, newEnabled);

    try {
        await setPluginBehaviorOverride(props.plugin.pluginKey, key, newEnabled);
        showToast(
            newEnabled
                ? t('admin.plugins.detail.behaviors.toggleSuccess')
                : t('admin.plugins.detail.behaviors.toggleSuccess'),
        );
    } catch {
        // Rollback
        overrides.value.set(key, !newEnabled);
        showToast(t('admin.plugins.detail.behaviors.toggleError'));
    } finally {
        toggling.value.delete(key);
    }
}
</script>

<template>
    <div class="tab-panel">
        <div class="intro-banner">
            <Icon icon="material-symbols:info-outline-rounded" width="15" height="15" class="intro-icon" />
            <p class="intro-text">{{ t('admin.plugins.detail.behaviors.intro') }}</p>
        </div>

        <!-- Toast notification -->
        <Transition name="fade">
            <div v-if="toastMsg" class="toast" role="status">
                <Icon icon="material-symbols:check-circle-outline-rounded" width="14" height="14" />
                <span>{{ toastMsg }}</span>
            </div>
        </Transition>

        <div v-if="behaviors.length === 0" class="empty">
            <Icon icon="material-symbols:forum-outline" width="28" height="28" class="empty-icon" />
            <span>{{ t('admin.plugins.detail.behaviors.empty') }}</span>
        </div>

        <div v-else class="behavior-list">
            <article v-for="beh in behaviors" :key="beh.key" class="beh-card" :class="{ 'beh-card--disabled': !getEnabled(beh) }">
                <div class="beh-head">
                    <code class="beh-key">{{ beh.key }}</code>
                    <span v-if="beh.supports_continuous" class="badge badge-continuous">
                        <Icon icon="material-symbols:repeat-rounded" width="11" height="11" />
                        {{ t('admin.plugins.detail.behaviors.supportsContinuous') }}
                    </span>
                    <span class="badge badge-readonly">
                        <Icon icon="material-symbols:lock-outline-rounded" width="11" height="11" />
                        {{ t('admin.plugins.detail.behaviors.axesReadonly') }}
                    </span>

                    <!-- Toggle switch -->
                    <button
                        class="toggle-btn"
                        :class="{ 'toggle-btn--on': getEnabled(beh), 'toggle-btn--loading': toggling.has(beh.key) }"
                        :disabled="toggling.has(beh.key)"
                        :aria-label="getEnabled(beh) ? t('admin.plugins.detail.behaviors.toggleOff') : t('admin.plugins.detail.behaviors.toggleOn')"
                        :title="getEnabled(beh) ? t('admin.plugins.detail.behaviors.toggleOff') : t('admin.plugins.detail.behaviors.toggleOn')"
                        @click="handleToggle(beh)"
                    >
                        <span class="toggle-track">
                            <span class="toggle-thumb" />
                        </span>
                    </button>
                </div>
                <p v-if="beh.name" class="beh-name">{{ beh.name }}</p>
                <p v-if="beh.description" class="beh-desc">{{ beh.description }}</p>

                <!-- 三軸 read-only badges (if provided by manifest) -->
                <div class="axes-row">
                    <span v-if="beh.scope" class="axis-badge">Scope: {{ beh.scope }}</span>
                    <span v-if="beh.integration_types?.length" class="axis-badge">
                        IntegType: {{ beh.integration_types!.join(', ') }}
                    </span>
                    <span v-if="beh.contexts?.length" class="axis-badge">
                        Ctx: {{ beh.contexts!.join(', ') }}
                    </span>
                </div>

                <!-- slashHints.options 嵌套展示（read-only） -->
                <details v-if="beh.slashHints?.options?.length" class="opts-details">
                    <summary class="opts-summary">
                        <Icon icon="material-symbols:code-blocks-outline-rounded" width="12" height="12" />
                        {{ t('admin.plugins.detail.behaviors.slashOptions', { count: beh.slashHints!.options!.length }) }}
                    </summary>
                    <ul class="opts-list">
                        <li v-for="opt in beh.slashHints!.options" :key="opt.name" class="opt-item">
                            <code class="opt-type">{{ opt.type }}</code>
                            <span class="opt-name">{{ opt.name }}</span>
                            <span v-if="opt.required" class="opt-required">*</span>
                            <span v-if="opt.description" class="opt-desc">— {{ opt.description }}</span>
                            <!-- 嵌套 sub_command options -->
                            <ul v-if="opt.options?.length" class="opts-list opts-list--nested">
                                <li v-for="sub in opt.options" :key="sub.name" class="opt-item">
                                    <code class="opt-type">{{ sub.type }}</code>
                                    <span class="opt-name">{{ sub.name }}</span>
                                    <span v-if="sub.required" class="opt-required">*</span>
                                    <span v-if="sub.description" class="opt-desc">— {{ sub.description }}</span>
                                </li>
                            </ul>
                        </li>
                    </ul>
                </details>
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

.toast {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.45rem 0.75rem;
    background: color-mix(in srgb, var(--success, #16a34a) 12%, var(--bg-surface));
    border: 1px solid color-mix(in srgb, var(--success, #16a34a) 30%, transparent);
    border-radius: var(--radius-sm);
    font-size: 0.82rem;
    color: var(--success, #16a34a);
}
.fade-enter-active,
.fade-leave-active { transition: opacity 0.2s; }
.fade-enter-from,
.fade-leave-to { opacity: 0; }

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

.behavior-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
}
.beh-card {
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-base);
    padding: 0.7rem 0.85rem;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    transition: opacity 0.15s;
}
.beh-card--disabled {
    opacity: 0.6;
}
.beh-head {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    flex-wrap: wrap;
}
.beh-key {
    font-family: var(--font-mono, monospace);
    font-size: 0.82rem;
    background: var(--bg-page);
    padding: 0.1rem 0.35rem;
    border-radius: var(--radius-sm);
    color: var(--text-strong);
    border: 1px solid var(--border);
}
.badge {
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
    font-size: 0.72rem;
    padding: 0.1rem 0.4rem;
    border-radius: 999px;
    border: 1px solid transparent;
    font-weight: 500;
}
.badge-continuous {
    background: color-mix(in srgb, var(--accent) 12%, var(--bg-page));
    color: var(--accent);
    border-color: color-mix(in srgb, var(--accent) 30%, transparent);
}
.badge-readonly {
    background: var(--bg-page);
    color: var(--text-muted);
    border-color: var(--border);
}
.beh-name {
    margin: 0;
    font-weight: 500;
    font-size: 0.9rem;
    color: var(--text-strong);
}
.beh-desc {
    margin: 0;
    font-size: 0.85rem;
    color: var(--text-muted);
    line-height: 1.4;
}
.axes-row {
    display: flex;
    gap: 0.35rem;
    flex-wrap: wrap;
    margin-top: 0.15rem;
}
.axis-badge {
    display: inline-block;
    font-size: 0.72rem;
    font-family: var(--font-mono, monospace);
    background: var(--bg-page);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 0.1rem 0.35rem;
    color: var(--text-muted);
}

/* slashHints options tree */
.opts-details {
    margin-top: 0.3rem;
}
.opts-summary {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 0.76rem;
    color: var(--text-muted);
    cursor: pointer;
    user-select: none;
    list-style: none;
}
.opts-summary::-webkit-details-marker { display: none; }
.opts-list {
    list-style: none;
    margin: 0.3rem 0 0 0.6rem;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
}
.opts-list--nested {
    margin-left: 1rem;
}
.opt-item {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 0.76rem;
    flex-wrap: wrap;
}
.opt-type {
    font-size: 0.7rem;
    background: var(--bg-page);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 0.05rem 0.3rem;
    color: var(--accent);
    font-weight: 600;
}
.opt-name {
    font-family: var(--font-mono, monospace);
    font-size: 0.76rem;
    color: var(--text-strong);
}
.opt-required {
    color: var(--danger, #dc2626);
    font-weight: 700;
    font-size: 0.8rem;
}
.opt-desc {
    color: var(--text-muted);
    font-size: 0.72rem;
}

/* Toggle switch */
.toggle-btn {
    display: inline-flex;
    align-items: center;
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    margin-left: auto;
    flex-shrink: 0;
}
.toggle-btn:disabled {
    cursor: not-allowed;
    opacity: 0.6;
}
.toggle-track {
    display: inline-block;
    width: 2.2rem;
    height: 1.2rem;
    border-radius: 999px;
    background: var(--border);
    position: relative;
    transition: background 0.2s;
}
.toggle-btn--on .toggle-track {
    background: var(--accent, #5865f2);
}
.toggle-thumb {
    position: absolute;
    top: 0.15rem;
    left: 0.15rem;
    width: 0.9rem;
    height: 0.9rem;
    border-radius: 50%;
    background: #fff;
    transition: left 0.2s;
    box-shadow: 0 1px 3px rgba(0,0,0,0.2);
}
.toggle-btn--on .toggle-thumb {
    left: calc(100% - 0.15rem - 0.9rem);
}
.toggle-btn--loading .toggle-track {
    opacity: 0.7;
}
</style>
