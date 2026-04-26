<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { listGuildBans, unbanGuildUser, type GuildBanEntry } from '../../../../api/guilds';
import { useApiError } from '../../../../composables/use-api-error';

const props = defineProps<{
    guildId: string;
}>();

const { handle: handleApiError } = useApiError();

const bans = ref<GuildBanEntry[]>([]);
const loading = ref(false);
const loadError = ref<string | null>(null);
const actionError = ref<string | null>(null);

async function load() {
    loading.value = true;
    loadError.value = null;
    try {
        bans.value = await listGuildBans(props.guildId);
    } catch (err) {
        if (handleApiError(err) !== 'unhandled') return;
        loadError.value = err instanceof Error ? err.message : 'Failed to load bans';
    } finally {
        loading.value = false;
    }
}

watch(() => props.guildId, load);
onMounted(load);

function displayName(b: GuildBanEntry): string {
    return b.globalName ?? b.username;
}

async function onUnban(b: GuildBanEntry) {
    if (!confirm(`Unban ${displayName(b)}?`)) return;
    actionError.value = null;
    try {
        await unbanGuildUser(props.guildId, b.userId);
        // Optimistic local removal so the row disappears immediately
        // without a refetch round-trip.
        bans.value = bans.value.filter(x => x.userId !== b.userId);
    } catch (err) {
        if (handleApiError(err) !== 'unhandled') return;
        actionError.value = err instanceof Error ? err.message : 'Unban failed';
    }
}
</script>

<template>
    <section class="card">
        <header class="card-head">
            <h3>{{ $t('guilds.bans.title') }} <span class="count-pill">{{ bans.length }}</span></h3>
        </header>

        <p v-if="loadError" class="error">{{ loadError }}</p>
        <p v-if="actionError" class="error">{{ actionError }}</p>

        <p v-if="loading && bans.length === 0" class="muted">{{ $t('common.loading') }}</p>
        <p v-else-if="bans.length === 0" class="muted">{{ $t('guilds.bans.empty') }}</p>

        <ul v-else class="bans">
            <li v-for="b in bans" :key="b.userId" class="row">
                <img :src="b.avatarUrl" alt="" class="avatar" />
                <div class="identity">
                    <div class="name">{{ displayName(b) }}</div>
                    <div class="muted small">@{{ b.username }}</div>
                    <div class="reason">
                        <span class="muted small">{{ $t('guilds.bans.reason') }}</span>
                        <span class="reason-text">{{ b.reason ?? $t('guilds.bans.noReason') }}</span>
                    </div>
                </div>
                <button type="button" class="ghost danger" @click="onUnban(b)">
                    {{ $t('guilds.bans.unban') }}
                </button>
            </li>
        </ul>
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
    gap: 0.5rem;
}
.card-head h3 {
    margin: 0;
    font-size: 0.95rem;
    color: var(--text-strong);
    display: flex;
    align-items: center;
    gap: 0.4rem;
}
.count-pill {
    background: var(--bg-surface-2);
    color: var(--text-muted);
    border-radius: 999px;
    padding: 0 0.5rem;
    font-size: 0.78rem;
    font-weight: 500;
}
.bans {
    list-style: none;
    margin: 0;
    padding: 0;
}
.row {
    display: grid;
    grid-template-columns: auto 1fr auto;
    gap: 0.7rem;
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
.identity { min-width: 0; display: flex; flex-direction: column; gap: 0.1rem; }
.name { font-size: 0.9rem; font-weight: 500; color: var(--text-strong); }
.reason { font-size: 0.82rem; display: flex; gap: 0.3rem; flex-wrap: wrap; }
.reason-text { color: var(--text); }
.ghost {
    background: none;
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 0.3rem 0.65rem;
    font: inherit;
    font-size: 0.82rem;
    color: var(--text);
    cursor: pointer;
}
.ghost.danger { color: var(--danger); border-color: rgba(239, 68, 68, 0.45); }
.ghost.danger:hover { background: rgba(239, 68, 68, 0.1); }
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
