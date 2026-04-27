<script setup lang="ts">
import { computed, ref } from 'vue';

const props = defineProps<{
    data: { date: string; count: number }[];
}>();

const chartMax = computed(() => {
    if (!props.data.length) return 1;
    return Math.max(...props.data.map(d => d.count), 1);
});

// Tooltip state
const tooltip = ref<{ day: { date: string; count: number }; x: number; y: number } | null>(null);

function showTooltip(event: MouseEvent | FocusEvent, day: { date: string; count: number }) {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    tooltip.value = {
        day,
        x: rect.left + rect.width / 2,
        y: rect.top
    };
}

function hideTooltip() {
    tooltip.value = null;
}

/** Format date label: "Apr 24" */
function dateLabel(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Short label for x-axis: "24" */
function shortLabel(iso: string): string {
    return new Date(iso).getDate().toString();
}

function heightPct(count: number): number {
    return Math.max((count / chartMax.value) * 100, count > 0 ? 4 : 0);
}
</script>

<template>
    <section class="chart-section" aria-label="DM activity chart">
        <h2 class="section-title">
            {{ $t('dashboard.dmChart.title') }}
            <span class="section-subtitle">{{ $t('dashboard.dmChart.subtitle') }}</span>
        </h2>

        <div v-if="!data.length" class="empty-chart">
            <p>{{ $t('dashboard.dmChart.empty') }}</p>
        </div>

        <div v-else class="chart-wrap" role="img" :aria-label="$t('dashboard.dmChart.ariaLabel')">
            <!-- Grid lines -->
            <div class="grid-lines" aria-hidden="true">
                <span class="grid-line" v-for="_ in 4" :key="_"></span>
            </div>

            <!-- Bars -->
            <div class="bars">
                <div
                    v-for="day in data"
                    :key="day.date"
                    class="bar-col"
                    @mouseenter="showTooltip($event, day)"
                    @mouseleave="hideTooltip"
                    @focusin="showTooltip($event, day)"
                    @focusout="hideTooltip"
                    tabindex="0"
                    :aria-label="`${dateLabel(day.date)}: ${day.count}`"
                >
                    <span class="bar-count" :class="{ invisible: day.count === 0 }">
                        {{ day.count }}
                    </span>
                    <div class="bar-track">
                        <div
                            class="bar-fill"
                            :style="{ height: heightPct(day.count) + '%' }"
                        ></div>
                    </div>
                    <span class="bar-date">{{ shortLabel(day.date) }}</span>
                </div>
            </div>
        </div>

        <!-- Floating tooltip rendered at chart level to avoid overflow issues -->
        <Teleport to="body">
            <div
                v-if="tooltip"
                class="chart-tooltip"
                :style="{
                    left: tooltip.x + 'px',
                    top: (tooltip.y - 8) + 'px',
                    transform: 'translateX(-50%) translateY(-100%)'
                }"
                aria-hidden="true"
            >
                <span class="tooltip-date">{{ dateLabel(tooltip.day.date) }}</span>
                <span class="tooltip-count">{{ tooltip.day.count }} DM{{ tooltip.day.count !== 1 ? 's' : '' }}</span>
            </div>
        </Teleport>
    </section>
</template>

<style scoped>
.chart-section {
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
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
}

.section-subtitle {
    font-size: 0.65rem;
    color: var(--text-faint);
    text-transform: none;
    letter-spacing: 0;
    font-weight: 400;
}

.empty-chart {
    padding: 1rem;
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
}

.empty-chart p {
    color: var(--text-muted);
    font-size: 0.875rem;
    margin: 0;
}

/* ─── Chart wrapper ─────────────────────────────────────────────── */
.chart-wrap {
    position: relative;
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: 1rem 1rem 0.75rem;
    overflow: visible;
}

/* ─── Grid lines ────────────────────────────────────────────────── */
.grid-lines {
    position: absolute;
    top: 1rem;
    left: 1rem;
    right: 1rem;
    /* Subtract the bar label area */
    bottom: calc(0.75rem + 1.4rem);
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    pointer-events: none;
}

.grid-line {
    display: block;
    width: 100%;
    height: 1px;
    background: var(--border);
    opacity: 0.5;
}

/* ─── Bars ──────────────────────────────────────────────────────── */
.bars {
    position: relative;
    display: flex;
    align-items: flex-end;
    gap: 0.5rem;
    height: 110px;
    z-index: 1;
}

.bar-col {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.25rem;
    height: 100%;
    cursor: default;
    border-radius: var(--radius-sm);
    transition: background var(--transition-fast) ease;
    padding: 0 1px;
}

.bar-col:hover,
.bar-col:focus-visible {
    background: var(--bg-surface-hover);
    outline: none;
}

.bar-count {
    font-size: 0.65rem;
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
    min-height: 1em;
    line-height: 1;
}

.bar-count.invisible {
    visibility: hidden;
}

.bar-track {
    flex: 1;
    width: 100%;
    display: flex;
    align-items: flex-end;
    background: var(--bg-surface-2);
    border-radius: var(--radius-sm) var(--radius-sm) 0 0;
    overflow: hidden;
}

.bar-fill {
    width: 100%;
    background: linear-gradient(180deg, var(--accent) 0%, rgba(88, 101, 242, 0.55) 100%);
    border-radius: var(--radius-sm) var(--radius-sm) 0 0;
    transition: height var(--transition-slow) ease;
    min-height: 2px;
}

.bar-date {
    font-size: 0.65rem;
    color: var(--text-muted);
    line-height: 1;
    padding-bottom: 0.1rem;
}

/* ─── Tooltip (teleported) ──────────────────────────────────────── */
</style>

<style>
/* global — tooltip is teleported outside scoped component */
.chart-tooltip {
    position: fixed;
    z-index: 9999;
    pointer-events: none;

    background: var(--bg-header, #1f2937);
    color: var(--text-on-header, #f9fafb);
    padding: 0.35rem 0.7rem;
    border-radius: 6px;
    font-size: 0.78rem;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.1rem;
    white-space: nowrap;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
}

.chart-tooltip .tooltip-date {
    font-size: 0.65rem;
    opacity: 0.75;
}

.chart-tooltip .tooltip-count {
    font-weight: 600;
}
</style>
