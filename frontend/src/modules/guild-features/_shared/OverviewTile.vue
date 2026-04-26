<script setup lang="ts">
import { computed } from 'vue';
import { Icon } from '@iconify/vue';
import { useRoute } from 'vue-router';
import type { LocationQueryRaw } from 'vue-router';

/**
 * Standard overview-grid tile reused by most feature OverviewCards.
 * Renders icon + count + label, links to a `<AppTabs name>`-sub-tab.
 *
 * Features that need a custom layout (e.g., dual counts) can build
 * their own tile from scratch — this is just a convenience.
 */
const props = defineProps<{
    icon: string;
    label: string;
    count: number;
    /** Guild ID to deep-link to. */
    guildId: string;
    /** Sub-tab key inside the features primary tab — usually the feature name. */
    sub: string;
    /**
     * AppTabs `name` prop on the consumer page; controls the URL key
     * prefix (`<tabsName>-tab`/`<tabsName>-sub`). Default 'guilds'.
     */
    tabsName?: string;
}>();

const route = useRoute();

const linkTo = computed(() => {
    const tabsName = props.tabsName ?? 'guilds';
    const q: LocationQueryRaw = { ...route.query };
    q.guild = props.guildId;
    q[`${tabsName}-tab`] = 'features';
    q[`${tabsName}-sub`] = props.sub;
    return { path: '/admin/guilds', query: q };
});
</script>

<template>
    <router-link :to="linkTo" class="tile">
        <Icon :icon="icon" width="22" height="22" class="tile-icon" />
        <div class="tile-text">
            <span class="tile-count">{{ count }}</span>
            <span class="tile-label">{{ label }}</span>
        </div>
    </router-link>
</template>

<style scoped>
.tile {
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 0.6rem 0.8rem;
    display: flex;
    align-items: center;
    gap: 0.55rem;
    color: inherit;
    text-decoration: none;
    cursor: pointer;
    transition: background-color 0.12s, border-color 0.12s;
}
.tile:hover {
    background: var(--bg-surface-hover);
    border-color: var(--accent);
}
.tile:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
}
.tile-icon { color: var(--text-muted); flex-shrink: 0; }
.tile:hover .tile-icon { color: var(--accent); }
.tile-text { display: flex; flex-direction: column; min-width: 0; }
.tile-count {
    font-size: 1.2rem;
    font-weight: 700;
    color: var(--text-strong);
    font-variant-numeric: tabular-nums;
}
.tile-label { font-size: 0.78rem; color: var(--text-muted); }
</style>
