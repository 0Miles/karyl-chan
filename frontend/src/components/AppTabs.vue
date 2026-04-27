<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter, RouterLink, type LocationQueryRaw } from 'vue-router';
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
 * Routed mode (`routed=true`):
 *   - Tab + sub-tab keys two-way sync with URL query params, so a
 *     deep-link like `?tab=settings&sub=invites` lands on the right
 *     card and middle-clicking a tab opens it in a new browser tab.
 *   - The first tab/sub key is treated as the default and omitted from
 *     the URL to keep shared links short.
 *   - When two routed AppTabs share the same page, give each one a
 *     unique `name` prop so their query keys don't collide
 *     (`name="foo"` → `foo-tab` / `foo-sub`).
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
    /** Two-way bind tab + sub-tab to URL query params. Default false. */
    routed?: boolean;
    /** Namespace prefix for the URL query keys; required when multiple
     *  routed AppTabs share a page so they don't collide. Empty (default)
     *  = plain `tab` / `sub`; non-empty = `${name}-tab` / `${name}-sub`. */
    name?: string;
}>(), {
    subModelValue: undefined,
    subTabs: () => [],
    subLayout: 'top',
    routed: false,
    name: ''
});

const emit = defineEmits<{
    (e: 'update:modelValue', value: string): void;
    (e: 'update:subModelValue', value: string): void;
}>();

const { isMobile } = useBreakpoint();
const route = useRoute();
const router = useRouter();

const hasSub = computed(() => props.subTabs.length > 0);

const tabKey = computed(() => props.name ? `${props.name}-tab` : 'tab');
const subKey = computed(() => props.name ? `${props.name}-sub` : 'sub');
const defaultTab = computed(() => props.tabs[0]?.key ?? '');
const defaultSub = computed(() => props.subTabs[0]?.key ?? '');

function pickPrimary(key: string) { emit('update:modelValue', key); }
function pickSub(key: string) { emit('update:subModelValue', key); }

const primaryOptions = computed<SelectOption<string>[]>(() =>
    props.tabs.map(t => ({ value: t.key, label: t.label }))
);
const subOptions = computed<SelectOption<string>[]>(() =>
    props.subTabs.map(t => ({ value: t.key, label: t.label }))
);

// ── Routed mode: URL ↔ v-model sync ──────────────────────────────────
function readQuery(key: string): string {
    const v = route.query[key];
    return typeof v === 'string' ? v : '';
}

function readFromRoute() {
    if (!props.routed) return;
    const wantTab = readQuery(tabKey.value) || defaultTab.value;
    if (wantTab && wantTab !== props.modelValue) emit('update:modelValue', wantTab);

    if (props.subModelValue === undefined) return;
    const wantSub = readQuery(subKey.value) || defaultSub.value;
    if (wantSub && wantSub !== props.subModelValue) emit('update:subModelValue', wantSub);
}

function syncToRoute() {
    if (!props.routed) return;
    const next: LocationQueryRaw = { ...route.query };
    next[tabKey.value] = props.modelValue && props.modelValue !== defaultTab.value
        ? props.modelValue : undefined;
    next[subKey.value] = props.subModelValue && props.subModelValue !== defaultSub.value
        ? props.subModelValue : undefined;

    // Skip when nothing actually changed — avoids a redundant replace
    // that would still re-fire the route watcher.
    if ((route.query[tabKey.value] ?? null) === (next[tabKey.value] ?? null)
        && (route.query[subKey.value] ?? null) === (next[subKey.value] ?? null)) {
        return;
    }
    router.replace({ query: next });
}

// Seed from the URL on mount before any state→URL watcher fires —
// otherwise the initial sync would clobber the deep-link.
readFromRoute();

watch(() => [props.modelValue, props.subModelValue], () => syncToRoute());
watch(() => route.query, () => readFromRoute());

// Per-primary-tab memory of the last non-default sub the user picked.
// Lets a primary-tab link restore the sub the user was on last time
// they visited it, instead of always falling back to the default. We
// skip recording when the current sub IS the default — that way the
// generated link omits the sub param and the URL stays clean.
const subMemory = ref<Record<string, string>>({});
watch(
    () => [props.modelValue, props.subModelValue, defaultSub.value] as const,
    ([tab, sub, def]) => {
        if (tab && typeof sub === 'string' && sub && sub !== def) {
            subMemory.value[tab] = sub;
        }
    },
    { immediate: true }
);

// ── Routed mode: link `to` builders ──────────────────────────────────
// Returning `{ path, query }` (not just `{ query }`) pins the link to
// the current route so TypeScript picks the path variant of
// RouteLocationRaw — bare `{ query }` would match the relative variant
// but vue-tsc fails to discriminate without a hint.
function tabLinkTo(key: string) {
    const q: LocationQueryRaw = { ...route.query };
    q[tabKey.value] = key === defaultTab.value ? undefined : key;
    // Restore the sub the user last had on the target tab; falls back
    // to clearing so the new tab loads with its default. Other AppTabs'
    // keys on the page are preserved because we only mutate our
    // namespaced keys.
    const remembered = subMemory.value[key];
    q[subKey.value] = remembered ?? undefined;
    return { path: route.path, query: q };
}
function subLinkTo(key: string) {
    const q: LocationQueryRaw = { ...route.query };
    q[subKey.value] = key === defaultSub.value ? undefined : key;
    return { path: route.path, query: q };
}
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
            <template v-for="t in tabs" :key="t.key">
                <RouterLink
                    v-if="routed && !t.disabled"
                    :to="tabLinkTo(t.key)"
                    role="tab"
                    :class="['tab', { active: t.key === modelValue }]"
                    :aria-selected="t.key === modelValue"
                >
                    <Icon v-if="t.icon" :icon="t.icon" width="16" height="16" />
                    <span>{{ t.label }}</span>
                </RouterLink>
                <button
                    v-else
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
            </template>
        </nav>
        <nav v-if="hasSub" class="sub-row" role="tablist">
            <template v-for="t in subTabs" :key="t.key">
                <RouterLink
                    v-if="routed && !t.disabled"
                    :to="subLinkTo(t.key)"
                    role="tab"
                    :class="['sub-tab', { active: t.key === subModelValue }]"
                    :aria-selected="t.key === subModelValue"
                >
                    <Icon v-if="t.icon" :icon="t.icon" width="14" height="14" />
                    <span>{{ t.label }}</span>
                </RouterLink>
                <button
                    v-else
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
            </template>
        </nav>
        <div class="panel">
            <slot />
        </div>
    </div>

    <!-- Desktop, sub-tabs as a vertical sidebar. -->
    <div v-else class="tabs-root desktop sidebar">
        <nav class="primary-row" role="tablist">
            <template v-for="t in tabs" :key="t.key">
                <RouterLink
                    v-if="routed && !t.disabled"
                    :to="tabLinkTo(t.key)"
                    role="tab"
                    :class="['tab', { active: t.key === modelValue }]"
                    :aria-selected="t.key === modelValue"
                >
                    <Icon v-if="t.icon" :icon="t.icon" width="16" height="16" />
                    <span>{{ t.label }}</span>
                </RouterLink>
                <button
                    v-else
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
            </template>
        </nav>
        <div class="split">
            <nav class="sub-side" role="tablist">
                <template v-for="t in subTabs" :key="t.key">
                    <RouterLink
                        v-if="routed && !t.disabled"
                        :to="subLinkTo(t.key)"
                        role="tab"
                        :class="['sub-side-tab', { active: t.key === subModelValue }]"
                        :aria-selected="t.key === subModelValue"
                    >
                        <Icon v-if="t.icon" :icon="t.icon" width="16" height="16" />
                        <span>{{ t.label }}</span>
                    </RouterLink>
                    <button
                        v-else
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
                </template>
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
    flex-shrink: 0;
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
    /* Reset router-link / anchor defaults so the routed variant matches
       the button visually. */
    text-decoration: none;
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
    flex-shrink: 0;
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
    text-decoration: none;
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
    text-decoration: none;
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
    /* Scroll the panel itself — without this the parent layout's
       `overflow: hidden` clips tall sub-tab content (members lists,
       audit log, etc.) and the user can't reach the bottom rows. The
       sidebar variant gets the same treatment via `.side-panel` so all
       three layouts (mobile, desktop-top, desktop-sidebar) behave
       consistently. */
    overflow-y: auto;
}
.side-panel {
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
