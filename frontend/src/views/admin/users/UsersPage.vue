<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { DashboardLayout } from '../../../layouts';
import {
    listAdminCapabilities,
    listAdminRoles,
    listAdminUsers,
    type AdminCapabilityCatalogItem,
    type AdminRole,
    type AdminUserList,
    type AuthorizedUser
} from '../../../api/admin';
import { useCurrentUserStore } from '../../../stores/currentUserStore';
import { useApiError } from '../../../composables/use-api-error';
import AccessDeniedView from '../../../components/AccessDeniedView.vue';
import AppTabs from '../../../components/AppTabs.vue';
import UsersPanel from './UsersPanel.vue';
import RolesPanel from './RolesPanel.vue';

const { t } = useI18n();
const currentUser = useCurrentUserStore();
const { accessDenied, reset: resetError, handle: handleApiError } = useApiError();

type Tab = 'users' | 'roles';
const activeTab = ref<Tab>('users');
const tabs = computed(() => [
    { key: 'users', label: t('admin.tabs.users'), icon: 'material-symbols:person-rounded' },
    { key: 'roles', label: t('admin.tabs.roles'), icon: 'material-symbols:shield-person-outline-rounded' }
]);

const roles = ref<AdminRole[]>([]);
const users = ref<AdminUserList>({ ownerId: null, users: [] });
const capabilities = ref<AdminCapabilityCatalogItem[]>([]);
// Distinguish first-mount loading (needs the global spinner) from
// background reloads (silent — local state already covers the change).
// The previous design re-emitted `changed` after every mutation and
// flashed the entire panel through "Loading…" on each save, eating
// focus on whichever input the user was editing.
const initialLoading = ref(true);
const error = ref<string | null>(null);

async function loadAll() {
    try {
        const [roleList, userList, capList] = await Promise.all([
            listAdminRoles(),
            listAdminUsers(),
            listAdminCapabilities(),
            currentUser.refresh()
        ]);
        roles.value = roleList;
        users.value = userList;
        capabilities.value = capList;
        error.value = null;
        resetError();
    } catch (err) {
        if (handleApiError(err) !== 'unhandled') return;
        error.value = err instanceof Error ? err.message : String(err);
    } finally {
        initialLoading.value = false;
    }
}

function setError(message: string) {
    error.value = message;
}
function clearError() {
    error.value = null;
}

// ── Granular mutation handlers ────────────────────────────────────
//
// Children call API → on success → emit one of these to patch the
// in-memory list. No re-fetch, no flash, no lost focus.

function onUpsertUser(user: AuthorizedUser) {
    const idx = users.value.users.findIndex(u => u.userId === user.userId);
    const next = [...users.value.users];
    if (idx >= 0) next[idx] = user;
    else next.push(user);
    users.value = { ...users.value, users: next };
}
function onRemoveUser(userId: string) {
    users.value = {
        ...users.value,
        users: users.value.users.filter(u => u.userId !== userId)
    };
}
function onUpsertRole(role: AdminRole) {
    const idx = roles.value.findIndex(r => r.name === role.name);
    if (idx >= 0) {
        const next = [...roles.value];
        next[idx] = role;
        roles.value = next;
    } else {
        roles.value = [...roles.value, role];
    }
}
function onRemoveRole(name: string) {
    roles.value = roles.value.filter(r => r.name !== name);
    // A role going away can leave authorized users pointing at a stale
    // name; the list still renders them with the unknown-role fallback
    // until the user re-assigns. Refresh self-identity so the nav
    // capability set stays in sync.
    void currentUser.refresh();
}
// Capability grant/revoke is the highest-frequency mutation — we patch
// the role's capability array in place to keep the checkbox grid
// instant. Rollbacks live in the panel itself if the API fails.
function onCapabilityChange(roleName: string, nextCaps: string[]) {
    const idx = roles.value.findIndex(r => r.name === roleName);
    if (idx < 0) return;
    const next = [...roles.value];
    next[idx] = { ...next[idx], capabilities: nextCaps };
    roles.value = next;
    void currentUser.refresh();
}

onMounted(loadAll);
</script>

<template>
    <DashboardLayout :title="$t('admin.title')">
        <p v-if="initialLoading" class="muted">{{ $t('common.loading') }}</p>
        <AccessDeniedView v-else-if="accessDenied" />
        <template v-else>
            <p v-if="error" class="error" role="alert">
                {{ error }}
                <button type="button" class="error-close" @click="clearError" :aria-label="$t('common.close')">×</button>
            </p>
            <AppTabs v-model="activeTab" :tabs="tabs" routed name="admin">
                <UsersPanel
                    v-if="activeTab === 'users'"
                    :data="users"
                    :roles="roles"
                    @upsert-user="onUpsertUser"
                    @remove-user="onRemoveUser"
                    @error="setError"
                />
                <RolesPanel
                    v-else
                    :roles="roles"
                    :capability-catalog="capabilities"
                    @upsert-role="onUpsertRole"
                    @remove-role="onRemoveRole"
                    @capability-change="onCapabilityChange"
                    @error="setError"
                />
            </AppTabs>
        </template>
    </DashboardLayout>
</template>

<style scoped>
.muted { color: var(--text-muted); }
.error {
    margin: 0 0 0.8rem;
    color: var(--danger);
    padding: 0.55rem 0.75rem;
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.35);
    border-radius: 6px;
    display: flex;
    align-items: center;
    gap: 0.5rem;
}
.error-close {
    margin-left: auto;
    background: none;
    border: none;
    color: var(--danger);
    cursor: pointer;
    font-size: 1.2rem;
    line-height: 1;
    padding: 0 0.3rem;
}
</style>
