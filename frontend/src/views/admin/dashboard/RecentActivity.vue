<script setup lang="ts">
import type { AdminAuditEntry } from '../../../api/types';
import { computed } from 'vue';

const props = defineProps<{
    entries: AdminAuditEntry[];
    loading: boolean;
    permissionDenied: boolean;
}>();

/** Map action token to a human-readable label */
function actionLabel(action: string): { verb: string; noun: string } {
    const map: Record<string, [string, string]> = {
        'user.upsert':          ['Updated', 'user'],
        'user.delete':          ['Removed', 'user'],
        'role.grant':           ['Granted', 'role'],
        'role.revoke':          ['Revoked', 'role'],
        'role.upsert':          ['Updated', 'role'],
        'role.delete':          ['Deleted', 'role'],
        'capability.grant':     ['Granted', 'capability'],
        'capability.revoke':    ['Revoked', 'capability'],
        'feature.todo.upsert':  ['Updated', 'todo channel'],
        'feature.todo.delete':  ['Removed', 'todo channel'],
        'feature.picture.upsert': ['Updated', 'picture-only'],
        'feature.picture.delete': ['Removed', 'picture-only'],
        'feature.rcon.upsert':  ['Updated', 'RCON forward'],
        'feature.rcon.delete':  ['Removed', 'RCON forward'],
        'feature.roleemoji.upsert': ['Updated', 'role emoji'],
        'feature.roleemoji.delete': ['Removed', 'role emoji'],
    };
    const entry = map[action];
    if (entry) return { verb: entry[0], noun: entry[1] };
    // Fallback: split on last dot
    const parts = action.split('.');
    const verb = parts[parts.length - 1] ?? action;
    const noun = parts.slice(0, -1).join('.');
    return {
        verb: verb.charAt(0).toUpperCase() + verb.slice(1),
        noun
    };
}

/** Relative time: "3m ago", "2h ago", "4d ago" */
function relativeTime(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const secs = Math.floor(diff / 1000);
    if (secs < 60)  return `${secs}s ago`;
    const mins = Math.floor(secs / 60);
    if (mins < 60)  return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
}

/** Short actor ID: last 6 chars */
function shortId(id: string): string {
    return id.slice(-6);
}

/** Summarise context JSON into a 1-line string */
function contextSummary(ctx: Record<string, unknown> | null): string | null {
    if (!ctx) return null;
    const keys = Object.keys(ctx);
    if (!keys.length) return null;
    const first = keys.slice(0, 2).map(k => `${k}: ${JSON.stringify(ctx[k])}`).join(', ');
    return keys.length > 2 ? `${first} …` : first;
}

/** Colour-coded dot per action verb */
function dotClass(action: string): string {
    if (action.includes('delete') || action.includes('revoke')) return 'dot-danger';
    if (action.includes('grant') || action.includes('upsert') || action.includes('create')) return 'dot-success';
    return 'dot-neutral';
}
</script>

<template>
    <section class="activity" aria-label="Recent admin activity">
        <h2 class="section-title">{{ $t('dashboard.activity.title') }}</h2>

        <p v-if="permissionDenied" class="no-perm">{{ $t('dashboard.noPermission') }}</p>

        <div v-else-if="loading && !entries.length" class="feed">
            <div v-for="i in 5" :key="i" class="feed-item feed-item--skel">
                <div class="timeline-col">
                    <div class="skel skel-dot"></div>
                    <div class="skel skel-line"></div>
                </div>
                <div class="feed-body">
                    <div class="skel skel-title"></div>
                    <div class="skel skel-sub"></div>
                </div>
            </div>
        </div>

        <div v-else-if="entries.length" class="feed" role="list">
            <div
                v-for="(entry, idx) in entries"
                :key="entry.id"
                class="feed-item"
                role="listitem"
            >
                <div class="timeline-col" aria-hidden="true">
                    <span class="dot" :class="dotClass(entry.action)"></span>
                    <span v-if="idx < entries.length - 1" class="line"></span>
                </div>
                <div class="feed-body">
                    <div class="feed-title">
                        <span class="action-verb">{{ actionLabel(entry.action).verb }}</span>
                        <span class="action-noun">{{ actionLabel(entry.action).noun }}</span>
                        <span v-if="entry.target" class="target">
                            <code>{{ entry.target }}</code>
                        </span>
                    </div>
                    <div class="feed-meta">
                        <span class="actor" :title="entry.actorUserId">
                            {{ $t('dashboard.activity.by') }}
                            <code class="actor-id">…{{ shortId(entry.actorUserId) }}</code>
                        </span>
                        <span class="sep">·</span>
                        <time :datetime="entry.createdAt" class="rel-time">{{ relativeTime(entry.createdAt) }}</time>
                    </div>
                    <div v-if="contextSummary(entry.context)" class="feed-ctx">
                        <code>{{ contextSummary(entry.context) }}</code>
                    </div>
                </div>
            </div>
        </div>

        <p v-else class="empty-state">{{ $t('dashboard.activity.empty') }}</p>
    </section>
</template>

<style scoped>
.activity {
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

/* ─── Feed container ────────────────────────────────────────────── */
.feed {
    display: flex;
    flex-direction: column;
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    overflow: hidden;
}

/* ─── Feed item ─────────────────────────────────────────────────── */
.feed-item {
    display: flex;
    gap: 0;
    padding: 0.75rem 1rem 0.75rem 0;
    border-bottom: 1px solid var(--border);
    transition: background var(--transition-fast) ease;
}

.feed-item:last-child {
    border-bottom: none;
}

.feed-item:hover {
    background: var(--bg-surface-hover);
}

/* ─── Timeline column ───────────────────────────────────────────── */
.timeline-col {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 0 1rem;
    width: 2.5rem;
    flex-shrink: 0;
}

.dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    margin-top: 0.35rem;
    flex-shrink: 0;
    position: relative;
    z-index: 1;
}

.dot-success { background: #3ba55d; box-shadow: 0 0 0 2px rgba(59, 165, 93, 0.2); }
.dot-danger  { background: #ed4245; box-shadow: 0 0 0 2px rgba(237, 66, 69, 0.2); }
.dot-neutral { background: var(--text-faint); }

.line {
    width: 1px;
    flex: 1;
    background: var(--border);
    margin-top: 4px;
    min-height: 12px;
}

/* ─── Feed body ─────────────────────────────────────────────────── */
.feed-body {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
}

.feed-title {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.3rem;
    font-size: 0.875rem;
    color: var(--text);
}

.action-verb {
    font-weight: 600;
    color: var(--text-strong);
}

.action-noun {
    color: var(--text-muted);
}

.target code {
    font-family: "JetBrains Mono", "Fira Code", monospace;
    font-size: 0.8rem;
    background: var(--bg-surface-2);
    padding: 0.1rem 0.35rem;
    border-radius: var(--radius-sm);
    color: var(--accent-text);
    word-break: break-all;
}

.feed-meta {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.75rem;
    color: var(--text-muted);
}

.actor {
    display: flex;
    align-items: center;
    gap: 0.25rem;
}

.actor-id {
    font-family: "JetBrains Mono", "Fira Code", monospace;
    font-size: 0.72rem;
    color: var(--text-faint);
}

.sep {
    color: var(--text-faint);
}

.rel-time {
    color: var(--text-faint);
}

.feed-ctx {
    margin-top: 0.1rem;
}

.feed-ctx code {
    font-family: "JetBrains Mono", "Fira Code", monospace;
    font-size: 0.72rem;
    color: var(--text-muted);
    background: var(--bg-surface-2);
    padding: 0.15rem 0.4rem;
    border-radius: var(--radius-sm);
    display: inline-block;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

/* ─── Skeleton ──────────────────────────────────────────────────── */
.feed-item--skel {
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

.skel-dot  { width: 8px; height: 8px; border-radius: 50%; margin-top: 0.35rem; }
.skel-line { width: 1px; flex: 1; min-height: 20px; }
.skel-title { width: 60%; height: 0.875rem; }
.skel-sub  { width: 40%; height: 0.7rem; margin-top: 0.1rem; }
</style>
