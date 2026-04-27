<script setup lang="ts">
import { ref } from 'vue';
import { Icon } from '@iconify/vue';
import { useI18n } from 'vue-i18n';
import AppPopover from '../../components/AppPopover.vue';
import { dmProactiveFeatures } from './registry';

defineProps<{
    /** Disable the trigger when no DM channel is selected. */
    disabled?: boolean;
}>();

const emit = defineEmits<{
    (e: 'pick', name: string): void;
}>();

const { t } = useI18n();
const open = ref(false);

function pick(name: string) {
    open.value = false;
    emit('pick', name);
}
</script>

<template>
    <AppPopover
        v-model:open="open"
        placement="top-start"
        :drawer-title="t('dmProactiveFeatures.menuTitle')"
    >
        <template #trigger>
            <button
                type="button"
                class="icon-button"
                :disabled="disabled"
                :title="t('dmProactiveFeatures.menuTitle')"
                :aria-label="t('dmProactiveFeatures.menuTitle')"
            >
                <Icon icon="material-symbols:smart-toy-outline-rounded" width="20" height="20" />
            </button>
        </template>
        <ul class="menu">
            <li v-for="feature in dmProactiveFeatures" :key="feature.name">
                <button
                    type="button"
                    class="menu-item"
                    @click="pick(feature.name)"
                >
                    <Icon :icon="feature.icon" width="18" height="18" class="menu-icon" />
                    <span class="menu-text">
                        <span class="menu-label">{{ t(feature.labelKey) }}</span>
                        <span v-if="feature.descriptionKey" class="menu-desc">{{ t(feature.descriptionKey) }}</span>
                    </span>
                </button>
            </li>
        </ul>
    </AppPopover>
</template>

<style scoped>
.icon-button {
    background: none;
    border: none;
    border-radius: 4px;
    padding: 4px;
    color: var(--text-muted);
    cursor: pointer;
    line-height: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
}
.icon-button:hover:not(:disabled) {
    background: var(--bg-surface-hover);
    color: var(--text);
}
.icon-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}
.menu {
    list-style: none;
    margin: 0;
    padding: 4px;
    min-width: 220px;
    max-width: 320px;
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: 6px;
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.18);
}
.menu-item {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
    width: 100%;
    padding: 0.5rem 0.6rem;
    background: none;
    border: none;
    border-radius: 4px;
    color: var(--text);
    cursor: pointer;
    text-align: left;
    font: inherit;
}
.menu-item:hover {
    background: var(--bg-surface-hover);
}
.menu-icon {
    flex-shrink: 0;
    margin-top: 2px;
    color: var(--text-muted);
}
.menu-text {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    min-width: 0;
}
.menu-label {
    font-weight: 500;
}
.menu-desc {
    color: var(--text-muted);
    font-size: 0.8rem;
}
</style>
