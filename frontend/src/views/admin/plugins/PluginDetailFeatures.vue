<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { Icon } from '@iconify/vue';
import type { PluginDetailRecord } from '../../../api/plugins';

const props = defineProps<{
    plugin: PluginDetailRecord;
}>();

const { t } = useI18n();

const features = computed(() => props.plugin.manifest?.guild_features ?? []);
</script>

<template>
    <div class="tab-panel">
        <div class="intro-banner">
            <Icon icon="material-symbols:info-outline-rounded" width="15" height="15" class="intro-icon" />
            <p class="intro-text">{{ t('admin.plugins.detail.features.intro') }}</p>
        </div>

        <div v-if="features.length === 0" class="empty">
            <Icon icon="material-symbols:hub-outline" width="28" height="28" class="empty-icon" />
            <span>{{ t('admin.plugins.detail.features.empty') }}</span>
        </div>

        <div v-else class="feature-list">
            <article v-for="feat in features" :key="feat.key" class="feat-card">
                <div class="feat-head">
                    <span v-if="feat.icon" class="feat-icon-emoji">{{ feat.icon }}</span>
                    <Icon v-else icon="material-symbols:hub-outline" width="16" height="16" class="feat-icon-fallback" />
                    <div class="feat-info">
                        <span class="feat-name">{{ feat.name }}</span>
                        <code class="feat-key">{{ feat.key }}</code>
                    </div>
                    <!-- read-only: per-guild toggle 在 admin/guilds 頁 -->
                    <span class="readonly-badge">
                        <Icon icon="material-symbols:visibility-outline-rounded" width="11" height="11" />
                        唯讀
                    </span>
                </div>
                <p v-if="feat.description" class="feat-desc">{{ feat.description }}</p>
                <div v-if="feat.commands && feat.commands.length > 0" class="feat-commands">
                    <span class="feat-commands-label">Feature 指令：</span>
                    <code v-for="cmd in feat.commands" :key="cmd.name" class="cmd-chip">/{{ cmd.name }}</code>
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

.feature-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
}
.feat-card {
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-base);
    padding: 0.7rem 0.85rem;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
}
.feat-head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
}
.feat-icon-emoji { font-size: 1.1rem; line-height: 1; flex-shrink: 0; }
.feat-icon-fallback { color: var(--text-muted); flex-shrink: 0; }
.feat-info {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex: 1;
    min-width: 0;
    flex-wrap: wrap;
}
.feat-name {
    font-weight: 600;
    font-size: 0.9rem;
    color: var(--text-strong);
}
.feat-key {
    font-family: var(--font-mono, monospace);
    font-size: 0.75rem;
    background: var(--bg-page);
    padding: 0.1rem 0.3rem;
    border-radius: var(--radius-sm);
    color: var(--text-muted);
    border: 1px solid var(--border);
}
.readonly-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
    font-size: 0.72rem;
    background: var(--bg-page);
    color: var(--text-muted);
    border: 1px solid var(--border);
    border-radius: 999px;
    padding: 0.1rem 0.4rem;
    flex-shrink: 0;
}
.feat-desc {
    margin: 0;
    font-size: 0.85rem;
    color: var(--text-muted);
    line-height: 1.4;
}
.feat-commands {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    flex-wrap: wrap;
    margin-top: 0.1rem;
}
.feat-commands-label {
    font-size: 0.78rem;
    color: var(--text-muted);
}
.cmd-chip {
    font-family: var(--font-mono, monospace);
    font-size: 0.75rem;
    background: var(--bg-page);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 0.1rem 0.35rem;
    color: var(--text);
}
</style>
