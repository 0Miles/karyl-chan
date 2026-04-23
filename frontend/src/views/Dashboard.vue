<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import { ApiError, api } from '../api/client';
import { listGuilds, type GuildSummary } from '../api/guilds';
import type { BotStatus, HealthStatus } from '../api/types';

const router = useRouter();

const health = ref<HealthStatus | null>(null);
const bot = ref<BotStatus | null>(null);
const guilds = ref<GuildSummary[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);
const lastUpdated = ref<Date | null>(null);

const REFRESH_INTERVAL_MS = 10_000;
let refreshTimer: ReturnType<typeof setInterval> | null = null;

async function refresh() {
    try {
        const [healthResult, botResult, guildsResult] = await Promise.allSettled([
            api.getHealth(),
            api.getBotStatus(),
            listGuilds()
        ]);

        if (healthResult.status === 'fulfilled') {
            health.value = healthResult.value;
        } else {
            throw healthResult.reason;
        }

        // /api/bot/status is optional — absent in unit tests and before the
        // bot wiring lands. Treat a 404 as "bot not wired in", not an error.
        if (botResult.status === 'fulfilled') {
            bot.value = botResult.value;
        } else if (botResult.reason instanceof ApiError && botResult.reason.status === 404) {
            bot.value = null;
        } else {
            throw botResult.reason;
        }

        if (guildsResult.status === 'fulfilled') {
            guilds.value = guildsResult.value;
        }

        error.value = null;
        lastUpdated.value = new Date();
    } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
            router.replace({ name: 'auth' });
            return;
        }
        error.value = err instanceof Error ? err.message : 'Unknown error';
    } finally {
        loading.value = false;
    }
}

function formatDuration(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds <= 0) return '—';
    const s = Math.floor(seconds);
    const days = Math.floor(s / 86400);
    const hours = Math.floor((s % 86400) / 3600);
    const mins = Math.floor((s % 3600) / 60);
    const secs = s % 60;
    if (days > 0) return `${days}d ${hours}h ${mins}m`;
    if (hours > 0) return `${hours}h ${mins}m ${secs}s`;
    if (mins > 0) return `${mins}m ${secs}s`;
    return `${secs}s`;
}

onMounted(() => {
    refresh();
    refreshTimer = setInterval(refresh, REFRESH_INTERVAL_MS);
});

onUnmounted(() => {
    if (refreshTimer !== null) clearInterval(refreshTimer);
});
</script>

<template>
    <section>
        <header class="page-header">
            <h1>Dashboard</h1>
            <div class="meta">
                <span v-if="lastUpdated" class="muted">
                    Updated {{ lastUpdated.toLocaleTimeString() }}
                </span>
                <button type="button" :disabled="loading" @click="refresh">Refresh</button>
            </div>
        </header>

        <p v-if="loading && !health" class="muted">Loading…</p>
        <p v-else-if="error" class="error">Failed to load: {{ error }}</p>

        <div v-if="health || bot" class="grid">
            <article v-if="health" class="card">
                <h2>Web server</h2>
                <dl>
                    <dt>Status</dt>
                    <dd>
                        <span class="pill pill-ok">{{ health.status }}</span>
                    </dd>
                    <dt>Uptime</dt>
                    <dd>{{ formatDuration(health.uptime) }}</dd>
                    <dt>Server time</dt>
                    <dd>{{ new Date(health.timestamp).toLocaleString() }}</dd>
                </dl>
            </article>

            <article v-if="bot" class="card">
                <h2>Discord bot</h2>
                <dl>
                    <dt>State</dt>
                    <dd>
                        <span :class="['pill', bot.ready ? 'pill-ok' : 'pill-warn']">
                            {{ bot.ready ? 'ready' : 'connecting' }}
                        </span>
                    </dd>
                    <dt>Identity</dt>
                    <dd>{{ bot.userTag ?? '—' }}</dd>
                    <dt>Guilds</dt>
                    <dd>{{ bot.guildCount }}</dd>
                    <dt>Uptime</dt>
                    <dd>{{ formatDuration(bot.uptimeMs / 1000) }}</dd>
                </dl>
            </article>
            <article v-else-if="!loading && !error" class="card card-muted">
                <h2>Discord bot</h2>
                <p class="muted">Bot status endpoint not available on this server.</p>
            </article>

            <article v-if="guilds.length" class="card guilds-card">
                <h2>Guilds <span class="count-pill">{{ guilds.length }}</span></h2>
                <ul class="guild-list">
                    <li v-for="g in guilds" :key="g.id">
                        <RouterLink :to="`/guilds`" class="guild-row" @click="$event.preventDefault?.()">
                            <img v-if="g.iconUrl" :src="g.iconUrl" :alt="g.name" class="icon" />
                            <div v-else class="icon icon-fallback">{{ g.name.charAt(0).toUpperCase() }}</div>
                            <div class="meta">
                                <div class="name">{{ g.name }}</div>
                                <div class="sub">{{ g.memberCount }} members</div>
                            </div>
                        </RouterLink>
                    </li>
                </ul>
                <RouterLink to="/guilds" class="see-all">Manage guilds →</RouterLink>
            </article>
        </div>
    </section>
</template>

<style scoped>
.page-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 1rem;
}
.page-header h1 {
    margin: 0;
}
.meta {
    display: flex;
    align-items: center;
    gap: 0.75rem;
}
.muted {
    color: var(--text-muted);
    font-size: 0.9rem;
}
.error {
    color: var(--danger);
}
button {
    padding: 0.4rem 0.8rem;
    border: 1px solid var(--border-strong);
    border-radius: 4px;
    background: var(--bg-surface);
    color: var(--text);
    cursor: pointer;
    font-size: 0.9rem;
}
button:disabled {
    opacity: 0.6;
    cursor: default;
}
.grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: 1rem;
}
.card {
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 1rem 1.25rem;
}
.card h2 {
    margin: 0 0 0.75rem;
    font-size: 1rem;
    color: var(--text);
}
.card-muted {
    background: var(--bg-surface-2);
}
dl {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 0.25rem 1rem;
    margin: 0;
}
dt {
    color: var(--text-muted);
    font-size: 0.85rem;
}
dd {
    margin: 0;
    font-size: 0.95rem;
}
.pill {
    display: inline-block;
    padding: 0.1rem 0.5rem;
    border-radius: 999px;
    font-size: 0.8rem;
    font-weight: 500;
    text-transform: lowercase;
}
.pill-ok {
    background: var(--success-bg);
    color: var(--success-text);
}
.pill-warn {
    background: var(--warn-bg);
    color: var(--warn-text);
}
.guilds-card {
    grid-column: 1 / -1;
}
.guilds-card h2 {
    display: flex;
    align-items: center;
    gap: 0.5rem;
}
.count-pill {
    background: var(--bg-surface-2);
    color: var(--text-muted);
    border-radius: 999px;
    padding: 0 0.5rem;
    font-size: 0.75rem;
    font-weight: 500;
}
.guild-list {
    list-style: none;
    margin: 0 0 0.5rem;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 0.4rem;
}
.guild-row {
    display: flex;
    gap: 0.5rem;
    padding: 0.4rem 0.5rem;
    border-radius: 4px;
    text-decoration: none;
    color: inherit;
}
.guild-row:hover {
    background: var(--bg-surface-hover);
}
.icon {
    width: 32px;
    height: 32px;
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
    font-weight: 600;
    font-size: 0.85rem;
}
.guild-row .meta .name {
    font-weight: 500;
    color: var(--text-strong);
}
.guild-row .meta .sub {
    font-size: 0.75rem;
    color: var(--text-muted);
}
.see-all {
    color: var(--accent-text);
    font-size: 0.85rem;
    text-decoration: none;
}
</style>
