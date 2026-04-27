<script setup lang="ts">
import { ref, computed } from 'vue';
import type { BotEvent, BotEventLevel } from '../../../api/types';

const props = defineProps<{
    events: BotEvent[];
    loading: boolean;
    permissionDenied: boolean;
    error?: string | null;
}>();

/** Active level filter; null = show all */
const activeLevel = ref<BotEventLevel | null>(null);

const filteredEvents = computed(() => {
    if (!activeLevel.value) return props.events;
    return props.events.filter(e => e.level === activeLevel.value);
});

function toggleLevel(level: BotEventLevel) {
    activeLevel.value = activeLevel.value === level ? null : level;
}

/** Relative time */
function relativeTime(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const secs = Math.floor(diff / 1000);
    if (secs < 60) return `${secs}s ago`;
    const mins = Math.floor(secs / 60);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
}

/** Count per level for filter chip badges */
function levelCount(level: BotEventLevel): number {
    return props.events.filter(e => e.level === level).length;
}

/** Expand / collapse context objects */
const expandedIds = ref<Set<number>>(new Set());

function toggleContext(id: number) {
    const next = new Set(expandedIds.value);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    expandedIds.value = next;
}

function hasContext(event: BotEvent): boolean {
    return !!event.context && Object.keys(event.context).length > 0;
}

function contextPreview(ctx: Record<string, unknown>): string {
    const keys = Object.keys(ctx).slice(0, 2);
    const preview = keys.map(k => `${k}: ${JSON.stringify(ctx[k])}`).join(', ');
    return Object.keys(ctx).length > 2 ? `${preview} …` : preview;
}

const LEVEL_ORDER: BotEventLevel[] = ['info', 'warn', 'error'];
</script>

<template>
    <section class="events-card" aria-label="Bot event log">
        <!-- Header + filter chips -->
        <div class="card-header">
            <h2 class="section-title">{{ $t('dashboard.botEvents.title') }}</h2>
            <!-- Level filter chips -->
            <div class="filter-chips" role="group" :aria-label="$t('dashboard.botEvents.filterAriaLabel')">
                <button
                    v-for="level in LEVEL_ORDER"
                    :key="level"
                    type="button"
                    class="chip"
                    :class="[`chip--${level}`, { 'chip--active': activeLevel === level }]"
                    :aria-pressed="activeLevel === level"
                    @click="toggleLevel(level)"
                >
                    {{ level }}
                    <span v-if="levelCount(level)" class="chip-count">{{ levelCount(level) }}</span>
                </button>
            </div>
        </div>

        <!-- Error banner -->
        <div v-if="error" class="error-banner" role="alert">
            <span class="error-icon" aria-hidden="true">!</span>
            {{ error }}
        </div>

        <!-- No permission -->
        <p v-else-if="permissionDenied" class="no-perm">{{ $t('dashboard.noPermission') }}</p>

        <!-- Loading skeleton -->
        <div v-else-if="loading && !events.length" class="events-list">
            <div v-for="i in 5" :key="i" class="event-row event-row--skel">
                <div class="skel skel-level"></div>
                <div class="event-body">
                    <div class="skel skel-msg"></div>
                    <div class="skel skel-meta"></div>
                </div>
            </div>
        </div>

        <!-- Empty state -->
        <p v-else-if="!filteredEvents.length" class="empty-state">
            {{ activeLevel
                ? $t('dashboard.botEvents.emptyFiltered', { level: activeLevel })
                : $t('dashboard.botEvents.empty') }}
        </p>

        <!-- Event feed -->
        <ul v-else class="events-list" role="list">
            <li
                v-for="event in filteredEvents"
                :key="event.id"
                class="event-row"
                :class="`event-row--${event.level}`"
                role="listitem"
            >
                <!-- Left accent bar + level indicator -->
                <div class="event-level-col" aria-hidden="true">
                    <span class="level-dot" :class="`dot--${event.level}`"></span>
                </div>

                <!-- Main body -->
                <div class="event-body">
                    <div class="event-top">
                        <!-- Category badge -->
                        <span class="category-badge">{{ event.category }}</span>
                        <!-- Message -->
                        <span class="event-message">{{ event.message }}</span>
                    </div>
                    <div class="event-meta">
                        <time :datetime="event.createdAt" class="event-time">{{ relativeTime(event.createdAt) }}</time>
                        <!-- Context expand toggle -->
                        <template v-if="hasContext(event)">
                            <span class="meta-sep" aria-hidden="true">·</span>
                            <button
                                type="button"
                                class="ctx-toggle"
                                :aria-expanded="expandedIds.has(event.id)"
                                @click="toggleContext(event.id)"
                            >
                                {{ expandedIds.has(event.id)
                                    ? $t('dashboard.botEvents.contextHide')
                                    : $t('dashboard.botEvents.contextShow') }}
                            </button>
                        </template>
                    </div>
                    <!-- Expanded context -->
                    <div v-if="hasContext(event) && expandedIds.has(event.id)" class="event-context">
                        <code>{{ contextPreview(event.context!) }}</code>
                    </div>
                </div>
            </li>
        </ul>
    </section>
</template>

<style scoped>
.events-card {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
}

/* ─── Header ─────────────────────────────────────────────────────── */
.card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    flex-wrap: wrap;
}

.section-title {
    font-size: 0.7rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-muted);
    margin: 0;
}

/* ─── Filter chips ───────────────────────────────────────────────── */
.filter-chips {
    display: flex;
    align-items: center;
    gap: 0.3rem;
}

.chip {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.15rem 0.55rem;
    border-radius: var(--radius-pill);
    font-size: 0.68rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    cursor: pointer;
    transition:
        background var(--transition-fast) ease,
        border-color var(--transition-fast) ease,
        opacity var(--transition-fast) ease;
    background: var(--bg-surface);
    border: 1px solid var(--border);
    color: var(--text-muted);
}

.chip:hover {
    border-color: var(--accent);
    color: var(--text);
}

/* Inactive state when another chip is active */
.chip:not(.chip--active) {
    opacity: 0.6;
}

.chip--info.chip--active  { background: rgba(88, 101, 242, 0.15); border-color: var(--accent); color: var(--accent-text); opacity: 1; }
.chip--warn.chip--active  { background: var(--warn-bg); border-color: #faa61a; color: #faa61a; opacity: 1; }
.chip--error.chip--active { background: rgba(237, 66, 69, 0.12); border-color: #ed4245; color: #ed4245; opacity: 1; }

/* Always full-opacity when no filter is active */
:not(.chip--active) ~ .chip:not(.chip--active),
.filter-chips:not(:has(.chip--active)) .chip {
    opacity: 1;
}

.chip-count {
    font-size: 0.62rem;
    opacity: 0.75;
    font-variant-numeric: tabular-nums;
}

/* ─── Error / no-perm / empty ────────────────────────────────────── */
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

.no-perm,
.empty-state {
    color: var(--text-muted);
    font-size: 0.875rem;
    margin: 0;
    padding: 1rem;
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
}

/* ─── Events list ────────────────────────────────────────────────── */
.events-list {
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

/* ─── Event row ──────────────────────────────────────────────────── */
.event-row {
    display: flex;
    align-items: flex-start;
    gap: 0;
    border-bottom: 1px solid var(--border);
    border-left: 3px solid transparent;
    transition: background var(--transition-fast) ease;
}

.event-row:last-child {
    border-bottom: none;
}

.event-row:hover {
    background: var(--bg-surface-hover);
}

.event-row--info  { border-left-color: var(--accent); }
.event-row--warn  { border-left-color: #faa61a; }
.event-row--error { border-left-color: #ed4245; }

/* ─── Level column ───────────────────────────────────────────────── */
.event-level-col {
    display: flex;
    align-items: flex-start;
    justify-content: center;
    width: 2.25rem;
    padding-top: 0.75rem;
    flex-shrink: 0;
}

.level-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
}

.dot--info  { background: var(--accent); box-shadow: 0 0 0 2px rgba(88, 101, 242, 0.2); }
.dot--warn  { background: #faa61a; box-shadow: 0 0 0 2px rgba(250, 166, 26, 0.2); }
.dot--error { background: #ed4245; box-shadow: 0 0 0 2px rgba(237, 66, 69, 0.2); }

/* ─── Event body ─────────────────────────────────────────────────── */
.event-body {
    flex: 1;
    min-width: 0;
    padding: 0.65rem 0.9rem 0.65rem 0;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
}

.event-top {
    display: flex;
    align-items: baseline;
    gap: 0.4rem;
    flex-wrap: wrap;
}

.category-badge {
    display: inline-flex;
    align-items: center;
    padding: 0.05rem 0.4rem;
    border-radius: var(--radius-sm);
    background: var(--bg-surface-2);
    color: var(--text-muted);
    font-size: 0.65rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    flex-shrink: 0;
    font-family: "JetBrains Mono", "Fira Code", monospace;
}

.event-message {
    font-size: 0.82rem;
    color: var(--text);
    line-height: 1.4;
    word-break: break-word;
}

.event-meta {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.7rem;
    color: var(--text-faint);
}

.event-time {
    white-space: nowrap;
}

.meta-sep {
    color: var(--text-faint);
}

.ctx-toggle {
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    font-size: 0.7rem;
    color: var(--accent-text);
    text-decoration: underline;
    text-underline-offset: 2px;
    transition: opacity var(--transition-fast) ease;
}

.ctx-toggle:hover {
    opacity: 0.7;
}

/* ─── Context box ────────────────────────────────────────────────── */
.event-context {
    margin-top: 0.25rem;
}

.event-context code {
    font-family: "JetBrains Mono", "Fira Code", monospace;
    font-size: 0.7rem;
    color: var(--text-muted);
    background: var(--bg-surface-2);
    padding: 0.2rem 0.5rem;
    border-radius: var(--radius-sm);
    display: inline-block;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

/* ─── Skeleton ───────────────────────────────────────────────────── */
.event-row--skel {
    pointer-events: none;
    padding: 0.65rem 0.9rem 0.65rem 2.25rem;
    border-left: 3px solid var(--border);
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

.skel-level { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; margin-top: 0.35rem; }
.skel-msg   { width: 70%; height: 0.82rem; }
.skel-meta  { width: 45%; height: 0.7rem; margin-top: 0.15rem; }
</style>
