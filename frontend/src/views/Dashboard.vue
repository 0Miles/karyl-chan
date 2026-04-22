<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { ApiError, api } from '../api/client';
import type { BotStatus, HealthStatus } from '../api/types';

const health = ref<HealthStatus | null>(null);
const bot = ref<BotStatus | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);
const lastUpdated = ref<Date | null>(null);

const REFRESH_INTERVAL_MS = 10_000;
let refreshTimer: ReturnType<typeof setInterval> | null = null;

async function refresh() {
    try {
        const [healthResult, botResult] = await Promise.allSettled([
            api.getHealth(),
            api.getBotStatus()
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

        error.value = null;
        lastUpdated.value = new Date();
    } catch (err) {
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
    color: #6b7280;
    font-size: 0.9rem;
}
.error {
    color: #b91c1c;
}
button {
    padding: 0.4rem 0.8rem;
    border: 1px solid #d1d5db;
    border-radius: 4px;
    background: #fff;
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
    background: #fff;
    border: 1px solid #e5e7eb;
    border-radius: 6px;
    padding: 1rem 1.25rem;
}
.card h2 {
    margin: 0 0 0.75rem;
    font-size: 1rem;
    color: #374151;
}
.card-muted {
    background: #f3f4f6;
}
dl {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 0.25rem 1rem;
    margin: 0;
}
dt {
    color: #6b7280;
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
    background: #d1fae5;
    color: #065f46;
}
.pill-warn {
    background: #fef3c7;
    color: #92400e;
}
</style>
