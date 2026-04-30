<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { Icon } from '@iconify/vue';
import type { SettingsGroup } from '../../../api/systemSettings';
import FieldRow from './FieldRow.vue';

const props = defineProps<{
    group: SettingsGroup;
    /** Start expanded for the first few groups */
    initiallyOpen?: boolean;
}>();

const { t } = useI18n();
const open = ref(props.initiallyOpen ?? false);

function groupLabel(key: string): string {
    const k = `admin.systemSettings.group.${key}`;
    try {
        return t(k);
    } catch {
        return key;
    }
}
</script>

<template>
    <section class="group-section">
        <button
            type="button"
            class="group-header"
            :aria-expanded="open"
            @click="open = !open"
        >
            <Icon
                :icon="open ? 'material-symbols:expand-less-rounded' : 'material-symbols:expand-more-rounded'"
                width="17"
                height="17"
                class="chevron"
            />
            <span class="group-name">{{ groupLabel(group.group) }}</span>
            <span class="group-count">{{ group.fields.length }}</span>
        </button>

        <div v-if="open" class="group-body">
            <FieldRow
                v-for="field in group.fields"
                :key="field.path"
                :field="field"
            />
        </div>
    </section>
</template>

<style scoped>
.group-section {
    border: 1px solid var(--border);
    border-radius: var(--radius-base);
    background: var(--bg-surface);
    overflow: hidden;
}

.group-header {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    width: 100%;
    padding: 0.55rem 0.75rem;
    background: var(--bg-page);
    border: none;
    cursor: pointer;
    text-align: left;
    color: var(--text-strong);
    font-size: 0.88rem;
    font-weight: 600;
    transition: background 0.1s;
}
.group-header:hover {
    background: var(--bg-surface-hover, color-mix(in srgb, var(--bg-page) 90%, var(--text)));
}
.group-header[aria-expanded="true"] {
    border-bottom: 1px solid var(--border);
}

.chevron {
    color: var(--text-muted);
    flex-shrink: 0;
}

.group-name {
    flex: 1;
}

.group-count {
    font-size: 0.72rem;
    font-weight: 500;
    color: var(--text-muted);
    background: var(--bg-surface);
    border: 1px solid var(--border);
    padding: 0.1rem 0.45rem;
    border-radius: 999px;
    flex-shrink: 0;
}

.group-body {
    display: flex;
    flex-direction: column;
}
</style>
