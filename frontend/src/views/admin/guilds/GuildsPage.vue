<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { Icon } from '@iconify/vue';
import {
    createGuildInvite,
    deleteGuildInvite,
    deleteGuildRole,
    getGuildDetail,
    listGuildInvites,
    listGuildRoles,
    listGuilds,
    type GuildDetail,
    type GuildInvite,
    type GuildRoleSummary,
    type GuildSummary
} from '../../../api/guilds';
import { SidebarLayout } from '../../../layouts';
import { useAppShell } from '../../../composables/use-app-shell';
import { useBreakpoint } from '../../../composables/use-breakpoint';
import { useApiError } from '../../../composables/use-api-error';
import { useI18n } from 'vue-i18n';
import AccessDeniedView from '../../../components/AccessDeniedView.vue';
import AppTabs from '../../../components/AppTabs.vue';
import AllServersDashboard from './AllServersDashboard.vue';
import GuildBotFeaturesPanel from './GuildBotFeaturesPanel.vue';
import GuildOverviewSection from './overview/GuildOverviewSection.vue';
import GuildGeneralSettingsCard from './settings/GuildGeneralSettingsCard.vue';
import GuildModerationSettingsCard from './settings/GuildModerationSettingsCard.vue';
import GuildSystemSettingsCard from './settings/GuildSystemSettingsCard.vue';
import GuildRolesSection from './settings/GuildRolesSection.vue';
import GuildInvitesSection from './settings/GuildInvitesSection.vue';
import GuildEmojiStickerPanel from './settings/GuildEmojiStickerPanel.vue';
import GuildRoleEditModal from './settings/GuildRoleEditModal.vue';
import GuildInviteCreateModal from './settings/GuildInviteCreateModal.vue';
import GuildMembersSection from './people/GuildMembersSection.vue';
import GuildBansSection from './people/GuildBansSection.vue';
import GuildAutoModSection from './people/GuildAutoModSection.vue';
import GuildAuditLogSection from './people/GuildAuditLogSection.vue';
import { guildFeatures } from '../../../modules/guild-features/registry';
import { useGuildsRoute } from './use-guilds-route';
import { useCurrentUserStore } from '../../../stores/currentUserStore';
import { hasGuildCapability } from '../../../libs/admin-capabilities';

const { t: $t } = useI18n();

const { closeOverlay } = useAppShell();
const { isMobile } = useBreakpoint();
const { accessDenied, reset: resetError, handle: handleApiError } = useApiError();

const guilds = ref<GuildSummary[]>([]);
const detail = ref<GuildDetail | null>(null);
const loadingList = ref(false);
const loadingDetail = ref(false);
const error = ref<string | null>(null);

// Sentinel guild id for the "all servers" cross-guild dashboard.
// Picking a non-snowflake string means it can never collide with a real
// Discord guild id (which are numeric strings). Selected via the same
// useGuildsRoute mechanism, so deep-linking with ?guild=_all works.
const ALL_SERVERS_ID = '_all';

// `selectedId` is two-way bound to `?guild=<id>` by useGuildsRoute. The
// tab + sub-tab portion of the URL lives on `<AppTabs routed>` itself
// (passed `name="guilds"` below), so the page-level state is just a
// pair of refs that AppTabs writes through via v-model. Per-tab sub
// memory still happens here — switching primary tabs back and forth
// preserves the last sub the user was on.
type Tab = 'overview' | 'settings' | 'people' | 'features';
const { selectedId } = useGuildsRoute();
const isAllServers = computed(() => selectedId.value === ALL_SERVERS_ID);
const activeTab = ref<Tab>('overview');
// Default features sub = first feature's name; updates if registry changes.
const activeSub = ref<Record<Tab, string>>({
    overview: '',
    settings: 'general',
    people: 'members',
    // Default to the master "Bot 功能" sub so the user lands on the
    // overview switch list rather than dropping into a single feature's
    // settings card.
    features: '_bot'
});

// Per-guild capability gating: settings/people/features all live behind
// `manage` for the selected guild. Hide them when the user only has
// `message` access — overview stays visible since both scopes need it.
const currentUser = useCurrentUserStore();
const canManageSelectedGuild = computed(() => {
    if (!selectedId.value) return false;
    const caps = currentUser.user?.capabilities ?? [];
    return hasGuildCapability(caps, selectedId.value, 'manage');
});

const primaryTabs = computed(() => {
    const tabs = [
        { key: 'overview', label: $t('guilds.tabs.overview'), icon: 'material-symbols:dashboard-outline-rounded' }
    ];
    if (canManageSelectedGuild.value) {
        tabs.push(
            { key: 'settings', label: $t('guilds.tabs.settings'), icon: 'material-symbols:tune-rounded' },
            { key: 'people', label: $t('guilds.tabs.people'), icon: 'material-symbols:groups-outline-rounded' },
            { key: 'features', label: $t('guilds.tabs.features'), icon: 'material-symbols:extension-outline-rounded' }
        );
    }
    return tabs;
});

// If the user lands on a non-overview tab for a guild they can't
// manage (e.g. via deep-link), bounce them back to overview so the
// page state matches what AppTabs is willing to render.
watch([selectedId, canManageSelectedGuild], () => {
    if (!canManageSelectedGuild.value && activeTab.value !== 'overview') {
        activeTab.value = 'overview';
    }
});
const settingsSubs = computed(() => [
    { key: 'general', label: $t('guilds.subtabs.settings.general') },
    { key: 'moderation', label: $t('guilds.subtabs.settings.moderation') },
    { key: 'system', label: $t('guilds.subtabs.settings.system') },
    { key: 'roles', label: $t('guilds.subtabs.settings.roles') },
    { key: 'invites', label: $t('guilds.subtabs.settings.invites') },
    { key: 'emoji', label: $t('guilds.subtabs.settings.emoji') }
]);
const peopleSubs = computed(() => [
    { key: 'members', label: $t('guilds.subtabs.people.members') },
    { key: 'bans', label: $t('guilds.subtabs.people.bans') },
    { key: 'automod', label: $t('guilds.subtabs.people.automod') },
    { key: 'audit', label: $t('guilds.subtabs.people.audit') }
]);
// Features sub-tabs are derived from the guild-feature registry —
// adding a new feature folder + entry there is enough to surface it
// here. The `_bot` master sub-tab pins to the front and lists every
// built-in + plugin feature with a single on/off switch per row;
// per-feature settings still live on each feature's own sub.
const BOT_FEATURES_SUB = '_bot';
const featuresSubs = computed(() => [
    { key: BOT_FEATURES_SUB, label: 'Bot 功能' },
    ...guildFeatures.map(p => ({ key: p.name, label: $t(p.labelKey) }))
]);
const currentSubTabs = computed(() => {
    if (activeTab.value === 'settings') return settingsSubs.value;
    if (activeTab.value === 'people') return peopleSubs.value;
    if (activeTab.value === 'features') return featuresSubs.value;
    return [];
});
const currentSub = computed({
    get: () => activeSub.value[activeTab.value],
    set: (v: string) => { activeSub.value[activeTab.value] = v; }
});

async function refresh() {
    loadingList.value = true;
    try {
        guilds.value = await listGuilds();
        // Default to "all servers" view (rather than first guild) so a
        // freshly-opened page lands on the cross-guild dashboard. Users
        // who want a specific guild click into it.
        if (!selectedId.value) {
            selectedId.value = ALL_SERVERS_ID;
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
        void loadRoles(id);
    } catch (err) {
        if (handleApiError(err) !== 'unhandled') return;
        error.value = err instanceof Error ? err.message : 'Failed to load guild detail';
    } finally {
        loadingDetail.value = false;
    }
}

const roles = ref<GuildRoleSummary[]>([]);
async function loadRoles(guildId: string) {
    roles.value = [];
    try {
        roles.value = await listGuildRoles(guildId);
    } catch {
        /* informational; silently skip */
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

const inviteModalOpen = ref(false);
function openCreateInvite() {
    invitesError.value = null;
    createdInviteUrl.value = null;
    inviteModalOpen.value = true;
}

async function submitCreateInvite(payload: {
    channelId: string | null;
    maxAge: number;
    maxUses: number;
    temporary: boolean;
    unique: boolean;
}) {
    if (!selectedId.value || creatingInvite.value) return;
    creatingInvite.value = true;
    invitesError.value = null;
    createdInviteUrl.value = null;
    try {
        const result = await createGuildInvite(selectedId.value, {
            channelId: payload.channelId ?? undefined,
            maxAge: payload.maxAge,
            maxUses: payload.maxUses,
            temporary: payload.temporary,
            unique: payload.unique
        });
        createdInviteUrl.value = result.url;
        inviteModalOpen.value = false;
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

// ── Role management ────────────────────────────────────────────────
const roleModalVisible = ref(false);
const roleEditingTarget = ref<GuildRoleSummary | null>(null);
function openCreateRole() {
    roleEditingTarget.value = null;
    roleModalVisible.value = true;
}
function openEditRole(role: GuildRoleSummary) {
    roleEditingTarget.value = role;
    roleModalVisible.value = true;
}
async function onRoleSaved() {
    if (selectedId.value) await loadRoles(selectedId.value);
}
async function onDeleteRole(role: GuildRoleSummary) {
    if (!selectedId.value) return;
    if (!confirm($t('roleMgmt.deleteConfirm', { name: role.name }))) return;
    try {
        await deleteGuildRole(selectedId.value, role.id);
        await loadRoles(selectedId.value);
    } catch (err) {
        if (handleApiError(err) !== 'unhandled') return;
    }
}

// ── Invite revocation ──────────────────────────────────────────────
async function onRevokeInvite(inv: GuildInvite) {
    if (!selectedId.value) return;
    if (!confirm($t('inviteMgmt.revokeConfirm', { code: inv.code }))) return;
    try {
        await deleteGuildInvite(selectedId.value, inv.code);
        await loadInvites(selectedId.value);
    } catch (err) {
        if (handleApiError(err) !== 'unhandled') return;
        invitesError.value = err instanceof Error ? err.message : 'Failed to revoke invite';
    }
}

// `immediate` so a deep-link like /admin/guilds?guild=X loads the
// detail on first mount — useGuildsRoute seeds selectedId from the
// URL before this watcher attaches, so without immediate the initial
// value would slip past unobserved and the main panel would render
// blank. Skip the load when the sentinel ALL_SERVERS_ID is selected;
// that view fetches its own data via AllServersDashboard.
watch(selectedId, (id) => {
    if (id && id !== ALL_SERVERS_ID) loadDetail(id);
}, { immediate: true });

function handleSelect(id: string) {
    selectedId.value = id;
    if (isMobile.value) closeOverlay();
}

onMounted(refresh);
</script>

<template>
    <SidebarLayout>
        <template #sidebar>
            <header class="sidebar-header">
                <h2>{{ $t('guilds.title') }}</h2>
                <span class="count">{{ guilds.length }}</span>
            </header>
            <p v-if="loadingList && guilds.length === 0" class="muted">{{ $t('common.loading') }}</p>
            <ul class="guild-list">
                <li
                    :class="{ active: isAllServers, 'all-servers-row': true }"
                    @click="handleSelect(ALL_SERVERS_ID)"
                >
                    <div class="icon icon-fallback all-servers-icon" aria-hidden="true">
                        <Icon icon="material-symbols:hub-outline-rounded" width="20" height="20" />
                    </div>
                    <div class="meta">
                        <div class="name">所有伺服器</div>
                        <div class="sub">Bot 功能預設管理</div>
                    </div>
                </li>
                <li v-if="!loadingList && guilds.length === 0" class="muted empty">{{ $t('guilds.empty') }}</li>
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
                        <div class="sub">{{ $t('guilds.memberCount', { count: g.memberCount }) }}</div>
                    </div>
                </li>
            </ul>
        </template>

        <div class="detail">
            <AccessDeniedView v-if="accessDenied" />
            <template v-else>
                <p v-if="error" class="error">{{ error }}</p>
                <AllServersDashboard v-if="isAllServers" />
                <p v-else-if="!selectedId" class="muted center">{{ $t('guilds.selectGuild') }}</p>
                <p v-else-if="loadingDetail && !detail" class="muted center">{{ $t('common.loading') }}</p>
                <article v-else-if="detail" class="detail-body">
                    <AppTabs
                        v-model="activeTab"
                        :tabs="primaryTabs"
                        :sub-tabs="currentSubTabs"
                        :sub-model-value="currentSub"
                        sub-layout="sidebar"
                        routed
                        name="guilds"
                        @update:sub-model-value="currentSub = $event"
                    >
                        <!-- Overview ─ no sub-tabs ─ -->
                        <GuildOverviewSection
                            v-if="activeTab === 'overview'"
                            :detail="detail"
                            :roles="roles"
                        />

                        <!-- Settings sub-tabs ─ -->
                        <template v-else-if="activeTab === 'settings'">
                            <GuildGeneralSettingsCard v-if="currentSub === 'general'" :guild-id="selectedId!" />
                            <GuildModerationSettingsCard v-else-if="currentSub === 'moderation'" :guild-id="selectedId!" />
                            <GuildSystemSettingsCard v-else-if="currentSub === 'system'" :guild-id="selectedId!" />
                            <GuildRolesSection
                                v-else-if="currentSub === 'roles'"
                                :roles="roles"
                                @create="openCreateRole"
                                @edit="openEditRole"
                                @delete="onDeleteRole"
                            />
                            <GuildInvitesSection
                                v-else-if="currentSub === 'invites'"
                                :invites="invites"
                                :creating="creatingInvite"
                                :created-url="createdInviteUrl"
                                :error="invitesError"
                                @create="openCreateInvite"
                                @revoke="onRevokeInvite"
                                @copy="copyInvite"
                            />
                            <GuildEmojiStickerPanel
                                v-else-if="currentSub === 'emoji'"
                                :guild-id="selectedId"
                            />
                        </template>

                        <!-- People sub-tabs ─ -->
                        <template v-else-if="activeTab === 'people'">
                            <GuildMembersSection v-if="currentSub === 'members'" :guild-id="selectedId!" />
                            <GuildBansSection v-else-if="currentSub === 'bans'" :guild-id="selectedId!" />
                            <GuildAutoModSection v-else-if="currentSub === 'automod'" :guild-id="selectedId!" />
                            <GuildAuditLogSection v-else-if="currentSub === 'audit'" :guild-id="selectedId!" />
                        </template>

                        <!-- Bot features sub-tabs — driven by the guild-
                             feature registry; whichever feature's name
                             matches the current sub-tab key gets its
                             SettingsCard mounted. The trailing
                             '_plugins' sub-tab routes to the plugin
                             feature panel which talks to the bot's
                             plugin admin API. -->
                        <template v-else-if="activeTab === 'features'">
                            <GuildBotFeaturesPanel
                                v-if="currentSub === BOT_FEATURES_SUB && selectedId"
                                :guild-id="selectedId"
                            />
                            <template v-for="feature in guildFeatures" :key="feature.name">
                                <component
                                    :is="feature.SettingsCard"
                                    v-if="currentSub === feature.name"
                                    :detail="detail"
                                    @changed="selectedId && loadDetail(selectedId)"
                                />
                            </template>
                        </template>
                    </AppTabs>
                </article>
            </template>
        </div>
        <GuildRoleEditModal
            :visible="roleModalVisible"
            :guild-id="selectedId"
            :role="roleEditingTarget"
            @close="roleModalVisible = false"
            @saved="onRoleSaved"
        />
        <GuildInviteCreateModal
            :visible="inviteModalOpen"
            :guild-id="selectedId"
            :creating="creatingInvite"
            :error="invitesError"
            @close="inviteModalOpen = false"
            @submit="submitCreateInvite"
        />
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
    border-radius: var(--radius-pill);
    padding: 0 0.5rem;
    font-size: 0.8rem;
}
.guild-list {
    list-style: none;
    margin: 0;
    padding: 0;
}
.guild-list li {
    display: flex;
    gap: 0.6rem;
    padding: 0.55rem 0.75rem;
    cursor: pointer;
    border-bottom: 1px solid var(--border);
    align-items: center;
}
.guild-list li:hover { background: var(--bg-surface-hover); }
.guild-list li.active { background: var(--bg-surface-active); }
.icon {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    object-fit: cover;
    flex-shrink: 0;
}
.icon-fallback {
    background: var(--accent);
    color: var(--text-on-accent);
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 600;
    font-size: 0.85rem;
}
.all-servers-row {
    border-bottom: 2px solid var(--border-strong) !important;
}
.all-servers-icon {
    background: linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 60%, var(--text-strong)));
}
.meta { min-width: 0; }
.meta .name {
    font-weight: 500;
    color: var(--text-strong);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.meta .sub { font-size: 0.75rem; color: var(--text-muted); }

.detail {
    flex: 1;
    padding: 1rem;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    min-height: 0;
}
.detail-body {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    width: 100%;
    margin: 0 auto;
    flex: 1;
    min-height: 0;
}

.muted { color: var(--text-muted); font-size: 0.9rem; }
.center { text-align: center; padding: 2rem; }
.error {
    color: var(--danger);
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.35);
    border-radius: var(--radius-sm);
    padding: 0.55rem 0.75rem;
}
</style>
