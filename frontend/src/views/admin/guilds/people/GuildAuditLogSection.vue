<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import {
    listGuildAuditLogs,
    type AuditLogEntry
} from '../../../../api/guilds';
import { useApiError } from '../../../../composables/use-api-error';
import AppSelectField, { type SelectOption } from '../../../../components/AppSelectField.vue';
import { useI18n } from 'vue-i18n';

const props = defineProps<{
    guildId: string;
}>();

const { handle: handleApiError } = useApiError();
const { t } = useI18n();

const entries = ref<AuditLogEntry[]>([]);
const loading = ref(false);
const loadingMore = ref(false);
const hasMore = ref(true);
const error = ref<string | null>(null);

// Filters. `actionFilter` keeps the raw discord.js AuditLogEvent number; an
// empty string means "no filter". The user ID input is sanity-checked
// before being passed to the backend so we don't issue obviously bad
// queries that 4xx.
const actionFilter = ref<string>('');
const userFilter = ref<string>('');
const expanded = ref<Record<string, boolean>>({});

// Curated list of the handful of action types that actually matter for
// day-to-day moderation review. The backend accepts any number, so users
// can extend this manually via the URL if they need a niche action.
const ACTION_TYPES: Array<{ value: number; label: string }> = [
    { value: 20, label: 'MemberKick' },
    { value: 22, label: 'MemberBanAdd' },
    { value: 23, label: 'MemberBanRemove' },
    { value: 24, label: 'MemberUpdate' },
    { value: 25, label: 'MemberRoleUpdate' },
    { value: 72, label: 'MessageDelete' },
    { value: 73, label: 'MessageBulkDelete' },
    { value: 74, label: 'MessagePin' },
    { value: 75, label: 'MessageUnpin' },
    { value: 10, label: 'ChannelCreate' },
    { value: 11, label: 'ChannelUpdate' },
    { value: 12, label: 'ChannelDelete' },
    { value: 30, label: 'RoleCreate' },
    { value: 31, label: 'RoleUpdate' },
    { value: 32, label: 'RoleDelete' },
    { value: 50, label: 'WebhookCreate' },
    { value: 60, label: 'EmojiCreate' },
    { value: 61, label: 'EmojiUpdate' },
    { value: 62, label: 'EmojiDelete' }
];

const actionOptions = computed<SelectOption<string>[]>(() => [
    { value: '', label: t('guilds.audit.actionAll') },
    ...ACTION_TYPES.map(o => ({ value: String(o.value), label: o.label }))
]);

async function load(reset: boolean) {
    if (reset) {
        loading.value = true;
        entries.value = [];
        hasMore.value = true;
    } else {
        if (loadingMore.value || !hasMore.value) return;
        loadingMore.value = true;
    }
    error.value = null;
    try {
        const opts: Parameters<typeof listGuildAuditLogs>[1] = { limit: 50 };
        if (!reset && entries.value.length > 0) {
            opts.before = entries.value[entries.value.length - 1].id;
        }
        if (actionFilter.value !== '') opts.type = Number(actionFilter.value);
        if (userFilter.value && /^[0-9]{17,20}$/.test(userFilter.value)) opts.user = userFilter.value;
        const next = await listGuildAuditLogs(props.guildId, opts);
        if (next.length === 0) hasMore.value = false;
        if (next.length < 50) hasMore.value = false;
        entries.value = reset ? next : [...entries.value, ...next];
    } catch (err) {
        if (handleApiError(err) !== 'unhandled') return;
        error.value = err instanceof Error ? err.message : 'Failed to load audit log';
    } finally {
        loading.value = false;
        loadingMore.value = false;
    }
}

watch(() => props.guildId, () => {
    actionFilter.value = '';
    userFilter.value = '';
    expanded.value = {};
    load(true);
});
onMounted(() => load(true));

function applyFilters() {
    expanded.value = {};
    load(true);
}
function resetFilters() {
    actionFilter.value = '';
    userFilter.value = '';
    expanded.value = {};
    load(true);
}
function fmtDate(iso: string): string {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}
function toggle(id: string) {
    expanded.value = { ...expanded.value, [id]: !expanded.value[id] };
}
function fmtValue(v: unknown): string {
    if (v === null || v === undefined) return '∅';
    if (typeof v === 'string') return v.length > 80 ? v.slice(0, 80) + '…' : v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    try {
        const json = JSON.stringify(v);
        return json.length > 120 ? json.slice(0, 120) + '…' : json;
    } catch {
        return String(v);
    }
}
</script>

<template>
    <section class="card">
        <header class="card-head">
            <h3>{{ $t('guilds.audit.title') }}</h3>
        </header>

        <div class="filters">
            <label class="field">
                <span>{{ $t('guilds.audit.filterAction') }}</span>
                <AppSelectField
                    v-model="actionFilter"
                    :options="actionOptions"
                    :drawer-title="$t('guilds.audit.filterAction')"
                />
            </label>
            <label class="field">
                <span>{{ $t('guilds.audit.filterUser') }}</span>
                <input v-model="userFilter" type="text" inputmode="numeric" pattern="[0-9]*" />
            </label>
            <div class="filter-actions">
                <button type="button" class="ghost" @click="resetFilters">{{ $t('guilds.audit.filterReset') }}</button>
                <button type="button" class="primary" @click="applyFilters">{{ $t('guilds.audit.filterApply') }}</button>
            </div>
        </div>

        <p v-if="error" class="error">{{ $t('guilds.audit.actionLoadFailed') }}: {{ error }}</p>
        <p v-if="loading && entries.length === 0" class="muted">{{ $t('common.loading') }}</p>
        <p v-else-if="entries.length === 0" class="muted">{{ $t('guilds.audit.empty') }}</p>

        <ul v-else class="entries">
            <li v-for="e in entries" :key="e.id" class="entry" :class="{ expanded: expanded[e.id] }">
                <header class="entry-head" @click="toggle(e.id)">
                    <div class="left">
                        <img v-if="e.executor" :src="e.executor.avatarUrl" alt="" class="avatar" />
                        <div v-else class="avatar avatar-empty"></div>
                        <div class="entry-meta">
                            <div class="action-line">
                                <span class="action-name">{{ e.actionTypeName }}</span>
                                <span class="muted small">
                                    {{ $t('guilds.audit.by', { name: e.executor ? (e.executor.globalName ?? e.executor.username) : $t('guilds.audit.noExecutor') }) }}
                                </span>
                            </div>
                            <div class="muted small details">
                                <span>{{ fmtDate(e.createdAt) }}</span>
                                <span v-if="e.targetId">· target <code>{{ e.targetId }}</code></span>
                                <span v-if="e.changes.length"> · {{ $t('guilds.audit.changes', { count: e.changes.length }) }}</span>
                            </div>
                            <div v-if="e.reason" class="reason">
                                <span class="muted small">{{ $t('guilds.audit.reason') }}</span>
                                {{ e.reason }}
                            </div>
                        </div>
                    </div>
                    <span v-if="e.changes.length" class="chevron" :class="{ open: expanded[e.id] }">›</span>
                </header>

                <ul v-if="expanded[e.id] && e.changes.length" class="changes">
                    <li v-for="(c, idx) in e.changes" :key="idx" class="change">
                        <span class="key">{{ c.key }}</span>
                        <code class="old">{{ fmtValue(c.oldValue) }}</code>
                        <span class="arrow">→</span>
                        <code class="new">{{ fmtValue(c.newValue) }}</code>
                    </li>
                </ul>
            </li>
        </ul>

        <button
            v-if="hasMore && entries.length > 0"
            type="button"
            class="ghost load-more"
            :disabled="loadingMore"
            @click="load(false)"
        >{{ $t('guilds.audit.loadMore') }}</button>
    </section>
</template>

<style scoped>
.card {
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 0.75rem 0.95rem;
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
}
.card-head h3 { margin: 0; font-size: 0.95rem; color: var(--text-strong); }
.filters {
    display: grid;
    grid-template-columns: 1fr 1fr auto;
    gap: 0.5rem;
    align-items: end;
}
@media (max-width: 640px) {
    .filters { grid-template-columns: 1fr; }
}
.field { display: flex; flex-direction: column; gap: 0.2rem; font-size: 0.82rem; }
.field span { color: var(--text-muted); }
.field input,
.field select {
    padding: 0.35rem 0.55rem;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg-surface);
    color: var(--text);
    font: inherit;
    font-size: 0.85rem;
}
.filter-actions { display: flex; gap: 0.4rem; }
.entries { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.entry { border-bottom: 1px solid var(--border); padding: 0.55rem 0; }
.entry:last-child { border-bottom: none; }
.entry-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.5rem;
    cursor: pointer;
}
.left { display: flex; gap: 0.6rem; min-width: 0; flex: 1; }
.avatar {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    object-fit: cover;
    flex-shrink: 0;
}
.avatar-empty { background: var(--bg-surface-2); }
.entry-meta { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 0.15rem; }
.action-line { display: flex; gap: 0.4rem; align-items: center; flex-wrap: wrap; }
.action-name {
    font-weight: 600;
    color: var(--text-strong);
    font-size: 0.88rem;
}
.details { display: flex; gap: 0.3rem; flex-wrap: wrap; }
.details code {
    font-size: 0.75rem;
    background: var(--bg-surface-2);
    padding: 0 0.3rem;
    border-radius: 3px;
}
.reason {
    font-size: 0.82rem;
    color: var(--text);
    margin-top: 0.15rem;
}
.chevron {
    flex-shrink: 0;
    font-size: 1rem;
    color: var(--text-muted);
    transform: rotate(90deg);
    transition: transform 0.15s;
}
.chevron.open { transform: rotate(270deg); }
.changes {
    list-style: none;
    margin: 0.4rem 0 0;
    padding: 0.4rem 0.55rem;
    background: var(--bg-surface);
    border-radius: 4px;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    border: 1px solid var(--border);
}
.change {
    display: grid;
    grid-template-columns: minmax(80px, 0.4fr) 1fr auto 1fr;
    gap: 0.4rem;
    align-items: center;
    font-size: 0.78rem;
}
.key { color: var(--text-muted); font-family: ui-monospace, SFMono-Regular, monospace; }
.old, .new {
    background: var(--bg-surface-2);
    padding: 0 0.3rem;
    border-radius: 3px;
    font-family: ui-monospace, SFMono-Regular, monospace;
    overflow-wrap: anywhere;
}
.arrow { color: var(--text-muted); }
.load-more {
    margin-top: 0.5rem;
    align-self: center;
}
.ghost {
    background: none;
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 0.35rem 0.85rem;
    font: inherit;
    font-size: 0.85rem;
    color: var(--text);
    cursor: pointer;
}
.ghost:hover:not(:disabled) { background: var(--bg-surface-hover); }
.ghost:disabled { opacity: 0.5; cursor: default; }
.primary {
    background: var(--accent);
    color: var(--text-on-accent);
    border: 1px solid var(--accent);
    border-radius: 4px;
    padding: 0.35rem 0.85rem;
    font: inherit;
    font-size: 0.85rem;
    cursor: pointer;
}
.muted { color: var(--text-muted); }
.small { font-size: 0.78rem; }
.error {
    color: var(--danger);
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.35);
    border-radius: 4px;
    padding: 0.4rem 0.55rem;
    font-size: 0.82rem;
    margin: 0;
}
</style>
