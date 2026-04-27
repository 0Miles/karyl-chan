<script setup lang="ts">
import { computed } from 'vue';
import type { AdminAuditEntry } from '../../../api/types';
import { useRelativeTime } from '../../../composables/use-relative-time';
import { useUserSummaries } from '../../../composables/use-user-summaries';
import { useUserSummaryStore } from '../../../modules/discord-chat/stores/userSummaryStore';
import { useUserProfileStore } from '../../../modules/discord-chat/stores/userProfileStore';
import { useI18n } from 'vue-i18n';

const props = defineProps<{
    entries: AdminAuditEntry[];
    loading: boolean;
    permissionDenied: boolean;
    error?: string | null;
    /** True only on the very first load — controls whether skeleton shows. */
    isInitialLoad: boolean;
}>();

const { t } = useI18n();
const { relativeTime } = useRelativeTime();
const profileStore = useUserProfileStore();
// Read display names directly from the store so template reads
// participate in store-state reactivity.
const summaryStore = useUserSummaryStore();

/** Action prefixes whose `target` field is a Discord user id. */
const USER_TARGET_ACTIONS = ['user.', 'capability.'] as const;
function targetIsUser(action: string): boolean {
    return USER_TARGET_ACTIONS.some(p => action.startsWith(p));
}

/** Context keys whose value should be resolved as a Discord user id. */
const USER_CONTEXT_KEYS = new Set([
    'userId', 'targetUserId', 'actorUserId', 'authorId', 'ownerId', 'memberId',
]);

/** Collect every userId that needs resolution: actors + user targets + user-keyed context fields. */
const userIds = computed(() => {
    const seen = new Set<string>();
    const ids: string[] = [];
    const add = (id: string) => {
        if (!seen.has(id)) { seen.add(id); ids.push(id); }
    };
    for (const e of props.entries) {
        add(e.actorUserId);
        if (e.target && targetIsUser(e.action)) add(e.target);
        if (e.context) {
            for (const [k, v] of Object.entries(e.context)) {
                if (USER_CONTEXT_KEYS.has(k) && typeof v === 'string') add(v);
            }
        }
    }
    return ids;
});

useUserSummaries(userIds);

function actorDisplayName(userId: string): string {
    return summaryStore.getDisplayName(userId) ?? `…${userId.slice(-6)}`;
}

function targetDisplayName(userId: string): string {
    return summaryStore.getDisplayName(userId) ?? userId;
}

function onUserClick(userId: string, event: MouseEvent) {
    profileStore.openFor(userId, event.currentTarget as HTMLElement, null);
}

/** Render context as `key: value` pairs; user-keyed values become resolved usernames. */
interface ContextChip { key: string; value: string; userId: string | null }
function contextChips(ctx: Record<string, unknown> | null): ContextChip[] {
    if (!ctx) return [];
    const out: ContextChip[] = [];
    for (const [k, v] of Object.entries(ctx)) {
        if (v == null) continue;
        if (USER_CONTEXT_KEYS.has(k) && typeof v === 'string') {
            out.push({ key: k, value: targetDisplayName(v), userId: v });
        } else {
            const text = typeof v === 'string' ? v : JSON.stringify(v);
            out.push({ key: k, value: text, userId: null });
        }
    }
    return out;
}

/** Precomputed map of action token → [verb, noun] — recomputes only on locale change */
const actionLabelMap = computed<Record<string, [string, string]>>(() => ({
    'user.upsert':              [t('dashboard.activity.action.user.upsert.verb'),   t('dashboard.activity.action.user.upsert.noun')],
    'user.delete':              [t('dashboard.activity.action.user.delete.verb'),   t('dashboard.activity.action.user.delete.noun')],
    'role.grant':               [t('dashboard.activity.action.role.grant.verb'),    t('dashboard.activity.action.role.grant.noun')],
    'role.revoke':              [t('dashboard.activity.action.role.revoke.verb'),   t('dashboard.activity.action.role.revoke.noun')],
    'role.upsert':              [t('dashboard.activity.action.role.upsert.verb'),   t('dashboard.activity.action.role.upsert.noun')],
    'role.delete':              [t('dashboard.activity.action.role.delete.verb'),   t('dashboard.activity.action.role.delete.noun')],
    'capability.grant':         [t('dashboard.activity.action.capability.grant.verb'),   t('dashboard.activity.action.capability.grant.noun')],
    'capability.revoke':        [t('dashboard.activity.action.capability.revoke.verb'),  t('dashboard.activity.action.capability.revoke.noun')],
    'feature.todo.upsert':      [t('dashboard.activity.action.feature.todo.upsert.verb'),   t('dashboard.activity.action.feature.todo.upsert.noun')],
    'feature.todo.delete':      [t('dashboard.activity.action.feature.todo.delete.verb'),   t('dashboard.activity.action.feature.todo.delete.noun')],
    'feature.picture.upsert':   [t('dashboard.activity.action.feature.picture.upsert.verb'), t('dashboard.activity.action.feature.picture.upsert.noun')],
    'feature.picture.delete':   [t('dashboard.activity.action.feature.picture.delete.verb'), t('dashboard.activity.action.feature.picture.delete.noun')],
    'feature.rcon.upsert':      [t('dashboard.activity.action.feature.rcon.upsert.verb'),   t('dashboard.activity.action.feature.rcon.upsert.noun')],
    'feature.rcon.delete':      [t('dashboard.activity.action.feature.rcon.delete.verb'),   t('dashboard.activity.action.feature.rcon.delete.noun')],
    'feature.roleemoji.upsert': [t('dashboard.activity.action.feature.roleemoji.upsert.verb'), t('dashboard.activity.action.feature.roleemoji.upsert.noun')],
    'feature.roleemoji.delete': [t('dashboard.activity.action.feature.roleemoji.delete.verb'), t('dashboard.activity.action.feature.roleemoji.delete.noun')],
}));

/** Map action token to a human-readable label */
function actionLabel(action: string): { verb: string; noun: string } {
    const entry = actionLabelMap.value[action];
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

/** Onclick handler reused by template for any user-resolved chip. */
function onUserChipClick(userId: string, event: MouseEvent) {
    onUserClick(userId, event);
}

/** Colour-coded dot per action verb */
function dotClass(action: string): string {
    if (action.includes('delete') || action.includes('revoke')) return 'dot-danger';
    if (action.includes('grant') || action.includes('upsert') || action.includes('create')) return 'dot-success';
    return 'dot-neutral';
}
</script>

<template>
    <section class="activity" :aria-label="$t('dashboard.activity.title')">
        <h2 class="section-title">{{ $t('dashboard.activity.title') }}</h2>

        <!-- Error banner -->
        <div v-if="error" class="error-banner" role="alert">
            <span class="error-icon" aria-hidden="true">!</span>
            {{ error }}
        </div>

        <p v-else-if="permissionDenied" class="no-perm">{{ $t('dashboard.noPermission') }}</p>

        <!-- Loading skeleton — only on initial load, not on refresh -->
        <div v-else-if="isInitialLoad && loading && !entries.length" class="feed">
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
                        <button
                            v-if="entry.target && targetIsUser(entry.action)"
                            type="button"
                            class="target target-user"
                            :title="entry.target"
                            @click="onUserClick(entry.target, $event)"
                        >
                            <code>{{ targetDisplayName(entry.target) }}</code>
                        </button>
                        <span v-else-if="entry.target" class="target">
                            <code>{{ entry.target }}</code>
                        </span>
                    </div>
                    <div class="feed-meta">
                        <button
                            type="button"
                            class="actor"
                            :title="entry.actorUserId"
                            @click="onUserClick(entry.actorUserId, $event)"
                        >
                            {{ $t('dashboard.activity.by') }}
                            <code class="actor-name">{{ actorDisplayName(entry.actorUserId) }}</code>
                        </button>
                        <span class="sep">·</span>
                        <time :datetime="entry.createdAt" class="rel-time">{{ relativeTime(entry.createdAt) }}</time>
                    </div>
                    <div v-if="contextChips(entry.context).length" class="feed-ctx">
                        <span
                            v-for="chip in contextChips(entry.context)"
                            :key="chip.key"
                            class="ctx-chip"
                        >
                            <span class="ctx-key">{{ chip.key }}:</span>
                            <button
                                v-if="chip.userId"
                                type="button"
                                class="ctx-user"
                                :title="chip.userId"
                                @click="onUserChipClick(chip.userId, $event)"
                            >
                                {{ chip.value }}
                            </button>
                            <code v-else class="ctx-val">{{ chip.value }}</code>
                        </span>
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

/* ─── Error banner ───────────────────────────────────────────────── */
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

/* Actor: button-reset + click styles */
.actor {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    font-size: inherit;
    color: inherit;
    font-family: inherit;
    line-height: inherit;
    transition: color var(--transition-fast) ease;
}

.actor:hover {
    color: var(--text-strong);
}

.actor:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
    border-radius: 2px;
}

.actor-name {
    font-family: "JetBrains Mono", "Fira Code", monospace;
    font-size: 0.72rem;
    color: var(--text-faint);
}

.actor:hover .actor-name {
    color: var(--accent-text);
}

.sep {
    color: var(--text-faint);
}

.rel-time {
    color: var(--text-faint);
}

.feed-ctx {
    margin-top: 0.15rem;
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
}

.ctx-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.72rem;
    line-height: 1.2;
}

.ctx-key {
    color: var(--text-faint);
    font-family: "JetBrains Mono", "Fira Code", monospace;
}

.ctx-val {
    font-family: "JetBrains Mono", "Fira Code", monospace;
    color: var(--text-muted);
    background: var(--bg-surface-2);
    padding: 0.1rem 0.35rem;
    border-radius: var(--radius-sm);
    max-width: 18rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

/* Target / context chips that resolve to a Discord user — clickable. */
.target.target-user,
.ctx-user {
    background: none;
    border: none;
    padding: 0;
    margin: 0;
    cursor: pointer;
    font: inherit;
    color: inherit;
    transition: color var(--transition-fast) ease;
}

.target.target-user code,
.ctx-user {
    background: var(--bg-surface-2);
    padding: 0.1rem 0.4rem;
    border-radius: var(--radius-sm);
    color: var(--accent-text);
    font-size: 0.78rem;
    font-family: "JetBrains Mono", "Fira Code", monospace;
}

.ctx-user {
    font-size: 0.72rem;
}

.target.target-user:hover code,
.ctx-user:hover {
    color: var(--text-strong);
    background: var(--bg-surface-3, var(--bg-surface));
}

.target.target-user:focus-visible,
.ctx-user:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
    border-radius: var(--radius-sm);
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
