<script setup lang="ts">
import { computed } from 'vue';
import { Icon } from '@iconify/vue';
import { useBreakpoint } from '../composables/use-breakpoint';
import AppSelectField, { type SelectOption } from './AppSelectField.vue';

/**
 * Two-level tab strip with viewport-aware fallback.
 *
 * Desktop:
 *   - Primary tabs always render as a horizontal pill row at the top.
 *   - Sub-tabs (when provided) render either underneath the primary
 *     row (`subLayout: 'top'`) or as a full-height vertical sidebar
 *     to the left of the panel (`subLayout: 'sidebar'`).
 *
 * Mobile (≤768px):
 *   - Both rows collapse to AppSelectField dropdowns stacked vertically.
 *     The sidebar variant is meaningless on a phone, so the prop is
 *     ignored in that branch.
 *
 * The component owns the chrome only; the panel content is the
 * default slot. Parents are responsible for switching what they
 * render based on `modelValue` / `subModelValue`.
 */
export interface TabDef {
    key: string;
    label: string;
    /** Optional iconify icon name shown next to the label. */
    icon?: string;
    disabled?: boolean;
}

const props = withDefaults(defineProps<{
    modelValue: string;
    tabs: TabDef[];
    subModelValue?: string;
    subTabs?: TabDef[];
    /** Where sub-tabs render on desktop. Has no effect on mobile. */
    subLayout?: 'top' | 'sidebar';
}>(), {
    subModelValue: undefined,
    subTabs: () => [],
    subLayout: 'top'
});

const emit = defineEmits<{
    (e: 'update:modelValue', value: string): void;
    (e: 'update:subModelValue', value: string): void;
}>();

const { isMobile } = useBreakpoint();

const hasSub = computed(() => props.subTabs.length > 0);

function pickPrimary(key: string) { emit('update:modelValue', key); }
function pickSub(key: string) { emit('update:subModelValue', key); }

const primaryOptions = computed<SelectOption<string>[]>(() =>
    props.tabs.map(t => ({ value: t.key, label: t.label }))
);
const subOptions = computed<SelectOption<string>[]>(() =>
    props.subTabs.map(t => ({ value: t.key, label: t.label }))
);
</script>

<template>
    <!-- Mobile: two stacked dropdowns. -->
    <div v-if="isMobile" class="tabs-root mobile">
        <div class="dropdowns">
            <AppSelectField
                :model-value="modelValue"
                :options="primaryOptions"
                @update:model-value="pickPrimary"
            />
            <AppSelectField
                v-if="hasSub && subModelValue !== undefined"
                :model-value="subModelValue"
                :options="subOptions"
                @update:model-value="pickSub"
            />
        </div>
        <div class="panel">
            <slot />
        </div>
    </div>

    <!-- Desktop, sub-tabs below primary. -->
    <div
        v-else-if="!hasSub || subLayout === 'top'"
        class="tabs-root desktop top"
    >
        <nav class="primary-row" role="tablist">
            <button
                v-for="t in tabs"
                :key="t.key"
                type="button"
                role="tab"
                :class="['tab', { active: t.key === modelValue }]"
                :aria-selected="t.key === modelValue"
                :disabled="t.disabled"
                @click="!t.disabled && pickPrimary(t.key)"
            >
                <Icon v-if="t.icon" :icon="t.icon" width="16" height="16" />
                <span>{{ t.label }}</span>
            </button>
        </nav>
        <nav v-if="hasSub" class="sub-row" role="tablist">
            <button
                v-for="t in subTabs"
                :key="t.key"
                type="button"
                role="tab"
                :class="['sub-tab', { active: t.key === subModelValue }]"
                :aria-selected="t.key === subModelValue"
                :disabled="t.disabled"
                @click="!t.disabled && pickSub(t.key)"
            >
                <Icon v-if="t.icon" :icon="t.icon" width="14" height="14" />
                <span>{{ t.label }}</span>
            </button>
        </nav>
        <div class="panel">
            <slot />
        </div>
    </div>

    <!-- Desktop, sub-tabs as a vertical sidebar. -->
    <div v-else class="tabs-root desktop sidebar">
        <nav class="primary-row" role="tablist">
            <button
                v-for="t in tabs"
                :key="t.key"
                type="button"
                role="tab"
                :class="['tab', { active: t.key === modelValue }]"
                :aria-selected="t.key === modelValue"
                :disabled="t.disabled"
                @click="!t.disabled && pickPrimary(t.key)"
            >
                <Icon v-if="t.icon" :icon="t.icon" width="16" height="16" />
                <span>{{ t.label }}</span>
            </button>
        </nav>
        <div class="split">
            <nav class="sub-side" role="tablist">
                <button
                    v-for="t in subTabs"
                    :key="t.key"
                    type="button"
                    role="tab"
                    :class="['sub-side-tab', { active: t.key === subModelValue }]"
                    :aria-selected="t.key === subModelValue"
                    :disabled="t.disabled"
                    @click="!t.disabled && pickSub(t.key)"
                >
                    <Icon v-if="t.icon" :icon="t.icon" width="16" height="16" />
                    <span>{{ t.label }}</span>
                </button>
            </nav>
            <div class="panel side-panel">
                <slot />
            </div>
        </div>
    </div>
</template>

<style scoped>
.tabs-root {
    display: flex;
    flex-direction: column;
    gap: 0.7rem;
    min-height: 0;
    flex: 1;
}

/* Primary tabs — pill row, sticky to keep visible while panel scrolls. */
.primary-row {
    display: flex;
    gap: 0.4rem;
    border-bottom: 1px solid var(--border);
    padding-bottom: 0.5rem;
    overflow-x: auto;
    scrollbar-width: thin;
}
.tab {
    background: var(--bg-surface-2);
    border: 1px solid transparent;
    border-radius: 6px;
    padding: 0.4rem 0.95rem;
    cursor: pointer;
    color: var(--text);
    font: inherit;
    font-size: 0.9rem;
    font-weight: 500;
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    white-space: nowrap;
}
.tab:hover:not(:disabled) { background: var(--bg-surface-hover); }
.tab.active {
    background: var(--accent-bg);
    border-color: var(--accent);
    color: var(--accent-text-strong);
}
.tab:disabled { opacity: 0.45; cursor: default; }

/* Sub-tabs at the top — underline-style row to differentiate from
   the bolder primary pills. */
.sub-row {
    display: flex;
    gap: 0.6rem;
    border-bottom: 1px solid var(--border);
    overflow-x: auto;
    scrollbar-width: thin;
    margin-top: -0.3rem;
}
.sub-tab {
    background: none;
    border: none;
    color: var(--text-muted);
    font: inherit;
    font-size: 0.85rem;
    font-weight: 500;
    padding: 0.45rem 0.2rem;
    cursor: pointer;
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    white-space: nowrap;
}
.sub-tab:hover:not(:disabled) { color: var(--text); }
.sub-tab.active { color: var(--accent-text-strong); border-color: var(--accent); }
.sub-tab:disabled { opacity: 0.45; cursor: default; }

/* Sub-tabs as sidebar. The split row stretches to fill available
   height so the sidebar can be a true full-height column when the
   parent is also flex-stretched. */
.split {
    display: flex;
    gap: 0.9rem;
    flex: 1;
    min-height: 0;
}
.sub-side {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    width: 200px;
    flex-shrink: 0;
    border-right: 1px solid var(--border);
    padding-right: 0.6rem;
    overflow-y: auto;
}
.sub-side-tab {
    background: none;
    border: 1px solid transparent;
    border-radius: 6px;
    padding: 0.5rem 0.7rem;
    text-align: left;
    color: var(--text-muted);
    font: inherit;
    font-size: 0.88rem;
    font-weight: 500;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 0.5rem;
}
.sub-side-tab:hover:not(:disabled) {
    background: var(--bg-surface-hover);
    color: var(--text);
}
.sub-side-tab.active {
    background: var(--accent-bg);
    color: var(--accent-text-strong);
    border-color: var(--accent);
}
.sub-side-tab:disabled { opacity: 0.45; cursor: default; }

.panel {
    flex: 1;
    min-width: 0;
    min-height: 0;
}
.side-panel {
    overflow-y: auto;
    padding-right: 0.2rem;
}

/* Mobile branch — two stacked dropdowns. */
.tabs-root.mobile { gap: 0.5rem; }
.dropdowns {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
}

@media (max-width: 640px) {
    .sub-side { width: 160px; }
}
</style>
