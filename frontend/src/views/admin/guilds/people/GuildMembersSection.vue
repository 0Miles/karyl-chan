<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import {
    banGuildMember,
    kickGuildMember,
    listGuildMembers,
    setGuildMemberNickname,
    timeoutGuildMember,
    type GuildMemberRow
} from '../../../../api/guilds';
import { useApiError } from '../../../../composables/use-api-error';

const props = defineProps<{
    guildId: string;
}>();

const { handle: handleApiError } = useApiError();

const members = ref<GuildMemberRow[]>([]);
const loading = ref(false);
const loadError = ref<string | null>(null);
const search = ref('');
const actionError = ref<string | null>(null);

let searchSeq = 0;

async function load() {
    loading.value = true;
    loadError.value = null;
    const seq = ++searchSeq;
    try {
        const opts: { limit: number; query?: string } = { limit: 200 };
        if (search.value.trim()) opts.query = search.value.trim();
        const rows = await listGuildMembers(props.guildId, opts);
        // Drop the result if a newer search has started — otherwise an
        // older slow request would clobber the latest one.
        if (seq !== searchSeq) return;
        members.value = rows;
    } catch (err) {
        if (seq !== searchSeq) return;
        if (handleApiError(err) !== 'unhandled') return;
        loadError.value = err instanceof Error ? err.message : 'Failed to load members';
    } finally {
        if (seq === searchSeq) loading.value = false;
    }
}

watch(() => props.guildId, () => { search.value = ''; load(); });
onMounted(load);

let searchDebounce: number | null = null;
watch(search, () => {
    if (searchDebounce !== null) window.clearTimeout(searchDebounce);
    searchDebounce = window.setTimeout(() => { load(); }, 250);
});

function displayName(m: GuildMemberRow): string {
    return m.nickname ?? m.globalName ?? m.username;
}
function joinedDate(iso: string | null): string {
    if (!iso) return '—';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString();
}

const filtered = computed(() => members.value);

async function actionWrap(label: string, fn: () => Promise<void>) {
    actionError.value = null;
    try {
        await fn();
        await load();
    } catch (err) {
        if (handleApiError(err) !== 'unhandled') return;
        actionError.value = `${label}: ${err instanceof Error ? err.message : 'failed'}`;
    }
}

function onKick(m: GuildMemberRow) {
    const reason = window.prompt(`Kick ${displayName(m)}?`, '');
    if (reason === null) return;
    actionWrap('kick', () => kickGuildMember(props.guildId, m.id, reason || undefined));
}
function onBan(m: GuildMemberRow) {
    const reason = window.prompt(`Ban ${displayName(m)}?`, '');
    if (reason === null) return;
    actionWrap('ban', () => banGuildMember(props.guildId, m.id, { reason: reason || undefined }));
}
function onTimeout(m: GuildMemberRow) {
    const raw = window.prompt('Timeout duration in minutes (1..40320 = 28 days):', '60');
    if (raw === null) return;
    const minutes = Number(raw);
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > 40320) {
        actionError.value = 'invalid duration';
        return;
    }
    const until = new Date(Date.now() + minutes * 60_000).toISOString();
    actionWrap('timeout', () => timeoutGuildMember(props.guildId, m.id, until));
}
function onClearTimeout(m: GuildMemberRow) {
    actionWrap('clear-timeout', () => timeoutGuildMember(props.guildId, m.id, null));
}
function onNickname(m: GuildMemberRow) {
    const next = window.prompt(`Nickname for ${displayName(m)}`, m.nickname ?? '');
    if (next === null) return;
    actionWrap('nickname', () => setGuildMemberNickname(props.guildId, m.id, next.trim() || null));
}
</script>

<template>
    <section class="card">
        <header class="card-head">
            <h3>{{ $t('guilds.members.title') }} <span class="count-pill">{{ filtered.length }}</span></h3>
            <input
                v-model="search"
                type="search"
                class="search"
                :placeholder="$t('guilds.members.search')"
            />
        </header>

        <p v-if="loadError" class="error">{{ loadError }}</p>
        <p v-if="actionError" class="error">{{ $t('guilds.members.actionFailed', { message: actionError }) }}</p>

        <p v-if="loading && filtered.length === 0" class="muted">{{ $t('common.loading') }}</p>
        <p v-else-if="filtered.length === 0" class="muted">{{ $t('guilds.members.empty') }}</p>

        <ul v-else class="members">
            <li v-for="m in filtered" :key="m.id" class="row">
                <img :src="m.avatarUrl" alt="" class="avatar" />
                <div class="identity">
                    <div class="name-line">
                        <span :style="m.color ? { color: m.color } : undefined">{{ displayName(m) }}</span>
                        <span v-if="m.bot" class="badge">{{ $t('guilds.members.botBadge') }}</span>
                        <span v-if="m.pending" class="badge pending">{{ $t('guilds.members.pending') }}</span>
                    </div>
                    <div class="meta">
                        <span class="muted small">@{{ m.username }}</span>
                        <span class="muted small">· {{ $t('guilds.members.joined', { date: joinedDate(m.joinedAt) }) }}</span>
                        <span class="muted small">· {{ $t('guilds.members.rolesCount', { count: m.roles.length }) }}</span>
                        <span v-if="m.timeoutUntil" class="muted small timeout">
                            · {{ $t('guilds.members.timeoutActive', { date: new Date(m.timeoutUntil).toLocaleString() }) }}
                        </span>
                    </div>
                </div>
                <div class="actions">
                    <button type="button" class="ghost" @click="onNickname(m)">{{ $t('guilds.members.actionNickname') }}</button>
                    <button v-if="m.timeoutUntil" type="button" class="ghost" @click="onClearTimeout(m)">
                        {{ $t('guilds.members.actionClearTimeout') }}
                    </button>
                    <button v-else type="button" class="ghost" @click="onTimeout(m)">
                        {{ $t('guilds.members.actionTimeout') }}
                    </button>
                    <button type="button" class="ghost danger" @click="onKick(m)">{{ $t('guilds.members.actionKick') }}</button>
                    <button type="button" class="ghost danger" @click="onBan(m)">{{ $t('guilds.members.actionBan') }}</button>
                </div>
            </li>
        </ul>
    </section>
</template>

<style scoped>
.card {
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: 0.75rem 0.95rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
}
.card-head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
}
.card-head h3 {
    margin: 0;
    font-size: 0.95rem;
    color: var(--text-strong);
    display: flex;
    gap: 0.4rem;
    align-items: center;
}
.count-pill {
    background: var(--bg-surface-2);
    color: var(--text-muted);
    border-radius: var(--radius-pill);
    padding: 0 0.5rem;
    font-size: 0.78rem;
    font-weight: 500;
}
.search {
    flex: 1;
    min-width: 160px;
    padding: 0.35rem 0.55rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg-surface);
    color: var(--text);
    font: inherit;
    font-size: 0.85rem;
}
.members {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
}
.row {
    display: grid;
    grid-template-columns: auto 1fr auto;
    gap: 0.6rem;
    padding: 0.5rem 0;
    align-items: center;
    border-bottom: 1px solid var(--border);
}
.row:last-child { border-bottom: none; }
.avatar {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    object-fit: cover;
}
.identity { min-width: 0; display: flex; flex-direction: column; gap: 0.15rem; }
.name-line {
    display: flex;
    gap: 0.4rem;
    align-items: center;
    font-size: 0.9rem;
    font-weight: 500;
    color: var(--text-strong);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.meta {
    display: flex;
    flex-wrap: wrap;
    gap: 0.2rem;
}
.badge {
    background: var(--bg-surface-2);
    color: var(--text-muted);
    border-radius: 3px;
    padding: 0 0.3rem;
    font-size: 0.7rem;
    font-weight: 600;
}
.badge.pending { color: var(--accent); background: var(--accent-bg); }
.actions {
    display: flex;
    gap: 0.3rem;
    flex-wrap: wrap;
    justify-content: flex-end;
}
.ghost {
    background: none;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 0.25rem 0.55rem;
    font: inherit;
    font-size: 0.78rem;
    color: var(--text);
    cursor: pointer;
}
.ghost:hover { background: var(--bg-surface-hover); }
.ghost.danger { color: var(--danger); border-color: rgba(239, 68, 68, 0.45); }
.ghost.danger:hover { background: rgba(239, 68, 68, 0.1); }
.muted { color: var(--text-muted); }
.small { font-size: 0.78rem; }
.timeout { color: var(--danger); }
.error {
    color: var(--danger);
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.35);
    border-radius: var(--radius-sm);
    padding: 0.4rem 0.55rem;
    font-size: 0.82rem;
    margin: 0;
}
@media (max-width: 640px) {
    .row {
        grid-template-columns: auto 1fr;
        grid-template-areas:
            "avatar identity"
            "actions actions";
        row-gap: 0.4rem;
    }
    .avatar { grid-area: avatar; }
    .identity { grid-area: identity; }
    .actions { grid-area: actions; justify-content: flex-start; }
}
</style>
