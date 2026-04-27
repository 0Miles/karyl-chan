<script setup lang="ts">
import { RouterLink } from 'vue-router';
import { useI18n } from 'vue-i18n';
import type { FeatureSummary } from '../../../api/types';

const { t } = useI18n();

const props = defineProps<{
    summary: FeatureSummary | null;
    loading: boolean;
    permissionDenied: boolean;
}>();

interface Tile {
    key: keyof FeatureSummary;
    icon: string;
    labelKey: string;
    route?: string;
    emphasis?: boolean;
}

const tiles: Tile[] = [
    { key: 'distinctGuilds',         icon: '⚡', labelKey: 'dashboard.features.distinctGuilds',     emphasis: true },
    { key: 'todoChannels',           icon: '✅', labelKey: 'dashboard.features.todoChannels',        route: '/admin/guilds' },
    { key: 'pictureOnlyChannels',    icon: '🖼', labelKey: 'dashboard.features.pictureOnlyChannels', route: '/admin/guilds' },
    { key: 'rconForwardChannels',    icon: '⌨', labelKey: 'dashboard.features.rconForwardChannels', route: '/admin/guilds' },
    { key: 'roleEmojiGroups',        icon: '🎭', labelKey: 'dashboard.features.roleEmojiGroups',     route: '/admin/guilds' },
    { key: 'authorizedUsers',        icon: '👤', labelKey: 'dashboard.features.authorizedUsers',     route: '/admin/access' },
    { key: 'adminRoles',             icon: '🔑', labelKey: 'dashboard.features.adminRoles',          route: '/admin/access' },
    { key: 'capabilityGrants',       icon: '⚙', labelKey: 'dashboard.features.capabilityGrants',    route: '/admin/access' },
];
</script>

<template>
    <section class="inventory" aria-label="Feature inventory">
        <h2 class="section-title">{{ $t('dashboard.features.title') }}</h2>

        <!-- Permission denied -->
        <p v-if="permissionDenied" class="no-perm">{{ $t('dashboard.noPermission') }}</p>

        <!-- Grid -->
        <div v-else class="grid">
            <template v-if="loading && !summary">
                <div v-for="i in 8" :key="i" class="tile tile--skel">
                    <div class="skel skel-val"></div>
                    <div class="skel skel-lbl"></div>
                </div>
            </template>

            <template v-else-if="summary">
                <component
                    :is="tile.route ? RouterLink : 'div'"
                    v-for="tile in tiles"
                    :key="tile.key"
                    :to="tile.route"
                    class="tile"
                    :class="{ 'tile--emphasis': tile.emphasis, 'tile--link': !!tile.route }"
                >
                    <span class="tile-icon" aria-hidden="true">{{ tile.icon }}</span>
                    <span class="tile-value">{{ summary[tile.key].toLocaleString() }}</span>
                    <span class="tile-label">{{ $t(tile.labelKey) }}</span>
                </component>
            </template>

            <template v-else>
                <div v-for="i in 8" :key="i" class="tile tile--empty">
                    <span class="tile-value">—</span>
                    <span class="tile-label">&nbsp;</span>
                </div>
            </template>
        </div>
    </section>
</template>

<style scoped>
.inventory {
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

.no-perm {
    color: var(--text-muted);
    font-size: 0.875rem;
    margin: 0;
    padding: 1rem;
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
}

/* ─── Grid ──────────────────────────────────────────────────────── */
.grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 0.625rem;
}

/* First tile (distinctGuilds) spans 2 cols to anchor the grid visually */
.tile:first-child {
    grid-column: span 2;
}

/* ─── Tile ──────────────────────────────────────────────────────── */
.tile {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.25rem;
    padding: 1rem 1.1rem 0.9rem;
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    text-decoration: none;
    color: inherit;
    transition:
        border-color var(--transition-fast) ease,
        background var(--transition-fast) ease;
    position: relative;
    overflow: hidden;
}

/* Subtle top accent stripe */
.tile::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 2px;
    background: transparent;
    transition: background var(--transition-fast) ease;
}

.tile--link:hover,
.tile--link:focus-visible {
    border-color: var(--accent);
    background: var(--accent-bg);
    outline: none;
}

.tile--link:hover::before,
.tile--link:focus-visible::before {
    background: var(--accent);
}

.tile--emphasis {
    border-color: var(--accent);
    background: linear-gradient(
        135deg,
        var(--accent-bg) 0%,
        transparent 70%
    );
}

.tile--emphasis::before {
    background: var(--accent);
}

/* ─── Tile internals ────────────────────────────────────────────── */
.tile-icon {
    font-size: 1.1rem;
    line-height: 1;
    margin-bottom: 0.15rem;
    opacity: 0.85;
}

.tile-value {
    font-size: 1.9rem;
    font-weight: 800;
    color: var(--text-strong);
    line-height: 1;
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.02em;
}

.tile--emphasis .tile-value {
    color: var(--accent-text-strong);
}

.tile-label {
    font-size: 0.7rem;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.07em;
    font-weight: 500;
    line-height: 1.3;
}

/* ─── Skeleton ──────────────────────────────────────────────────── */
.tile--skel {
    pointer-events: none;
}

.skel {
    background: var(--bg-surface-2);
    border-radius: var(--radius-sm);
    animation: skel-pulse 1.6s ease-in-out infinite;
}

@keyframes skel-pulse {
    0%, 100% { opacity: 1; }
    50%       { opacity: 0.4; }
}

.skel-val { width: 3rem; height: 1.9rem; }
.skel-lbl { width: 5rem; height: 0.7rem; }

/* ─── Responsive ────────────────────────────────────────────────── */
@media (max-width: 900px) {
    .grid {
        grid-template-columns: repeat(3, 1fr);
    }
    .tile:first-child {
        grid-column: span 1;
    }
}

@media (max-width: 640px) {
    .grid {
        grid-template-columns: repeat(2, 1fr);
    }
    .tile:first-child {
        grid-column: span 2;
    }
    .tile-value {
        font-size: 1.6rem;
    }
}
</style>
