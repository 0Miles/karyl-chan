<script setup lang="ts">
import { onMounted, onUnmounted, ref, computed } from 'vue';
import { ApiError, api } from '../../../api/client';
import { getSystemStats } from '../../../api/system';
import { fetchRecentAudit, fetchBotEvents, fetchAdminLoginStatus } from '../../../api/admin';
import type { BotStatus, SystemStats, AdminAuditEntry, BotEvent, AdminLoginEntry } from '../../../api/types';
import { listGuilds } from '../../../api/guilds';
import type { GuildSummary } from '../../../api/guilds';
import { DashboardLayout } from '../../../layouts';
import { useApiError } from '../../../composables/use-api-error';
import AccessDeniedView from '../../../components/AccessDeniedView.vue';

import StatusHero from './StatusHero.vue';
import GuildsListCard from './GuildsListCard.vue';
import AdminLoginCard from './AdminLoginCard.vue';
import BotEventsCard from './BotEventsCard.vue';
import RecentActivity from './RecentActivity.vue';
import DmActivityChart from './DmActivityChart.vue';
import NeedsAttention from './NeedsAttention.vue';

const { accessDenied, reset: resetError, handle: handleApiError } = useApiError();

const bot = ref<BotStatus | null>(null);
const systemStats = ref<SystemStats | null>(null);
const auditEntries = ref<AdminAuditEntry[]>([]);
const botEvents = ref<BotEvent[]>([]);
const adminLogins = ref<AdminLoginEntry[]>([]);
const guilds = ref<GuildSummary[]>([]);
const lastUpdated = ref<Date | null>(null);

// Loading states per section (don't block the whole page)
const loadingBot = ref(true);
const loadingStats = ref(true);
const loadingAudit = ref(true);
const loadingEvents = ref(true);
const loadingLogin = ref(true);
const loadingGuilds = ref(true);

const globalLoading = computed(() =>
    loadingBot.value && loadingStats.value && loadingAudit.value &&
    loadingEvents.value && loadingLogin.value && loadingGuilds.value
);

// Error states — feature-level (not page-level)
const errorBot = ref<string | null>(null);
const errorStats = ref<string | null>(null);
const auditDenied = ref(false);
const errorAudit = ref<string | null>(null);
const eventsDenied = ref(false);
const errorEvents = ref<string | null>(null);
const loginDenied = ref(false);
const errorLogin = ref<string | null>(null);
const errorGuilds = ref<string | null>(null);

const REFRESH_INTERVAL_MS = 30_000;
const MIN_REFRESH_GAP_MS = 5_000;
let refreshTimer: ReturnType<typeof setInterval> | null = null;
let lastRefreshAt = 0;

async function loadBot() {
    loadingBot.value = true;
    errorBot.value = null;
    try {
        const result = await api.getBotStatus();
        bot.value = result;
    } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
            bot.value = null;
        } else if (err instanceof ApiError && err.status === 401) {
            handleApiError(err);
        } else {
            errorBot.value = err instanceof Error ? err.message : 'Unknown error';
        }
    } finally {
        loadingBot.value = false;
    }
}

async function loadStats() {
    loadingStats.value = true;
    errorStats.value = null;
    try {
        systemStats.value = await getSystemStats();
    } catch (err) {
        if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
            handleApiError(err);
        } else {
            errorStats.value = err instanceof Error ? err.message : 'Unknown error';
        }
    } finally {
        loadingStats.value = false;
    }
}

async function loadAudit() {
    loadingAudit.value = true;
    auditDenied.value = false;
    errorAudit.value = null;
    try {
        auditEntries.value = await fetchRecentAudit(20);
    } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
            handleApiError(err);
        } else if (err instanceof ApiError && err.status === 403) {
            auditDenied.value = true;
        } else {
            errorAudit.value = err instanceof Error ? err.message : 'Unknown error';
        }
    } finally {
        loadingAudit.value = false;
    }
}

async function loadEvents() {
    loadingEvents.value = true;
    eventsDenied.value = false;
    errorEvents.value = null;
    try {
        const result = await fetchBotEvents({ limit: 20 });
        botEvents.value = result.events;
    } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
            handleApiError(err);
        } else if (err instanceof ApiError && err.status === 403) {
            eventsDenied.value = true;
        } else {
            errorEvents.value = err instanceof Error ? err.message : 'Unknown error';
        }
    } finally {
        loadingEvents.value = false;
    }
}

async function loadLogin() {
    loadingLogin.value = true;
    loginDenied.value = false;
    errorLogin.value = null;
    try {
        const result = await fetchAdminLoginStatus();
        adminLogins.value = result.admins;
    } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
            handleApiError(err);
        } else if (err instanceof ApiError && err.status === 403) {
            loginDenied.value = true;
        } else {
            errorLogin.value = err instanceof Error ? err.message : 'Unknown error';
        }
    } finally {
        loadingLogin.value = false;
    }
}

async function loadGuilds() {
    loadingGuilds.value = true;
    errorGuilds.value = null;
    try {
        guilds.value = await listGuilds();
    } catch (err) {
        if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
            handleApiError(err);
        } else {
            errorGuilds.value = err instanceof Error ? err.message : 'Unknown error';
        }
    } finally {
        loadingGuilds.value = false;
    }
}

async function refresh() {
    lastRefreshAt = Date.now();
    resetError();
    await Promise.all([
        loadBot(),
        loadStats(),
        loadAudit(),
        loadEvents(),
        loadLogin(),
        loadGuilds()
    ]);
    lastUpdated.value = new Date();
}

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

const dmActivity = computed(() => systemStats.value?.dmActivity ?? []);
</script>

<template>
    <DashboardLayout :title="$t('dashboard.title')">
        <template #actions>
            <span v-if="lastUpdated" class="last-updated">
                {{ $t('common.updated', { time: lastUpdated.toLocaleTimeString() }) }}
            </span>
            <button
                type="button"
                class="refresh-btn"
                :disabled="globalLoading"
                :aria-label="$t('common.refresh')"
                @click="refresh"
            >
                <span class="refresh-icon" :class="{ spinning: globalLoading }" aria-hidden="true">↻</span>
                {{ $t('common.refresh') }}
            </button>
        </template>

        <!-- Global access denied (401/403 on protected routes) -->
        <AccessDeniedView v-if="accessDenied" />

        <template v-else>
            <!-- ── 1. Hero status ─────────────────────────────────────── -->
            <StatusHero
                :bot="bot"
                :loading="loadingBot"
            />

            <!-- ── 2. Needs attention (conditional) ──────────────────── -->
            <NeedsAttention :stats="systemStats" />

            <!-- ── 3. Guilds list ─────────────────────────────────────── -->
            <GuildsListCard
                :guilds="guilds"
                :loading="loadingGuilds"
                :error="errorGuilds"
            />

            <!-- ── 4. Middle two-col row: Chart + Admin Login ─────────── -->
            <div class="mid-row">
                <DmActivityChart
                    v-if="!loadingStats && dmActivity.length"
                    :data="dmActivity"
                    class="mid-chart"
                />
                <div v-else-if="loadingStats" class="mid-chart chart-skel">
                    <div class="skel skel-chart-title"></div>
                    <div class="skel skel-chart-body"></div>
                </div>
                <div v-else class="mid-chart">
                    <DmActivityChart :data="[]" />
                </div>

                <AdminLoginCard
                    :admins="adminLogins"
                    :loading="loadingLogin"
                    :permission-denied="loginDenied"
                    :error="errorLogin"
                    class="mid-login"
                />
            </div>

            <!-- ── 5. Bottom two-col row: Bot Events + Recent Activity ── -->
            <div class="bottom-row">
                <BotEventsCard
                    :events="botEvents"
                    :loading="loadingEvents"
                    :permission-denied="eventsDenied"
                    :error="errorEvents"
                    class="bottom-events"
                />

                <RecentActivity
                    :entries="auditEntries"
                    :loading="loadingAudit"
                    :permission-denied="auditDenied"
                    class="bottom-activity"
                />
            </div>
        </template>
    </DashboardLayout>
</template>

<style scoped>
/* ─── Actions bar ───────────────────────────────────────────────── */
.last-updated {
    color: var(--text-muted);
    font-size: 0.8rem;
}

.refresh-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.35rem 0.75rem;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    background: var(--bg-surface);
    color: var(--text);
    cursor: pointer;
    font-size: 0.85rem;
    transition:
        background var(--transition-fast) ease,
        border-color var(--transition-fast) ease;
}

.refresh-btn:hover:not(:disabled) {
    background: var(--bg-surface-hover);
    border-color: var(--accent);
}

.refresh-btn:disabled {
    opacity: 0.55;
    cursor: default;
}

.refresh-icon {
    font-size: 1rem;
    line-height: 1;
    display: inline-block;
    transition: transform 0.5s ease;
}

.refresh-icon.spinning {
    animation: spin 1s linear infinite;
}

@keyframes spin {
    to { transform: rotate(360deg); }
}

/* ─── Layout: main sections stacked with gap ────────────────────── */
:deep(.content) {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
}

/* ─── Middle two-column row (chart | admin login) ────────────────── */
.mid-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 1.5rem;
    align-items: start;
}

.mid-chart {
    position: sticky;
    top: 0;
}

/* ─── Bottom two-column row (events | activity) ──────────────────── */
.bottom-row {
    display: grid;
    grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr);
    gap: 1.5rem;
    align-items: start;
}

/* ─── Chart skeleton ────────────────────────────────────────────── */
.chart-skel {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
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

.skel-chart-title { height: 0.7rem; width: 8rem; }
.skel-chart-body  {
    height: 152px;
    border-radius: var(--radius-lg);
}

/* ─── Responsive ────────────────────────────────────────────────── */
@media (max-width: 900px) {
    .mid-row,
    .bottom-row {
        grid-template-columns: 1fr;
    }

    .mid-chart {
        position: static;
    }
}
</style>
