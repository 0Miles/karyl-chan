<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
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
import GuildRoleEditModal from './GuildRoleEditModal.vue';
import GuildEmojiStickerPanel from './GuildEmojiStickerPanel.vue';
import GuildOverviewSection from './sections/GuildOverviewSection.vue';
import GuildBotConfigSection from './sections/GuildBotConfigSection.vue';
import GuildRolesSection from './sections/GuildRolesSection.vue';
import GuildInvitesSection from './sections/GuildInvitesSection.vue';
import GuildInviteCreateModal from './GuildInviteCreateModal.vue';
import AppTabs from '../../../components/AppTabs.vue';
import GuildSettingsSection from './sections/GuildSettingsSection.vue';
import GuildMembersSection from './sections/GuildMembersSection.vue';
import GuildBansSection from './sections/GuildBansSection.vue';
import GuildAuditLogSection from './sections/GuildAuditLogSection.vue';
import GuildAutoModSection from './sections/GuildAutoModSection.vue';

const { t: $t } = useI18n();

const { closeOverlay } = useAppShell();
const { isMobile } = useBreakpoint();
const { accessDenied, reset: resetError, handle: handleApiError } = useApiError();

const guilds = ref<GuildSummary[]>([]);
const selectedId = ref<string | null>(null);
const detail = ref<GuildDetail | null>(null);
const loadingList = ref(false);
const loadingDetail = ref(false);
const error = ref<string | null>(null);

// Sticky tab nav for the workbench. Each guild keeps its tab independently
// so flipping between guilds doesn't bounce the user back to "overview".
type Tab = 'overview' | 'settings' | 'people' | 'features';
const activeTab = ref<Tab>('overview');

// Per-tab sub-selection. Stored in a single ref keyed by primary tab so
// the sub-state survives flipping between primary tabs and back —
// jumping to "people" then back to "settings" preserves the settings
// sub-tab the user was last on.
const activeSub = ref<Record<Tab, string>>({
    overview: '',
    settings: 'general',
    people: 'members',
    features: 'todo'
});

const primaryTabs = computed(() => [
    { key: 'overview', label: $t('guilds.tabs.overview'), icon: 'material-symbols:dashboard-outline-rounded' },
    { key: 'settings', label: $t('guilds.tabs.settings'), icon: 'material-symbols:tune-rounded' },
    { key: 'people', label: $t('guilds.tabs.people'), icon: 'material-symbols:groups-outline-rounded' },
    { key: 'features', label: $t('guilds.tabs.features'), icon: 'material-symbols:extension-outline-rounded' }
]);
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
const featuresSubs = computed(() => [
    { key: 'todo', label: $t('guilds.subtabs.features.todo') },
    { key: 'picture', label: $t('guilds.subtabs.features.picture') },
    { key: 'rcon', label: $t('guilds.subtabs.features.rcon') },
    { key: 'roleEmoji', label: $t('guilds.subtabs.features.roleEmoji') },
    { key: 'roleReceive', label: $t('guilds.subtabs.features.roleReceive') },
    { key: 'capability', label: $t('guilds.subtabs.features.capability') }
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

watch(selectedId, (id) => { if (id) loadDetail(id); });

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
                        <div class="sub">{{ $t('guilds.memberCount', { count: g.memberCount }) }}</div>
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
                    <AppTabs
                        v-model="activeTab"
                        :tabs="primaryTabs"
                        :sub-tabs="currentSubTabs"
                        :sub-model-value="currentSub"
                        sub-layout="sidebar"
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
                            <GuildSettingsSection
                                v-if="currentSub === 'general' || currentSub === 'moderation' || currentSub === 'system'"
                                :guild-id="selectedId!"
                                :cards="[currentSub as 'general' | 'moderation' | 'system']"
                            />
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

                        <!-- Bot features sub-tabs ─ -->
                        <GuildBotConfigSection
                            v-else-if="activeTab === 'features'"
                            :detail="detail"
                            :cards="[currentSub as 'todo' | 'picture' | 'rcon' | 'roleEmoji' | 'roleReceive' | 'capability']"
                            @changed="selectedId && loadDetail(selectedId)"
                        />
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
    border-radius: 999px;
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
    padding: 1rem;
    height: 100%;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    min-height: 0;
}
.detail-body {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    max-width: 1100px;
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
    border-radius: 4px;
    padding: 0.55rem 0.75rem;
}
</style>
