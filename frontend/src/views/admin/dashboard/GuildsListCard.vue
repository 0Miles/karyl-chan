<script setup lang="ts">
import { RouterLink } from 'vue-router';
import type { GuildSummary } from '../../../api/guilds';

defineProps<{
    guilds: GuildSummary[];
    loading: boolean;
    error?: string | null;
}>();

function relativeJoin(iso: string | null): string {
    if (!iso) return '—';
    const diff = Date.now() - new Date(iso).getTime();
    const days = Math.floor(diff / 86_400_000);
    if (days < 1) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 30) return `${days}d ago`;
    const months = Math.floor(days / 30);
    if (months < 12) return `${months}mo ago`;
    return `${Math.floor(months / 12)}y ago`;
}

function initials(name: string): string {
    return name
        .split(/\s+/)
        .slice(0, 2)
        .map(w => w.charAt(0).toUpperCase())
        .join('');
}
</script>

<template>
    <section class="guilds-card" aria-label="Guild list">
        <div class="card-header">
            <h2 class="section-title">{{ $t('dashboard.guilds.title') }}</h2>
            <RouterLink to="/admin/guilds" class="view-all-link">
                {{ $t('dashboard.guilds.viewAll') }}
            </RouterLink>
        </div>

        <!-- Error banner -->
        <div v-if="error" class="error-banner" role="alert">
            <span class="error-icon" aria-hidden="true">!</span>
            {{ error }}
        </div>

        <!-- Loading skeleton -->
        <div v-else-if="loading && !guilds.length" class="guild-list">
            <div v-for="i in 4" :key="i" class="guild-row guild-row--skel">
                <div class="skel skel-avatar"></div>
                <div class="guild-info">
                    <div class="skel skel-name"></div>
                    <div class="skel skel-meta"></div>
                </div>
                <div class="skel skel-btn"></div>
            </div>
        </div>

        <!-- Empty state -->
        <p v-else-if="!guilds.length" class="empty-state">
            {{ $t('dashboard.guilds.empty') }}
        </p>

        <!-- List -->
        <ul v-else class="guild-list" role="list">
            <li
                v-for="guild in guilds"
                :key="guild.id"
                class="guild-row"
                role="listitem"
            >
                <!-- Icon -->
                <div class="guild-avatar-wrap">
                    <img
                        v-if="guild.iconUrl"
                        :src="guild.iconUrl"
                        :alt="guild.name"
                        class="guild-avatar"
                    />
                    <div v-else class="guild-avatar guild-avatar--fallback">
                        {{ initials(guild.name) }}
                    </div>
                </div>

                <!-- Info -->
                <div class="guild-info">
                    <span class="guild-name">{{ guild.name }}</span>
                    <span class="guild-meta">
                        <span class="guild-members">{{ guild.memberCount.toLocaleString() }} {{ $t('dashboard.guilds.members') }}</span>
                        <span class="guild-sep" aria-hidden="true">·</span>
                        <span class="guild-joined">{{ relativeJoin(guild.joinedAt) }}</span>
                    </span>
                </div>

                <!-- Quick link -->
                <RouterLink
                    :to="`/admin/guilds?selected=${guild.id}`"
                    class="guild-link"
                    :aria-label="`${$t('dashboard.guilds.settings')} — ${guild.name}`"
                >
                    {{ $t('dashboard.guilds.settings') }}
                </RouterLink>
            </li>
        </ul>
    </section>
</template>

<style scoped>
.guilds-card {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
}

/* ─── Header ─────────────────────────────────────────────────────── */
.card-header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.5rem;
}

.section-title {
    font-size: 0.7rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-muted);
    margin: 0;
}

.view-all-link {
    font-size: 0.75rem;
    color: var(--accent-text);
    text-decoration: none;
    transition: opacity var(--transition-fast) ease;
}

.view-all-link:hover {
    opacity: 0.75;
}

/* ─── Error banner ───────────────────────────────────────────────── */
.error-banner {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.65rem 0.9rem;
    background: rgba(237, 66, 69, 0.1);
    border: 1px solid rgba(237, 66, 69, 0.35);
    border-radius: var(--radius-lg);
    color: #ed4245;
    font-size: 0.8rem;
}

.error-icon {
    font-weight: 800;
    font-size: 0.9rem;
    line-height: 1;
    flex-shrink: 0;
}

/* ─── Empty / no-perm ────────────────────────────────────────────── */
.empty-state {
    color: var(--text-muted);
    font-size: 0.875rem;
    margin: 0;
    padding: 1rem;
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
}

/* ─── List ───────────────────────────────────────────────────────── */
.guild-list {
    display: flex;
    flex-direction: column;
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    overflow: hidden;
    list-style: none;
    margin: 0;
    padding: 0;
}

/* ─── Row ────────────────────────────────────────────────────────── */
.guild-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.7rem 1rem;
    border-bottom: 1px solid var(--border);
    transition: background var(--transition-fast) ease;
}

.guild-row:last-child {
    border-bottom: none;
}

.guild-row:hover {
    background: var(--bg-surface-hover);
}

/* ─── Avatar ─────────────────────────────────────────────────────── */
.guild-avatar-wrap {
    flex-shrink: 0;
}

.guild-avatar {
    width: 36px;
    height: 36px;
    border-radius: 30%;
    object-fit: cover;
    display: block;
}

.guild-avatar--fallback {
    background: var(--accent-bg);
    color: var(--accent-text);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.75rem;
    font-weight: 700;
}

/* ─── Info ───────────────────────────────────────────────────────── */
.guild-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
}

.guild-name {
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--text-strong);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.guild-meta {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.72rem;
    color: var(--text-muted);
}

.guild-sep {
    color: var(--text-faint);
}

/* ─── Quick link ─────────────────────────────────────────────────── */
.guild-link {
    flex-shrink: 0;
    font-size: 0.75rem;
    color: var(--accent-text);
    text-decoration: none;
    padding: 0.2rem 0.55rem;
    border: 1px solid var(--accent);
    border-radius: var(--radius-sm);
    opacity: 0.7;
    transition:
        opacity var(--transition-fast) ease,
        background var(--transition-fast) ease;
}

.guild-link:hover,
.guild-link:focus-visible {
    opacity: 1;
    background: var(--accent-bg);
    outline: none;
}

/* ─── Skeleton ───────────────────────────────────────────────────── */
.guild-row--skel {
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

.skel-avatar { width: 36px; height: 36px; border-radius: 30%; flex-shrink: 0; }
.skel-name   { width: 120px; height: 0.875rem; }
.skel-meta   { width: 80px; height: 0.7rem; margin-top: 0.15rem; }
.skel-btn    { width: 52px; height: 1.5rem; border-radius: var(--radius-sm); flex-shrink: 0; }
</style>
