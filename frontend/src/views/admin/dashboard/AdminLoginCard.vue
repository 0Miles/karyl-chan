<script setup lang="ts">
import type { AdminLoginEntry } from '../../../api/types';
import { useRelativeTime } from '../../../composables/use-relative-time';

defineProps<{
    admins: AdminLoginEntry[];
    loading: boolean;
    permissionDenied: boolean;
    error?: string | null;
}>();

const { relativeTime } = useRelativeTime();

/** Truncate long user IDs to show last 8 chars, prefixed with ellipsis */
function shortId(id: string): string {
    return id.length > 10 ? `…${id.slice(-8)}` : id;
}
</script>

<template>
    <section class="login-card" :aria-label="$t('dashboard.adminLogin.title')">
        <h2 class="section-title">{{ $t('dashboard.adminLogin.title') }}</h2>

        <!-- Error banner -->
        <div v-if="error" class="error-banner" role="alert">
            <span class="error-icon" aria-hidden="true">!</span>
            {{ error }}
        </div>

        <!-- No permission -->
        <p v-else-if="permissionDenied" class="no-perm">{{ $t('dashboard.noPermission') }}</p>

        <!-- Loading skeleton -->
        <div v-else-if="loading && !admins.length" class="admin-list">
            <div v-for="i in 3" :key="i" class="admin-row admin-row--skel">
                <div class="skel skel-dot"></div>
                <div class="admin-body">
                    <div class="skel skel-id"></div>
                    <div class="skel skel-meta"></div>
                </div>
            </div>
        </div>

        <!-- Empty state -->
        <p v-else-if="!admins.length" class="empty-state">
            {{ $t('dashboard.adminLogin.empty') }}
        </p>

        <!-- Admin list -->
        <ul v-else class="admin-list" role="list">
            <li
                v-for="admin in admins"
                :key="admin.userId"
                class="admin-row"
                role="listitem"
            >
                <!-- Session indicator dot -->
                <span
                    class="session-dot"
                    :class="admin.hasActiveSession ? 'dot-active' : 'dot-inactive'"
                    :aria-label="admin.hasActiveSession
                        ? $t('dashboard.adminLogin.sessionActive')
                        : $t('dashboard.adminLogin.sessionNone')"
                ></span>

                <div class="admin-body">
                    <!-- Top line: ID + badges -->
                    <div class="admin-top">
                        <code class="admin-id" :title="admin.userId">{{ shortId(admin.userId) }}</code>
                        <!-- Owner badge -->
                        <span v-if="admin.isOwner" class="badge badge-owner">
                            {{ $t('dashboard.adminLogin.owner') }}
                        </span>
                        <!-- Role badge -->
                        <span class="badge badge-role">{{ admin.role }}</span>
                    </div>

                    <!-- Bottom line: last login + note -->
                    <div class="admin-meta">
                        <span class="login-time">
                            {{ admin.lastLoginAt
                                ? relativeTime(admin.lastLoginAt)
                                : $t('dashboard.adminLogin.never') }}
                        </span>
                        <template v-if="admin.note">
                            <span class="meta-sep" aria-hidden="true">·</span>
                            <span class="admin-note" :title="admin.note">{{ admin.note }}</span>
                        </template>
                    </div>
                </div>
            </li>
        </ul>
    </section>
</template>

<style scoped>
.login-card {
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

/* ─── List ───────────────────────────────────────────────────────── */
.admin-list {
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

/* ─── Row ────────────────────────────────────────────────────────── */
.admin-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.65rem 1rem;
    border-bottom: 1px solid var(--border);
    transition: background var(--transition-fast) ease;
}

.admin-row:last-child {
    border-bottom: none;
}

.admin-row:hover {
    background: var(--bg-surface-hover);
}

/* ─── Session dot ────────────────────────────────────────────────── */
.session-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
    margin-top: 1px;
}

.dot-active  {
    background: #3ba55d;
    box-shadow: 0 0 0 2px rgba(59, 165, 93, 0.25);
}

.dot-inactive {
    background: var(--text-faint);
}

/* ─── Body ───────────────────────────────────────────────────────── */
.admin-body {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
}

.admin-top {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    flex-wrap: wrap;
}

.admin-id {
    font-family: "JetBrains Mono", "Fira Code", "Courier New", monospace;
    font-size: 0.8rem;
    color: var(--text-strong);
    background: var(--bg-surface-2);
    padding: 0.1rem 0.35rem;
    border-radius: var(--radius-sm);
}

/* ─── Badges ─────────────────────────────────────────────────────── */
.badge {
    display: inline-flex;
    align-items: center;
    padding: 0.1rem 0.45rem;
    border-radius: var(--radius-pill);
    font-size: 0.68rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    line-height: 1.4;
}

.badge-owner {
    background: var(--accent-bg);
    color: var(--accent-text);
    border: 1px solid var(--accent);
}

.badge-role {
    background: var(--bg-surface-2);
    color: var(--text-muted);
    border: 1px solid var(--border);
}

/* ─── Meta ───────────────────────────────────────────────────────── */
.admin-meta {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.72rem;
    color: var(--text-muted);
    min-width: 0;
}

.login-time {
    color: var(--text-faint);
    white-space: nowrap;
}

.meta-sep {
    color: var(--text-faint);
}

.admin-note {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-style: italic;
    color: var(--text-muted);
}

/* ─── Skeleton ───────────────────────────────────────────────────── */
.admin-row--skel {
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

.skel-dot  { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.skel-id   { width: 110px; height: 0.875rem; }
.skel-meta { width: 75px; height: 0.7rem; margin-top: 0.15rem; }
</style>
