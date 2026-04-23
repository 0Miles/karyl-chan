<script setup lang="ts">
import { onMounted, onUnmounted, ref, computed } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import { ApiError, api } from '../../api/client';
import { listGuilds, type GuildSummary } from '../../api/guilds';
import { getSystemEvents, getSystemStats } from '../../api/system';
import type { BotStatus, HealthStatus, SystemEvent, SystemStats } from '../../api/types';

const router = useRouter();

const health = ref<HealthStatus | null>(null);
const bot = ref<BotStatus | null>(null);
const guilds = ref<GuildSummary[]>([]);
const systemEvents = ref<SystemEvent[]>([]);
const systemStats = ref<SystemStats | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);
const lastUpdated = ref<Date | null>(null);

const REFRESH_INTERVAL_MS = 10_000;
let refreshTimer: ReturnType<typeof setInterval> | null = null;

async function refresh() {
    try {
        const [healthResult, botResult, guildsResult, eventsResult, statsResult] = await Promise.allSettled([
            api.getHealth(),
            api.getBotStatus(),
            listGuilds(),
            getSystemEvents(),
            getSystemStats()
        ]);

        if (healthResult.status === 'fulfilled') {
            health.value = healthResult.value;
        } else {
            throw healthResult.reason;
        }

        if (botResult.status === 'fulfilled') {
            bot.value = botResult.value;
        } else if (botResult.reason instanceof ApiError && botResult.reason.status === 404) {
            bot.value = null;
        } else {
            throw botResult.reason;
        }

        if (guildsResult.status === 'fulfilled') guilds.value = guildsResult.value;
        if (eventsResult.status === 'fulfilled') systemEvents.value = eventsResult.value;
        if (statsResult.status === 'fulfilled') systemStats.value = statsResult.value;

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

function formatEventTime(iso: string): string {
    return new Date(iso).toLocaleTimeString();
}

function formatEventDate(iso: string): string {
    const d = new Date(iso);
    const today = new Date();
    if (d.toDateString() === today.toDateString()) return 'Today';
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return d.toLocaleDateString();
}

const eventIcon: Record<string, string> = {
    'bot-ready': '✅',
    'bot-disconnect': '❌',
    'guild-join': '➕',
    'guild-leave': '➖',
    'server-start': '🚀',
    'error': '⚠️'
};

const memUsagePercent = computed(() => {
    if (!systemStats.value) return 0;
    const { heapUsedMb, heapTotalMb } = systemStats.value.memory;
    return Math.round((heapUsedMb / heapTotalMb) * 100);
});

const chartMax = computed(() => {
    if (!systemStats.value?.dmActivity.length) return 1;
    return Math.max(...systemStats.value.dmActivity.map(d => d.count), 1);
});

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
            <!-- Web server status -->
            <article v-if="health" class="card">
                <h2>Web server</h2>
                <dl>
                    <dt>Status</dt>
                    <dd><span class="pill pill-ok">{{ health.status }}</span></dd>
                    <dt>Uptime</dt>
                    <dd>{{ formatDuration(health.uptime) }}</dd>
                    <dt>Server time</dt>
                    <dd>{{ new Date(health.timestamp).toLocaleString() }}</dd>
                </dl>
            </article>

            <!-- Discord bot identity -->
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

            <!-- System monitoring -->
            <article v-if="systemStats" class="card">
                <h2>System</h2>
                <dl>
                    <dt>Database</dt>
                    <dd>
                        <span :class="['pill', systemStats.dbConnected ? 'pill-ok' : 'pill-danger']">
                            {{ systemStats.dbConnected ? 'connected' : 'disconnected' }}
                        </span>
                    </dd>
                    <dt>Heap memory</dt>
                    <dd>
                        <div class="mem-row">
                            <span>{{ systemStats.memory.heapUsedMb }} / {{ systemStats.memory.heapTotalMb }} MB</span>
                            <div class="mem-bar">
                                <div class="mem-fill" :style="{ width: memUsagePercent + '%' }" :class="{ 'mem-warn': memUsagePercent > 80 }"></div>
                            </div>
                        </div>
                    </dd>
                    <dt>RSS</dt>
                    <dd>{{ systemStats.memory.rssMb }} MB</dd>
                    <dt>DM channels</dt>
                    <dd>{{ systemStats.dmChannelCount }}</dd>
                </dl>
            </article>

            <!-- DM activity chart -->
            <article v-if="systemStats?.dmActivity.length" class="card chart-card">
                <h2>DM activity <span class="muted subtitle">past 7 days</span></h2>
                <div class="chart">
                    <div
                        v-for="day in systemStats.dmActivity"
                        :key="day.date"
                        class="bar-col"
                    >
                        <div class="bar-label count">{{ day.count || '' }}</div>
                        <div class="bar-track">
                            <div
                                class="bar-fill"
                                :style="{ height: (day.count / chartMax * 100) + '%' }"
                            ></div>
                        </div>
                        <div class="bar-label date">{{ day.date.slice(5) }}</div>
                    </div>
                </div>
            </article>

            <!-- Guilds list -->
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

            <!-- System event log -->
            <article v-if="systemEvents.length" class="card events-card">
                <h2>System events</h2>
                <ul class="event-list">
                    <li v-for="evt in systemEvents.slice(0, 20)" :key="evt.id" class="event-row">
                        <span class="event-icon">{{ eventIcon[evt.type] ?? '•' }}</span>
                        <span class="event-body">
                            <span class="event-msg">{{ evt.message }}</span>
                            <span class="event-time muted">{{ formatEventDate(evt.timestamp) }} {{ formatEventTime(evt.timestamp) }}</span>
                        </span>
                    </li>
                </ul>
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
.pill-danger {
    background: var(--danger-bg, #fee2e2);
    color: var(--danger-text, #991b1b);
}

/* memory bar */
.mem-row {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.9rem;
}
.mem-bar {
    height: 6px;
    border-radius: 3px;
    background: var(--bg-surface-2);
    overflow: hidden;
}
.mem-fill {
    height: 100%;
    border-radius: 3px;
    background: var(--accent);
    transition: width 0.4s ease;
}
.mem-fill.mem-warn {
    background: var(--warn-text, #92400e);
}

/* chart */
.chart-card {
    min-width: 0;
}
.subtitle {
    font-size: 0.75rem;
    font-weight: normal;
}
.chart {
    display: flex;
    align-items: flex-end;
    gap: 0.5rem;
    height: 100px;
    padding-top: 1.25rem;
}
.bar-col {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.2rem;
    height: 100%;
}
.bar-track {
    flex: 1;
    width: 100%;
    display: flex;
    align-items: flex-end;
    background: var(--bg-surface-2);
    border-radius: 3px 3px 0 0;
    overflow: hidden;
}
.bar-fill {
    width: 100%;
    background: var(--accent);
    border-radius: 3px 3px 0 0;
    transition: height 0.4s ease;
    min-height: 2px;
}
.bar-label {
    font-size: 0.65rem;
    color: var(--text-muted);
    white-space: nowrap;
}
.bar-label.count {
    min-height: 1em;
}

/* guilds */
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

/* event log */
.events-card {
    grid-column: 1 / -1;
}
.event-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
}
.event-row {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    font-size: 0.875rem;
    padding: 0.3rem 0;
    border-bottom: 1px solid var(--border);
}
.event-row:last-child {
    border-bottom: none;
}
.event-icon {
    flex-shrink: 0;
    font-size: 0.8rem;
}
.event-body {
    flex: 1;
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    min-width: 0;
}
.event-msg {
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.event-time {
    flex-shrink: 0;
    font-size: 0.78rem;
}
</style>
