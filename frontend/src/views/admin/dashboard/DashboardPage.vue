<script setup lang="ts">
import { onMounted, onUnmounted, ref, computed } from 'vue';
import { ApiError, api } from '../../../api/client';
import { getSystemStats } from '../../../api/system';
import { fetchFeatureSummary } from '../../../api/system';
import { fetchRecentAudit } from '../../../api/admin';
import type { BotStatus, FeatureSummary, SystemStats, AdminAuditEntry } from '../../../api/types';
import { DashboardLayout } from '../../../layouts';
import { useApiError } from '../../../composables/use-api-error';
import AccessDeniedView from '../../../components/AccessDeniedView.vue';

import StatusHero from './StatusHero.vue';
import FeatureInventory from './FeatureInventory.vue';
import RecentActivity from './RecentActivity.vue';
import DmActivityChart from './DmActivityChart.vue';
import NeedsAttention from './NeedsAttention.vue';

const { accessDenied, reset: resetError, handle: handleApiError } = useApiError();

const bot = ref<BotStatus | null>(null);
const systemStats = ref<SystemStats | null>(null);
const featureSummary = ref<FeatureSummary | null>(null);
const auditEntries = ref<AdminAuditEntry[]>([]);
const lastUpdated = ref<Date | null>(null);

// Loading states per section (don't block the whole page)
const loadingBot = ref(true);
const loadingStats = ref(true);
const loadingFeatures = ref(true);
const loadingAudit = ref(true);

const globalLoading = computed(() =>
    loadingBot.value && loadingStats.value && loadingFeatures.value && loadingAudit.value
);

// Error states — feature-level (not page-level)
const errorBot = ref<string | null>(null);
const errorStats = ref<string | null>(null);
const featuresDenied = ref(false);
const auditDenied = ref(false);
const errorFeatures = ref<string | null>(null);
const errorAudit = ref<string | null>(null);

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
            // Handled globally — handleApiError will redirect
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

async function loadFeatures() {
    loadingFeatures.value = true;
    featuresDenied.value = false;
    errorFeatures.value = null;
    try {
        featureSummary.value = await fetchFeatureSummary();
    } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
            handleApiError(err);
        } else if (err instanceof ApiError && err.status === 403) {
            featuresDenied.value = true;
        } else {
            errorFeatures.value = err instanceof Error ? err.message : 'Unknown error';
        }
    } finally {
        loadingFeatures.value = false;
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

async function refresh() {
    lastRefreshAt = Date.now();
    resetError();
    await Promise.all([loadBot(), loadStats(), loadFeatures(), loadAudit()]);
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

            <!-- ── 3. Feature inventory ───────────────────────────────── -->
            <FeatureInventory
                :summary="featureSummary"
                :loading="loadingFeatures"
                :permission-denied="featuresDenied"
            />

            <!-- ── Bottom two-col row ─────────────────────────────────── -->
            <div class="bottom-row">
                <!-- ── 4. DM activity chart ───────────────────────────── -->
                <DmActivityChart
                    v-if="!loadingStats && dmActivity.length"
                    :data="dmActivity"
                    class="bottom-chart"
                />
                <div v-else-if="loadingStats" class="bottom-chart chart-skel">
                    <div class="skel skel-chart-title"></div>
                    <div class="skel skel-chart-body"></div>
                </div>

                <!-- ── 5. Recent admin activity ───────────────────────── -->
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

/* ─── Bottom two-column row ─────────────────────────────────────── */
.bottom-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.6fr);
    gap: 1.5rem;
    align-items: start;
}

.bottom-chart {
    /* sticky top for taller activity feeds */
    position: sticky;
    top: 0;
}

.bottom-activity {
    /* activity feed can grow freely */
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
    .bottom-row {
        grid-template-columns: 1fr;
    }

    .bottom-chart {
        position: static;
    }
}
</style>
