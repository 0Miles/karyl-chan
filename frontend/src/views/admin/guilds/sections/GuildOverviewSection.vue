<script setup lang="ts">
import { computed } from 'vue';
import { Icon } from '@iconify/vue';
import type { GuildDetail, GuildRoleSummary } from '../../../../api/guilds';

const props = defineProps<{
    detail: GuildDetail;
    roles: GuildRoleSummary[];
}>();

function formatDate(iso: string | null): string {
    if (!iso) return '—';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString();
}

interface FeatureTile {
    key: string;
    icon: string;
    labelKey: string;
    count: number;
}

// Dashboard tiles — a single glance at how each bot feature is wired
// for the selected guild. Numbers come straight from the existing
// guild-detail payload so this section stays read-only / observational.
const tiles = computed<FeatureTile[]>(() => [
    { key: 'todo', icon: 'material-symbols:checklist-rounded', labelKey: 'guilds.todoChannels', count: props.detail.todoChannels.length },
    { key: 'picture', icon: 'material-symbols:image-outline-rounded', labelKey: 'guilds.pictureOnly', count: props.detail.pictureOnlyChannels.length },
    { key: 'rcon', icon: 'material-symbols:terminal-rounded', labelKey: 'guilds.rconForward', count: props.detail.rconForwardChannels.length },
    { key: 'roleEmoji', icon: 'material-symbols:mood-rounded', labelKey: 'guilds.roleEmoji', count: props.detail.roleEmojis.length },
    { key: 'roleReact', icon: 'material-symbols:add-reaction-outline-rounded', labelKey: 'guilds.roleReactions', count: props.detail.roleReceiveMessages.length },
    { key: 'caps', icon: 'material-symbols:vpn-key-outline-rounded', labelKey: 'guilds.capabilityGrants', count: props.detail.capabilityGrants.length }
]);

const rolesCount = computed(() => props.roles.length);
</script>

<template>
    <div class="overview">
        <header class="hero">
            <img v-if="detail.guild.iconUrl" :src="detail.guild.iconUrl" alt="" class="big-icon" />
            <div v-else class="big-icon icon-fallback">{{ detail.guild.name.charAt(0).toUpperCase() }}</div>
            <div class="hero-meta">
                <h2>{{ detail.guild.name }}</h2>
                <p class="meta-line">
                    <span>{{ $t('guilds.members', { count: detail.guild.memberCount }) }}</span>
                    <span>· {{ $t('guilds.joined', { date: formatDate(detail.guild.joinedAt) }) }}</span>
                    <span>· {{ $t('guilds.idLabel') }} <code>{{ detail.guild.id }}</code></span>
                </p>
                <p v-if="detail.guild.description" class="description">{{ detail.guild.description }}</p>
            </div>
        </header>

        <section class="stats">
            <div class="stat">
                <Icon icon="material-symbols:group-outline-rounded" width="22" height="22" class="stat-icon" />
                <div class="stat-text">
                    <span class="stat-value">{{ detail.guild.memberCount }}</span>
                    <span class="stat-label">{{ $t('guilds.dashboard.members') }}</span>
                </div>
            </div>
            <div class="stat">
                <Icon icon="material-symbols:shield-person-outline-rounded" width="22" height="22" class="stat-icon" />
                <div class="stat-text">
                    <span class="stat-value">{{ rolesCount }}</span>
                    <span class="stat-label">{{ $t('guilds.dashboard.roles') }}</span>
                </div>
            </div>
        </section>

        <h3 class="section-title">{{ $t('guilds.dashboard.featureUsage') }}</h3>
        <ul class="feature-grid">
            <li v-for="tile in tiles" :key="tile.key" class="feature-tile">
                <Icon :icon="tile.icon" width="22" height="22" class="tile-icon" />
                <div class="tile-text">
                    <span class="tile-count">{{ tile.count }}</span>
                    <span class="tile-label">{{ $t(tile.labelKey) }}</span>
                </div>
            </li>
        </ul>
    </div>
</template>

<style scoped>
.overview {
    display: flex;
    flex-direction: column;
    gap: 1rem;
}
.hero {
    display: flex;
    gap: 1rem;
    align-items: center;
    padding: 1rem;
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: 10px;
}
.big-icon {
    width: 72px;
    height: 72px;
    border-radius: 50%;
    object-fit: cover;
    flex-shrink: 0;
}
.icon-fallback {
    background: var(--accent);
    color: var(--text-on-accent);
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 700;
    font-size: 1.6rem;
}
.hero-meta { min-width: 0; flex: 1; }
.hero-meta h2 { margin: 0 0 0.3rem; }
.meta-line {
    margin: 0;
    color: var(--text-muted);
    font-size: 0.85rem;
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
}
.meta-line code {
    font-size: 0.78rem;
    background: var(--bg-surface-2);
    padding: 0 0.3rem;
    border-radius: 3px;
}
.description {
    margin: 0.5rem 0 0;
    font-size: 0.88rem;
    color: var(--text);
}

.stats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 0.5rem;
}
.stat {
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 0.6rem 0.8rem;
    display: flex;
    align-items: center;
    gap: 0.6rem;
}
.stat-icon { color: var(--accent); flex-shrink: 0; }
.stat-text { display: flex; flex-direction: column; }
.stat-value { font-size: 1.25rem; font-weight: 700; color: var(--text-strong); }
.stat-label { font-size: 0.78rem; color: var(--text-muted); }

.section-title {
    margin: 0;
    font-size: 0.95rem;
    color: var(--text-strong);
}
.feature-grid {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 0.5rem;
}
.feature-tile {
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 0.6rem 0.8rem;
    display: flex;
    align-items: center;
    gap: 0.55rem;
}
.tile-icon { color: var(--text-muted); flex-shrink: 0; }
.tile-text { display: flex; flex-direction: column; min-width: 0; }
.tile-count {
    font-size: 1.2rem;
    font-weight: 700;
    color: var(--text-strong);
    font-variant-numeric: tabular-nums;
}
.tile-label { font-size: 0.78rem; color: var(--text-muted); }
</style>
