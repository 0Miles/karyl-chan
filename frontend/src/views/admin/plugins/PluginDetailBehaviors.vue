<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { Icon } from '@iconify/vue';
import type { PluginDetailRecord } from '../../../api/plugins';

const props = defineProps<{
    plugin: PluginDetailRecord;
}>();

const { t } = useI18n();

// v2 manifest 用 behaviors[]，v1 用 dm_behaviors[]
const behaviors = computed(() => {
    const m = props.plugin.manifest;
    return m?.behaviors ?? m?.dm_behaviors ?? [];
});
</script>

<template>
    <div class="tab-panel">
        <div class="intro-banner">
            <Icon icon="material-symbols:info-outline-rounded" width="15" height="15" class="intro-icon" />
            <p class="intro-text">{{ t('admin.plugins.detail.behaviors.intro') }}</p>
        </div>

        <!-- OQ-11 placeholder notice -->
        <div class="oq-notice" role="note">
            <Icon icon="material-symbols:construction-rounded" width="14" height="14" />
            <span>{{ t('admin.plugins.detail.behaviors.oq11Notice') }}</span>
        </div>

        <div v-if="behaviors.length === 0" class="empty">
            <Icon icon="material-symbols:forum-outline" width="28" height="28" class="empty-icon" />
            <span>{{ t('admin.plugins.detail.behaviors.empty') }}</span>
        </div>

        <div v-else class="behavior-list">
            <article v-for="beh in behaviors" :key="beh.key" class="beh-card">
                <div class="beh-head">
                    <code class="beh-key">{{ beh.key }}</code>
                    <span v-if="beh.supports_continuous" class="badge badge-continuous">
                        <Icon icon="material-symbols:repeat-rounded" width="11" height="11" />
                        {{ t('admin.plugins.detail.behaviors.supportsContinuous') }}
                    </span>
                    <!-- read-only placeholder badge -->
                    <span class="badge badge-readonly">
                        <Icon icon="material-symbols:lock-outline-rounded" width="11" height="11" />
                        {{ t('admin.plugins.detail.behaviors.axesReadonly') }}
                    </span>
                </div>
                <p v-if="(beh as { name?: string }).name" class="beh-name">
                    {{ (beh as { name?: string }).name }}
                </p>
                <p v-if="beh.description" class="beh-desc">{{ beh.description }}</p>

                <!-- 三軸 read-only badges (if provided by manifest) -->
                <div class="axes-row">
                    <span v-if="(beh as { scope?: string }).scope" class="axis-badge">
                        Scope: {{ (beh as { scope?: string }).scope }}
                    </span>
                    <span v-if="(beh as { integration_types?: string[] }).integration_types?.length" class="axis-badge">
                        IntegType: {{ (beh as { integration_types?: string[] }).integration_types!.join(', ') }}
                    </span>
                    <span v-if="(beh as { contexts?: string[] }).contexts?.length" class="axis-badge">
                        Ctx: {{ (beh as { contexts?: string[] }).contexts!.join(', ') }}
                    </span>
                </div>
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

.oq-notice {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.5rem 0.75rem;
    background: color-mix(in srgb, var(--warning, #d97706) 10%, var(--bg-surface));
    border: 1px solid color-mix(in srgb, var(--warning, #d97706) 30%, transparent);
    border-radius: var(--radius-sm);
    font-size: 0.82rem;
    color: var(--warning, #d97706);
}

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
</style>
