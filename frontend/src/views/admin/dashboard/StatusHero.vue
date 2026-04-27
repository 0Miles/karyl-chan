<script setup lang="ts">
import type { BotStatus } from '../../../api/types';

defineProps<{
    bot: BotStatus | null;
    loading: boolean;
    error?: string | null;
    /** True only on the very first load — controls whether skeleton shows. */
    isInitialLoad: boolean;
}>();

function formatDuration(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds <= 0) return '—';
    const s = Math.floor(seconds);
    const days = Math.floor(s / 86400);
    const hours = Math.floor((s % 86400) / 3600);
    const mins = Math.floor((s % 3600) / 60);
    const secs = s % 60;
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${mins}m`;
    if (mins > 0) return `${mins}m ${secs}s`;
    return `${secs}s`;
}
</script>

<template>
    <div class="hero" :class="{ 'hero--loading': loading && !bot }">
        <!-- Error banner (shown above all states) -->
        <div v-if="error" class="hero-error" role="alert">
            <span class="error-icon" aria-hidden="true">!</span>
            {{ error }}
        </div>

        <!-- Loading skeleton — only on initial load, not on refresh -->
        <template v-if="isInitialLoad && loading && !bot">
            <div class="hero-identity">
                <div class="skel skel-avatar"></div>
                <div class="hero-meta">
                    <div class="skel skel-name"></div>
                    <div class="skel skel-tag"></div>
                </div>
            </div>
            <div class="hero-stats">
                <div class="stat" v-for="i in 3" :key="i">
                    <div class="skel skel-stat-val"></div>
                    <div class="skel skel-stat-lbl"></div>
                </div>
            </div>
        </template>

        <!-- Unavailable -->
        <template v-else-if="!bot">
            <div class="hero-identity">
                <div class="avatar avatar-offline">
                    <span class="avatar-fallback">?</span>
                </div>
                <div class="hero-meta">
                    <span class="bot-name">{{ $t('dashboard.hero.unavailable') }}</span>
                    <span class="status-pill pill-offline">{{ $t('dashboard.hero.statusOffline') }}</span>
                </div>
            </div>
        </template>

        <!-- Live data -->
        <template v-else>
            <div class="hero-identity">
                <div class="avatar-wrap">
                    <img v-if="bot.avatarUrl" :src="bot.avatarUrl" :alt="bot.userTag ?? 'Bot'" class="avatar" />
                    <div v-else class="avatar avatar-fallback-box">
                        {{ (bot.username ?? bot.userTag ?? 'B').charAt(0).toUpperCase() }}
                    </div>
                    <span
                        class="status-dot"
                        :class="bot.ready ? 'dot-ready' : 'dot-warn'"
                        :aria-label="bot.ready ? $t('dashboard.hero.ready') : $t('dashboard.hero.connecting')"
                    ></span>
                </div>
                <div class="hero-meta">
                    <span class="bot-name">{{ bot.globalName ?? bot.username ?? '—' }}</span>
                    <div class="hero-meta-row">
                        <code class="bot-tag">{{ bot.userTag ?? '—' }}</code>
                        <span
                            class="status-pill"
                            :class="bot.ready ? 'pill-ready' : 'pill-connecting'"
                        >
                            {{ bot.ready ? $t('dashboard.hero.ready') : $t('dashboard.hero.connecting') }}
                        </span>
                    </div>
                </div>
            </div>

            <div class="hero-stats">
                <div class="stat">
                    <span class="stat-value">{{ bot.guildCount.toLocaleString() }}</span>
                    <span class="stat-label">{{ $t('dashboard.hero.guilds') }}</span>
                </div>
                <div class="stat-divider"></div>
                <div class="stat">
                    <span class="stat-value">{{ formatDuration(bot.uptimeMs / 1000) }}</span>
                    <span class="stat-label">{{ $t('dashboard.hero.uptime') }}</span>
                </div>
            </div>
        </template>
    </div>
</template>

<style scoped>
.hero {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1.5rem;
    padding: 1.25rem 1.5rem;
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-xl);
    border-left: 4px solid var(--accent);
    flex-wrap: wrap;
}

/* ─── Error banner (inside hero) ────────────────────────────────── */
.hero-error {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    padding: 0.5rem 0.75rem;
    background: rgba(237, 66, 69, 0.1);
    border: 1px solid rgba(237, 66, 69, 0.35);
    border-radius: var(--radius-sm);
    color: #ed4245;
    font-size: 0.8rem;
    flex-basis: 100%;
    order: -1;
}

.error-icon {
    font-weight: 800;
    font-size: 0.9rem;
    line-height: 1;
    flex-shrink: 0;
}

/* ─── Identity block ─────────────────────────────────────────────── */
.hero-identity {
    display: flex;
    align-items: center;
    gap: 1rem;
    min-width: 0;
}

.avatar-wrap {
    position: relative;
    flex-shrink: 0;
}

.avatar {
    width: 56px;
    height: 56px;
    border-radius: 50%;
    object-fit: cover;
    display: block;
}

.avatar-fallback-box {
    width: 56px;
    height: 56px;
    border-radius: 50%;
    background: var(--accent-bg);
    color: var(--accent-text);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.5rem;
    font-weight: 700;
}

.avatar-offline {
    width: 56px;
    height: 56px;
    border-radius: 50%;
    background: var(--bg-surface-2);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-faint);
    font-size: 1.5rem;
}

.status-dot {
    position: absolute;
    bottom: 2px;
    right: 2px;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    border: 2px solid var(--bg-surface);
}
.dot-ready  { background: #3ba55d; }
.dot-warn   { background: #faa61a; }

.hero-meta {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    min-width: 0;
}

.hero-meta-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
}

.bot-name {
    font-size: 1.25rem;
    font-weight: 700;
    color: var(--text-strong);
    line-height: 1.2;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.bot-tag {
    font-family: "JetBrains Mono", "Fira Code", "Courier New", monospace;
    font-size: 0.78rem;
    color: var(--text-muted);
    background: var(--bg-surface-2);
    padding: 0.15rem 0.45rem;
    border-radius: var(--radius-sm);
}

/* ─── Status pills ──────────────────────────────────────────────── */
.status-pill {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.2rem 0.6rem;
    border-radius: var(--radius-pill);
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
}

.pill-ready {
    background: var(--success-bg);
    color: var(--success-text);
}

.pill-connecting {
    background: var(--warn-bg);
    color: var(--warn-text);
}

.pill-offline {
    background: var(--bg-surface-2);
    color: var(--text-muted);
}

/* ─── Stats block ───────────────────────────────────────────────── */
.hero-stats {
    display: flex;
    align-items: center;
    gap: 1.5rem;
    flex-shrink: 0;
}

.stat {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 0.1rem;
}

.stat-value {
    font-size: 2rem;
    font-weight: 800;
    color: var(--text-strong);
    line-height: 1;
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.02em;
}

.stat-label {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-muted);
    font-weight: 500;
}

.stat-divider {
    width: 1px;
    height: 2.5rem;
    background: var(--border);
}

/* ─── Skeleton ──────────────────────────────────────────────────── */
.skel {
    background: var(--bg-surface-2);
    border-radius: var(--radius-sm);
    animation: skel-pulse 1.6s ease-in-out infinite;
}

@keyframes skel-pulse {
    0%, 100% { opacity: 1; }
    50%       { opacity: 0.45; }
}

.skel-avatar  { width: 56px; height: 56px; border-radius: 50%; flex-shrink: 0; }
.skel-name    { width: 140px; height: 1.25rem; }
.skel-tag     { width: 100px; height: 0.9rem; margin-top: 0.2rem; }
.skel-stat-val { width: 64px; height: 2rem; }
.skel-stat-lbl { width: 48px; height: 0.7rem; margin-top: 0.15rem; align-self: flex-end; }

/* ─── Responsive ────────────────────────────────────────────────── */
@media (max-width: 640px) {
    .hero {
        flex-direction: column;
        align-items: flex-start;
        padding: 1rem;
    }

    .hero-stats {
        width: 100%;
        justify-content: flex-start;
    }

    .stat {
        align-items: flex-start;
    }

    .stat-value {
        font-size: 1.6rem;
    }
}
</style>
