<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { Icon } from '@iconify/vue';
import { RouterLink } from 'vue-router';
import type { BehaviorSource } from '../../../api/behavior';

/**
 * BehaviorSourceNotice — M1-D1
 *
 * plugin/system source 的來源說明 banner。
 * - plugin：顯示「來自 Plugin: X」+ RouterLink 到 /admin/plugins/:pluginKey
 *   （M1-D2 接線前為 placeholder link）
 * - system：顯示「系統內建 behavior，僅可修改觸發指令」
 * - custom：不渲染（父元件不應傳 custom）
 *
 * 對齊 D-ui §1.4 來源說明 banner + §6 拒絕 AI slop：
 * - plugin banner 有 router-link（非純文字）
 * - 底色用 CSS 變數 --source-plugin-bg / --source-system-bg
 */

const { t } = useI18n();

const props = defineProps<{
    source: BehaviorSource;
    /** plugin name（source=plugin 時使用）*/
    pluginName?: string;
    /** plugin key（用於 /admin/plugins/:pluginKey 連結）*/
    pluginKey?: string;
}>();

const isPlugin = computed(() => props.source === 'plugin');
const isSystem = computed(() => props.source === 'system');
</script>

<template>
    <div v-if="isPlugin" class="source-notice source-notice--plugin">
        <Icon icon="material-symbols:extension-outline" width="16" height="16" class="notice-icon" aria-hidden="true" />
        <span class="notice-text">
            {{ t('behaviors.card.sourceNoticPlugin', { name: pluginName ?? '?' }) }}
        </span>
        <RouterLink
            :to="`/admin/plugins/${pluginKey ?? ''}`"
            class="notice-link"
        >
            {{ t('behaviors.card.sourceNoticPluginLink') }}
            <Icon icon="material-symbols:arrow-outward-rounded" width="13" height="13" aria-hidden="true" />
        </RouterLink>
    </div>

    <div v-else-if="isSystem" class="source-notice source-notice--system">
        <Icon icon="material-symbols:settings-outline" width="16" height="16" class="notice-icon" aria-hidden="true" />
        <span class="notice-text">{{ t('behaviors.card.sourceNoticSystem') }}</span>
    </div>
</template>

<style scoped>
.source-notice {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.55rem 0.75rem;
    border-radius: var(--radius-sm);
    font-size: 0.85rem;
    border: 1px solid transparent;
    flex-wrap: wrap;
}

.source-notice--plugin {
    background: var(--source-plugin-bg, rgba(124, 58, 237, 0.08));
    border-color: var(--source-plugin-border, rgba(124, 58, 237, 0.2));
    color: var(--source-plugin-text, #7c3aed);
}

.source-notice--system {
    background: var(--bg-page);
    border-color: var(--border);
    color: var(--text-muted);
}

.notice-icon {
    flex-shrink: 0;
    opacity: 0.85;
}

.notice-text {
    flex: 1;
    min-width: 0;
    color: inherit;
}

.notice-link {
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
    color: var(--source-plugin-text, #7c3aed);
    text-decoration: none;
    font-weight: 500;
    flex-shrink: 0;
    white-space: nowrap;
}
.notice-link:hover {
    text-decoration: underline;
}
</style>
