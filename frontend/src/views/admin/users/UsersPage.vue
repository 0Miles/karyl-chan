<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { DashboardLayout } from '../../../layouts';
import { ApiError } from '../../../api/client';
import {
    listAdminRoles,
    listAdminUsers,
    type AdminRole,
    type AdminUserList
} from '../../../api/admin';
import { useCurrentUserStore } from '../../../stores/currentUserStore';
import UsersPanel from './UsersPanel.vue';
import RolesPanel from './RolesPanel.vue';

const router = useRouter();
const currentUser = useCurrentUserStore();

type Tab = 'users' | 'roles';
const activeTab = ref<Tab>('users');

const roles = ref<AdminRole[]>([]);
const users = ref<AdminUserList>({ ownerId: null, users: [] });
const loading = ref(true);
const error = ref<string | null>(null);

async function refresh() {
    loading.value = true;
    try {
        // Refresh the nav-level identity cache in parallel — the admin
        // surface is exactly where self-role / capability changes happen,
        // and a stale avatar/menu after a successful mutation is confusing.
        const [roleList, userList] = await Promise.all([
            listAdminRoles(),
            listAdminUsers(),
            currentUser.refresh()
        ]);
        roles.value = roleList;
        users.value = userList;
        error.value = null;
    } catch (err) {
        if (err instanceof ApiError) {
            if (err.status === 401) { router.replace({ name: 'auth' }); return; }
            // 403 is a "valid" terminal state for users without the admin
            // capability — keep them here with a readable message rather than
            // redirecting elsewhere.
        }
        error.value = err instanceof Error ? err.message : String(err);
    } finally {
        loading.value = false;
    }
}

function setError(message: string) {
    error.value = message;
}

onMounted(refresh);
</script>

<template>
    <DashboardLayout :title="$t('admin.title')">
        <nav class="tabs" role="tablist">
            <button
                type="button"
                role="tab"
                :class="['tab', { active: activeTab === 'users' }]"
                :aria-selected="activeTab === 'users'"
                @click="activeTab = 'users'"
            >{{ $t('admin.tabs.users') }}</button>
            <button
                type="button"
                role="tab"
                :class="['tab', { active: activeTab === 'roles' }]"
                :aria-selected="activeTab === 'roles'"
                @click="activeTab = 'roles'"
            >{{ $t('admin.tabs.roles') }}</button>
        </nav>

        <p v-if="loading" class="muted">{{ $t('common.loading') }}</p>
        <p v-else-if="error" class="error">{{ error }}</p>
        <template v-else>
            <UsersPanel
                v-if="activeTab === 'users'"
                :data="users"
                :roles="roles"
                @changed="refresh"
                @error="setError"
            />
            <RolesPanel
                v-else
                :roles="roles"
                @changed="refresh"
                @error="setError"
            />
        </template>
    </DashboardLayout>
</template>

<style scoped>
.tabs {
    display: flex;
    gap: 0.4rem;
    border-bottom: 1px solid var(--border);
    padding-bottom: 0.4rem;
}
.tab {
    background: var(--bg-surface-2);
    border: 1px solid transparent;
    border-radius: 4px;
    padding: 0.35rem 0.9rem;
    cursor: pointer;
    color: var(--text);
    font: inherit;
    font-size: 0.9rem;
}
.tab.active {
    background: var(--accent-bg);
    border-color: var(--accent);
    color: var(--accent-text-strong);
}
.muted { color: var(--text-muted); }
.error {
    color: var(--danger);
    padding: 0.6rem 0.75rem;
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.35);
    border-radius: 4px;
}
</style>
