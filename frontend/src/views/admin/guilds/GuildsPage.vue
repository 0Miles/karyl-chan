<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import {
    createGuildInvite,
    getGuildDetail,
    listGuildInvites,
    listGuilds,
    type GuildDetail,
    type GuildInvite,
    type GuildSummary
} from '../../../api/guilds';
import { SidebarLayout } from '../../../layouts';
import { useAppShell } from '../../../composables/use-app-shell';
import { useBreakpoint } from '../../../composables/use-breakpoint';
import { useApiError } from '../../../composables/use-api-error';
import AccessDeniedView from '../../../components/AccessDeniedView.vue';

const { closeOverlay } = useAppShell();
const { isMobile } = useBreakpoint();
const { accessDenied, reset: resetError, handle: handleApiError } = useApiError();

const guilds = ref<GuildSummary[]>([]);
const selectedId = ref<string | null>(null);
const detail = ref<GuildDetail | null>(null);
const loadingList = ref(false);
const loadingDetail = ref(false);
const error = ref<string | null>(null);

async function refresh() {
    loadingList.value = true;
    try {
        guilds.value = await listGuilds();
        if (!selectedId.value && guilds.value.length > 0) {
            selectedId.value = guilds.value[0].id;
        }
        error.value = null;
        resetError();
    } catch (err) {
        if (handleApiError(err) !== 'unhandled') return;
        error.value = err instanceof Error ? err.message : 'Failed to load guilds';
    } finally {
        loadingList.value = false;
    }
}

async function loadDetail(id: string) {
    loadingDetail.value = true;
    detail.value = null;
    try {
        detail.value = await getGuildDetail(id);
        error.value = null;
        void loadInvites(id);
    } catch (err) {
        if (handleApiError(err) !== 'unhandled') return;
        error.value = err instanceof Error ? err.message : 'Failed to load guild detail';
    } finally {
        loadingDetail.value = false;
    }
}

// Invites — list refreshes when the selected guild changes; create
// pushes one row at the top so users see their action without an
// extra round-trip.
const invites = ref<GuildInvite[]>([]);
const invitesError = ref<string | null>(null);
const creatingInvite = ref(false);
const createdInviteUrl = ref<string | null>(null);

async function loadInvites(guildId: string) {
    invites.value = [];
    invitesError.value = null;
    try {
        invites.value = await listGuildInvites(guildId);
    } catch (err) {
        if (handleApiError(err) !== 'unhandled') return;
        invitesError.value = err instanceof Error ? err.message : 'Failed to load invites';
    }
}

async function onCreateInvite() {
    if (!selectedId.value || creatingInvite.value) return;
    creatingInvite.value = true;
    createdInviteUrl.value = null;
    try {
        const result = await createGuildInvite(selectedId.value, { maxAge: 86400, maxUses: 0 });
        createdInviteUrl.value = result.url;
        await loadInvites(selectedId.value);
    } catch (err) {
        if (handleApiError(err) !== 'unhandled') return;
        invitesError.value = err instanceof Error ? err.message : 'Failed to create invite';
    } finally {
        creatingInvite.value = false;
    }
}

async function copyInvite(url: string) {
    try { await navigator.clipboard.writeText(url); } catch { /* ignore */ }
}

watch(selectedId, (id) => { if (id) loadDetail(id); });

function handleSelect(id: string) {
    selectedId.value = id;
    if (isMobile.value) closeOverlay();
}

onMounted(refresh);

function formatDate(iso: string | null): string {
    if (!iso) return '—';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString();
}

function customEmojiUrl(id: string, char: string): string {
    if (id) return `https://cdn.discordapp.com/emojis/${id}.webp?size=32&quality=lossless`;
    return char;
}
</script>

<template>
    <SidebarLayout>
        <template #sidebar>
            <header class="sidebar-header">
                <h2>{{ $t('guilds.title') }}</h2>
                <span class="count">{{ guilds.length }}</span>
            </header>
            <p v-if="loadingList && guilds.length === 0" class="muted">{{ $t('common.loading') }}</p>
            <p v-else-if="guilds.length === 0" class="muted empty">{{ $t('guilds.empty') }}</p>
            <ul class="guild-list">
                <li
                    v-for="g in guilds"
                    :key="g.id"
                    :class="{ active: g.id === selectedId }"
                    @click="handleSelect(g.id)"
                >
                    <img v-if="g.iconUrl" :src="g.iconUrl" alt="" class="icon" />
                    <div v-else class="icon icon-fallback">{{ g.name.charAt(0).toUpperCase() }}</div>
                    <div class="meta">
                        <div class="name">{{ g.name }}</div>
                        <div class="sub">{{ $t('guilds.members', { count: g.memberCount }) }}</div>
                    </div>
                </li>
            </ul>
        </template>

        <div class="detail">
            <AccessDeniedView v-if="accessDenied" />
            <template v-else>
            <p v-if="error" class="error">{{ error }}</p>
            <p v-if="!selectedId" class="muted center">{{ $t('guilds.selectGuild') }}</p>
            <p v-else-if="loadingDetail && !detail" class="muted center">{{ $t('common.loading') }}</p>
            <article v-else-if="detail" class="detail-body">
                <header class="detail-header">
                    <img v-if="detail.guild.iconUrl" :src="detail.guild.iconUrl" alt="" class="big-icon" />
                    <div v-else class="big-icon icon-fallback">{{ detail.guild.name.charAt(0).toUpperCase() }}</div>
                    <div>
                        <h2>{{ detail.guild.name }}</h2>
                        <p class="meta">
                            <span>{{ $t('guilds.members', { count: detail.guild.memberCount }) }}</span>
                            <span>· {{ $t('guilds.joined', { date: formatDate(detail.guild.joinedAt) }) }}</span>
                            <span>· {{ $t('guilds.idLabel') }} <code>{{ detail.guild.id }}</code></span>
                        </p>
                        <p v-if="detail.guild.description" class="description">{{ detail.guild.description }}</p>
                    </div>
                </header>

                <section class="card">
                    <h3>{{ $t('guilds.todoChannels') }} <span class="count-pill">{{ detail.todoChannels.length }}</span></h3>
                    <ul v-if="detail.todoChannels.length" class="bare">
                        <li v-for="c in detail.todoChannels" :key="c.channelId">
                            <span class="channel">#{{ c.channelName ?? c.channelId }}</span>
                        </li>
                    </ul>
                    <p v-else class="muted">{{ $t('common.none') }}</p>
                </section>

                <section class="card">
                    <h3>{{ $t('guilds.pictureOnly') }} <span class="count-pill">{{ detail.pictureOnlyChannels.length }}</span></h3>
                    <ul v-if="detail.pictureOnlyChannels.length" class="bare">
                        <li v-for="c in detail.pictureOnlyChannels" :key="c.channelId">
                            <span class="channel">#{{ c.channelName ?? c.channelId }}</span>
                        </li>
                    </ul>
                    <p v-else class="muted">{{ $t('common.none') }}</p>
                </section>

                <section class="card">
                    <h3>{{ $t('guilds.rconForward') }} <span class="count-pill">{{ detail.rconForwardChannels.length }}</span></h3>
                    <ul v-if="detail.rconForwardChannels.length" class="bare">
                        <li v-for="c in detail.rconForwardChannels" :key="c.channelId">
                            <span class="channel">#{{ c.channelName ?? c.channelId }}</span>
                            <span class="muted small"> {{ $t('guilds.rconTarget', { host: c.host ?? '—', port: c.port ?? '—', cmd: c.commandPrefix, trigger: c.triggerPrefix }) }}</span>
                        </li>
                    </ul>
                    <p v-else class="muted">{{ $t('common.none') }}</p>
                </section>

                <section class="card">
                    <h3>{{ $t('guilds.roleEmoji') }} <span class="count-pill">{{ detail.roleEmojis.length }}</span></h3>
                    <ul v-if="detail.roleEmojis.length" class="bare">
                        <li v-for="(r, idx) in detail.roleEmojis" :key="idx" class="row">
                            <img v-if="r.emojiId" :src="customEmojiUrl(r.emojiId, r.emojiChar)" :alt="r.emojiName" class="emoji" />
                            <span v-else class="emoji-fallback">{{ r.emojiChar }}</span>
                            <span> → @{{ r.roleName ?? r.roleId }}</span>
                        </li>
                    </ul>
                    <p v-else class="muted">{{ $t('common.none') }}</p>
                </section>

                <section class="card">
                    <h3>{{ $t('guilds.roleReactions') }} <span class="count-pill">{{ detail.roleReceiveMessages.length }}</span></h3>
                    <ul v-if="detail.roleReceiveMessages.length" class="bare">
                        <li v-for="(m, idx) in detail.roleReceiveMessages" :key="idx">
                            <span class="channel">#{{ m.channelName ?? m.channelId }}</span>
                            <span class="muted small"> {{ $t('guilds.roleReactionMessage', { id: m.messageId }) }}</span>
                        </li>
                    </ul>
                    <p v-else class="muted">{{ $t('common.none') }}</p>
                </section>

                <section class="card">
                    <h3>{{ $t('guilds.capabilityGrants') }} <span class="count-pill">{{ detail.capabilityGrants.length }}</span></h3>
                    <ul v-if="detail.capabilityGrants.length" class="bare">
                        <li v-for="(g, idx) in detail.capabilityGrants" :key="idx" class="row">
                            <span class="capability">{{ g.capability }}</span>
                            <span class="muted">·</span>
                            <span :style="g.roleColor ? { color: g.roleColor } : undefined">@{{ g.roleName ?? g.roleId }}</span>
                        </li>
                    </ul>
                    <p v-else class="muted">{{ $t('common.none') }}</p>
                </section>

                <section class="card">
                    <h3>
                        {{ $t('guilds.invites.title') }}
                        <span class="count-pill">{{ invites.length }}</span>
                        <button type="button" class="invite-create" :disabled="creatingInvite" @click="onCreateInvite">
                            {{ creatingInvite ? $t('common.loading') : $t('guilds.invites.create') }}
                        </button>
                    </h3>
                    <p v-if="createdInviteUrl" class="invite-fresh">
                        {{ $t('guilds.invites.created') }}
                        <code>{{ createdInviteUrl }}</code>
                        <button type="button" class="link" @click="copyInvite(createdInviteUrl)">{{ $t('messages.copyLink') }}</button>
                    </p>
                    <p v-if="invitesError" class="error">{{ invitesError }}</p>
                    <ul v-if="invites.length" class="bare invite-list">
                        <li v-for="inv in invites" :key="inv.code" class="invite-row">
                            <code class="invite-code">{{ inv.code }}</code>
                            <span class="muted invite-meta">
                                {{ inv.channelName ? `#${inv.channelName}` : '—' }}
                                · {{ $t('guilds.invites.uses', { uses: inv.uses, max: inv.maxUses || '∞' }) }}
                                <template v-if="inv.expiresAt">· {{ $t('guilds.invites.expires', { date: new Date(inv.expiresAt).toLocaleString() }) }}</template>
                            </span>
                            <button type="button" class="link" @click="copyInvite(inv.url)">{{ $t('messages.copyLink') }}</button>
                        </li>
                    </ul>
                    <p v-else-if="!invitesError" class="muted">{{ $t('common.none') }}</p>
                </section>
            </article>
            </template>
        </div>
    </SidebarLayout>
</template>

<style scoped>
.sidebar-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.75rem 1rem;
    border-bottom: 1px solid var(--border);
}
.sidebar-header h2 {
    margin: 0;
    font-size: 0.95rem;
}
.count {
    background: var(--bg-surface-2);
    color: var(--text-muted);
    border-radius: 999px;
    padding: 0 0.5rem;
    font-size: 0.8rem;
}
.invite-create {
    margin-left: auto;
    background: var(--accent);
    color: var(--text-on-accent);
    border: none;
    border-radius: 4px;
    padding: 0.25rem 0.7rem;
    cursor: pointer;
    font-size: 0.78rem;
}
.invite-create:disabled { opacity: 0.6; cursor: default; }
.invite-fresh {
    background: var(--accent-bg);
    color: var(--accent-text-strong);
    border-radius: 4px;
    padding: 0.4rem 0.6rem;
    font-size: 0.85rem;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
}
.invite-fresh code { background: transparent; padding: 0; }
.invite-list { display: flex; flex-direction: column; gap: 0.3rem; }
.invite-row {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    flex-wrap: wrap;
    font-size: 0.85rem;
}
.invite-code {
    font-family: ui-monospace, SFMono-Regular, monospace;
    font-weight: 600;
}
.invite-meta { font-size: 0.78rem; }
.link {
    background: none;
    border: none;
    color: var(--link-mask);
    cursor: pointer;
    font: inherit;
    padding: 0;
}
.guild-list {
    list-style: none;
    margin: 0;
    padding: 0;
}
.guild-list li {
    display: flex;
    gap: 0.6rem;
    padding: 0.5rem 0.75rem;
    cursor: pointer;
    border-bottom: 1px solid var(--border);
}
.guild-list li:hover {
    background: var(--bg-surface-hover);
}
.guild-list li.active {
    background: var(--bg-surface-active);
}
.icon {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    flex-shrink: 0;
    object-fit: cover;
}
.icon-fallback {
    background: var(--accent);
    color: var(--text-on-accent);
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 600;
}
.meta {
    display: flex;
    flex-direction: column;
    min-width: 0;
}
.name {
    font-weight: 500;
    color: var(--text-strong);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.sub {
    color: var(--text-muted);
    font-size: 0.8rem;
}
.detail {
    flex: 1;
    overflow-y: auto;
    padding: 1rem 1.25rem;
}
.center {
    text-align: center;
    margin: 2rem 0;
}
.error {
    color: var(--danger);
}
.detail-header {
    display: flex;
    gap: 1rem;
    margin-bottom: 1rem;
    align-items: flex-start;
}
.big-icon {
    width: 64px;
    height: 64px;
    border-radius: 12px;
    object-fit: cover;
    flex-shrink: 0;
}
.detail-header h2 {
    margin: 0;
}
.detail-header .meta {
    flex-direction: row;
    flex-wrap: wrap;
    gap: 0.4rem;
    color: var(--text-muted);
    font-size: 0.85rem;
    margin-top: 0.25rem;
}
.description {
    margin-top: 0.4rem;
    color: var(--text);
}
.card {
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 0.75rem 1rem;
    margin-bottom: 0.6rem;
}
.card h3 {
    margin: 0 0 0.4rem;
    font-size: 0.95rem;
    display: flex;
    align-items: center;
    gap: 0.5rem;
}
.count-pill {
    background: var(--bg-surface-2);
    color: var(--text-muted);
    border-radius: 999px;
    padding: 0 0.5rem;
    font-size: 0.75rem;
    font-weight: 500;
}
.bare {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
}
.row {
    display: flex;
    align-items: center;
    gap: 0.4rem;
}
.channel {
    color: var(--accent-text);
    font-weight: 500;
}
.muted {
    color: var(--text-muted);
}
.empty {
    padding: 1rem;
}
.small {
    font-size: 0.85em;
}
.emoji {
    width: 22px;
    height: 22px;
    object-fit: contain;
}
.emoji-fallback {
    font-size: 1.1rem;
}
.capability {
    font-family: ui-monospace, SFMono-Regular, monospace;
    background: var(--code-bg);
    padding: 0 0.4rem;
    border-radius: 3px;
    font-size: 0.85rem;
}
code {
    background: var(--code-bg);
    padding: 0 0.3rem;
    border-radius: 3px;
}
</style>
