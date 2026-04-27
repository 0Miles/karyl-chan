<script setup lang="ts">
import { computed } from 'vue';
import type { SystemStats } from '../../../api/types';

const props = defineProps<{
    stats: SystemStats | null;
}>();

interface AttentionItem {
    kind: 'critical' | 'warning';
    icon: string;
    titleKey: string;
    descKey: string;
}

const items = computed<AttentionItem[]>(() => {
    if (!props.stats) return [];
    const out: AttentionItem[] = [];

    if (!props.stats.dbConnected) {
        out.push({
            kind: 'critical',
            icon: '⚠',
            titleKey: 'dashboard.attention.dbDisconnected',
            descKey: 'dashboard.attention.dbDisconnectedDesc'
        });
    }

    return out;
});

const hasItems = computed(() => items.value.length > 0);
</script>

<template>
    <section v-if="hasItems" class="attention" aria-label="Needs attention">
        <h2 class="section-title">{{ $t('dashboard.attention.title') }}</h2>
        <div class="item-list">
            <div
                v-for="(item, i) in items"
                :key="i"
                class="item"
                :class="`item--${item.kind}`"
                role="alert"
            >
                <span class="item-icon" aria-hidden="true">{{ item.icon }}</span>
                <div class="item-body">
                    <span class="item-title">{{ $t(item.titleKey) }}</span>
                    <span class="item-desc">{{ $t(item.descKey) }}</span>
                </div>
            </div>
        </div>
    </section>
</template>

<style scoped>
.attention {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
}

.section-title {
    font-size: 0.7rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-muted);
    margin: 0;
}

.item-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
}

.item {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    padding: 0.85rem 1rem;
    border-radius: var(--radius-lg);
    border-left: 3px solid transparent;
}

.item--critical {
    background: rgba(237, 66, 69, 0.1);
    border-left-color: #ed4245;
}

.item--warning {
    background: var(--warn-bg);
    border-left-color: #faa61a;
}

.item-icon {
    font-size: 1.1rem;
    line-height: 1.3;
    flex-shrink: 0;
}

.item-body {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
}

.item-title {
    font-weight: 600;
    font-size: 0.875rem;
    color: var(--text-strong);
}

.item-desc {
    font-size: 0.8rem;
    color: var(--text-muted);
}
</style>
