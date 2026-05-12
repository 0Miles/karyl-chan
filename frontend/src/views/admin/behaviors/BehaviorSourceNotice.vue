<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { Icon } from '@iconify/vue';
import type { BehaviorSource } from '../../../api/behavior';

/**
 * BehaviorSourceNotice — banner for non-custom sources.
 * - system：「系統內建 behavior，僅可修改觸發指令」
 * - custom：不渲染（父元件不應傳 custom）
 */

const { t } = useI18n();

const props = defineProps<{
    source: BehaviorSource;
}>();

const isSystem = computed(() => props.source === 'system');
</script>

<template>
    <div v-if="isSystem" class="source-notice source-notice--system">
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
</style>
