<script setup lang="ts">
import { onMounted, onUnmounted, ref, computed } from 'vue';
import { RouterLink } from 'vue-router';
import { ApiError, api } from '../../../api/client';
import { listGuilds, type GuildSummary } from '../../../api/guilds';
import { getSystemEvents, getSystemStats } from '../../../api/system';
import type { BotStatus, HealthStatus, SystemEvent, SystemStats } from '../../../api/types';
import { DashboardLayout } from '../../../layouts';
import { useApiError } from '../../../composables/use-api-error';
import AccessDeniedView from '../../../components/AccessDeniedView.vue';

const { accessDenied, reset: resetError, handle: handleApiError } = useApiError();

const health = ref<HealthStatus | null>(null);
const bot = ref<BotStatus | null>(null);
const guilds = ref<GuildSummary[]>([]);
const systemEvents = ref<SystemEvent[]>([]);
const systemStats = ref<SystemStats | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);
const lastUpdated = ref<Date | null>(null);

// 30s gives enough granularity for "is the bot alive?" without burning
// five round-trips every 10s on a tab nobody's looking at. The visibility
// hook below pauses entirely when hidden — pre-Visibility-API browsers
// just keep the slower cadence.
const REFRESH_INTERVAL_MS = 30_000;
let refreshTimer: ReturnType<typeof setInterval> | null = null;
// Skip refreshes that would land less than this apart (e.g. visibility
// flapping). The previous interval was effectively this — keep at least
// that responsiveness for the manual button without re-firing on every
// tab focus.
const MIN_REFRESH_GAP_MS = 5_000;
let lastRefreshAt = 0;

async function refresh() {
    lastRefreshAt = Date.now();
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
        resetError();
        lastUpdated.value = new Date();
    } catch (err) {
        if (handleApiError(err) !== 'unhandled') return;
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

function startTimer() {
    if (refreshTimer !== null) return;
    refreshTimer = setInterval(refresh, REFRESH_INTERVAL_MS);
}

function stopTimer() {
    if (refreshTimer === null) return;
    clearInterval(refreshTimer);
    refreshTimer = null;
}

function onVisibilityChange() {
    if (document.visibilityState === 'hidden') {
        stopTimer();
    } else {
        // Coming back from a hidden tab — refresh now if we've been
        // away long enough that the existing data is plausibly stale.
        if (Date.now() - lastRefreshAt >= MIN_REFRESH_GAP_MS) refresh();
        startTimer();
    }
}

onMounted(() => {
    refresh();
    if (document.visibilityState !== 'hidden') startTimer();
    document.addEventListener('visibilitychange', onVisibilityChange);
});

onUnmounted(() => {
    stopTimer();
    document.removeEventListener('visibilitychange', onVisibilityChange);
});
</script>

<template>
    <DashboardLayout :title="$t('dashboard.title')">
        <template #actions>
            <span v-if="lastUpdated" class="muted">
                {{ $t('common.updated', { time: lastUpdated.toLocaleTimeString() }) }}
            </span>
            <button type="button" :disabled="loading" @click="refresh">{{ $t('common.refresh') }}</button>
        </template>

        <AccessDeniedView v-if="accessDenied" />
        <template v-else>
        <p v-if="loading && !health" class="muted">{{ $t('common.loading') }}</p>
        <p v-else-if="error" class="error">{{ $t('common.failedToLoad', { error }) }}</p>

        <div v-if="health || bot" class="grid">
            <!-- Web server status -->
            <article v-if="health" class="card">
                <h2>{{ $t('dashboard.webServer') }}</h2>
                <dl>
                    <dt>{{ $t('dashboard.status') }}</dt>
                    <dd><span class="pill pill-ok">{{ health.status }}</span></dd>
                    <dt>{{ $t('dashboard.uptime') }}</dt>
                    <dd>{{ formatDuration(health.uptime) }}</dd>
                    <dt>{{ $t('dashboard.serverTime') }}</dt>
                    <dd>{{ new Date(health.timestamp).toLocaleString() }}</dd>
                </dl>
            </article>

            <!-- Discord bot identity -->
            <article v-if="bot" class="card">
                <h2>{{ $t('dashboard.discordBot') }}</h2>
                <dl>
                    <dt>{{ $t('dashboard.state') }}</dt>
                    <dd>
                        <span :class="['pill', bot.ready ? 'pill-ok' : 'pill-warn']">
                            {{ bot.ready ? $t('dashboard.ready') : $t('dashboard.connecting') }}
                        </span>
                    </dd>
                    <dt>{{ $t('dashboard.identity') }}</dt>
                    <dd>{{ bot.userTag ?? '—' }}</dd>
                    <dt>{{ $t('dashboard.guildsCount') }}</dt>
                    <dd>{{ bot.guildCount }}</dd>
                    <dt>{{ $t('dashboard.uptime') }}</dt>
                    <dd>{{ formatDuration(bot.uptimeMs / 1000) }}</dd>
                </dl>
            </article>
            <article v-else-if="!loading && !error" class="card card-muted">
                <h2>{{ $t('dashboard.discordBot') }}</h2>
                <p class="muted">{{ $t('dashboard.botStatusUnavailable') }}</p>
            </article>

            <!-- System monitoring -->
            <article v-if="systemStats" class="card">
                <h2>{{ $t('dashboard.system') }}</h2>
                <dl>
                    <dt>{{ $t('dashboard.database') }}</dt>
                    <dd>
                        <span :class="['pill', systemStats.dbConnected ? 'pill-ok' : 'pill-danger']">
                            {{ systemStats.dbConnected ? $t('dashboard.connected') : $t('dashboard.disconnected') }}
                        </span>
                    </dd>
                    <dt>{{ $t('dashboard.heapMemory') }}</dt>
                    <dd>
                        <div class="mem-row">
                            <span>{{ systemStats.memory.heapUsedMb }} / {{ systemStats.memory.heapTotalMb }} MB</span>
                            <div class="mem-bar">
                                <div class="mem-fill" :style="{ width: memUsagePercent + '%' }" :class="{ 'mem-warn': memUsagePercent > 80 }"></div>
                            </div>
                        </div>
                    </dd>
                    <dt>{{ $t('dashboard.rss') }}</dt>
                    <dd>{{ systemStats.memory.rssMb }} MB</dd>
                    <dt>{{ $t('dashboard.dmChannels') }}</dt>
                    <dd>{{ systemStats.dmChannelCount }}</dd>
                </dl>
            </article>

            <!-- DM activity chart -->
            <article v-if="systemStats?.dmActivity.length" class="card chart-card">
                <h2>{{ $t('dashboard.dmActivity') }} <span class="muted subtitle">{{ $t('dashboard.past7Days') }}</span></h2>
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
                <h2>{{ $t('dashboard.guilds') }} <span class="count-pill">{{ guilds.length }}</span></h2>
                <ul class="guild-list">
                    <li v-for="g in guilds" :key="g.id">
                        <RouterLink :to="`/admin/guilds`" class="guild-row" @click="$event.preventDefault?.()">
                            <img v-if="g.iconUrl" :src="g.iconUrl" :alt="g.name" class="icon" />
                            <div v-else class="icon icon-fallback">{{ g.name.charAt(0).toUpperCase() }}</div>
                            <div class="meta">
                                <div class="name">{{ g.name }}</div>
                                <div class="sub">{{ $t('guilds.memberCount', { count: g.memberCount }) }}</div>
                            </div>
                        </RouterLink>
                    </li>
                </ul>
                <RouterLink to="/admin/guilds" class="see-all">{{ $t('dashboard.manageGuilds') }}</RouterLink>
            </article>

            <!-- System event log -->
            <article v-if="systemEvents.length" class="card events-card">
                <h2>{{ $t('dashboard.systemEvents') }}</h2>
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
        </template>
    </DashboardLayout>
</template>

<style scoped>
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
    border-radius: var(--radius-sm);
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
    grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
    gap: 1rem;
}
.card {
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-base);
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
    border-radius: var(--radius-pill);
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
}
.guilds-card h2 {
    display: flex;
    align-items: center;
    gap: 0.5rem;
}
.count-pill {
    background: var(--bg-surface-2);
    color: var(--text-muted);
    border-radius: var(--radius-pill);
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
    border-radius: var(--radius-sm);
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
