<script setup lang="ts" generic="V extends string | number | null">
import { computed, ref } from 'vue';
import AppSelect from './AppSelect.vue';
import type { Placement } from '../composables/use-popover';
import type { DrawerPlacement } from '../composables/use-drawer';

/**
 * Drop-in replacement for native `<select>` built on AppSelect, so the
 * picker honours the same viewport-aware popover/drawer split the rest
 * of the admin surface uses. Unlike a raw AppSelect, this component
 * owns:
 * - A value-model (`v-model`).
 * - A trigger button styled to match form inputs.
 * - The flat / grouped option list rendering.
 *
 * `options` accepts either `{ value, label }[]` (flat) or items with a
 * `group` field (header pulled from the unique non-null group strings,
 * preserving first-seen order).
 */
export interface SelectOption<V> {
    value: V;
    label: string;
    group?: string | null;
}

const props = withDefaults(defineProps<{
    modelValue: V;
    options: SelectOption<V>[];
    placeholder?: string;
    disabled?: boolean;
    placement?: Placement;
    drawerPlacement?: DrawerPlacement;
    drawerTitle?: string;
}>(), {
    placeholder: '',
    disabled: false,
    placement: 'bottom-start',
    drawerPlacement: 'bottom',
    drawerTitle: ''
});

const emit = defineEmits<{
    (e: 'update:modelValue', value: V): void;
}>();

const isOpen = ref(false);

const selected = computed(() =>
    props.options.find(o => o.value === props.modelValue) ?? null
);

interface Group {
    label: string | null;
    items: SelectOption<V>[];
}
const groups = computed<Group[]>(() => {
    const out: Group[] = [];
    const byKey = new Map<string, Group>();
    for (const opt of props.options) {
        const key = opt.group ?? '';
        let g = byKey.get(key);
        if (!g) {
            g = { label: opt.group ?? null, items: [] };
            byKey.set(key, g);
            out.push(g);
        }
        g.items.push(opt);
    }
    return out;
});

const hasGroups = computed(() => groups.value.some(g => g.label !== null));

function pick(value: V) {
    emit('update:modelValue', value);
    isOpen.value = false;
}
</script>

<template>
    <AppSelect
        v-model:open="isOpen"
        :placement="placement"
        :drawer-placement="drawerPlacement"
        :drawer-title="drawerTitle || placeholder"
    >
        <template #trigger>
            <button type="button" class="select-trigger" :disabled="disabled">
                <span class="label" :class="{ placeholder: !selected }">
                    {{ selected?.label ?? placeholder }}
                </span>
                <span class="chevron" :class="{ open: isOpen }">›</span>
            </button>
        </template>

        <ul class="select-list">
            <template v-if="hasGroups">
                <template v-for="(g, gi) in groups" :key="gi">
                    <li v-if="g.label !== null" class="group-head">{{ g.label }}</li>
                    <li
                        v-for="opt in g.items"
                        :key="String(opt.value) + '|' + opt.label"
                        :class="['option', { active: opt.value === modelValue, indented: g.label !== null }]"
                        @click="pick(opt.value)"
                    >{{ opt.label }}</li>
                </template>
            </template>
            <template v-else>
                <li
                    v-for="opt in options"
                    :key="String(opt.value) + '|' + opt.label"
                    :class="['option', { active: opt.value === modelValue }]"
                    @click="pick(opt.value)"
                >{{ opt.label }}</li>
            </template>
        </ul>
    </AppSelect>
</template>

<style scoped>
.select-trigger {
    display: flex;
    width: 100%;
    align-items: center;
    gap: 0.4rem;
    padding: 0.4rem 0.55rem;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg);
    color: var(--text);
    font: inherit;
    font-size: 0.9rem;
    cursor: pointer;
    text-align: left;
    min-width: 0;
}
.select-trigger:hover:not(:disabled) { background: var(--bg-surface-hover); }
.select-trigger:disabled { opacity: 0.55; cursor: not-allowed; }
.select-trigger:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.label {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.label.placeholder { color: var(--text-muted); }
.chevron {
    flex-shrink: 0;
    color: var(--text-muted);
    transition: transform 0.15s;
    transform: rotate(90deg);
    font-size: 0.95rem;
}
.chevron.open { transform: rotate(270deg); }

.select-list {
    list-style: none;
    margin: 0;
    padding: 0.25rem 0;
    overflow-y: auto;
    max-height: 320px;
}
.option {
    padding: 0.45rem 0.85rem;
    cursor: pointer;
    font-size: 0.88rem;
    color: var(--text);
    display: flex;
    align-items: center;
}
.option:hover { background: var(--bg-surface-hover); }
.option.active { background: var(--bg-surface-active); font-weight: 500; }
.option.indented { padding-left: 1.5rem; }
.group-head {
    padding: 0.4rem 0.85rem 0.2rem;
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-muted);
}
@media (max-width: 768px) {
    .select-list { max-height: none; }
}
</style>
