<script setup lang="ts">
import { computed, ref } from 'vue';
import { Icon } from '@iconify/vue';
import { useI18n } from 'vue-i18n';
import {
    deleteAdminUser,
    upsertAdminUser,
    type AdminRole,
    type AdminUserList,
    type AuthorizedUser
} from '../../api/admin';
import { ApiError } from '../../api/client';

const props = defineProps<{
    data: AdminUserList;
    roles: AdminRole[];
}>();

const emit = defineEmits<{
    (e: 'changed'): void;
    (e: 'error', message: string): void;
}>();

const { t } = useI18n();

const formUserId = ref('');
const formRole = ref('');
const formNote = ref('');
const submitting = ref(false);

function resetForm() {
    formUserId.value = '';
    formRole.value = props.roles[0]?.name ?? '';
    formNote.value = '';
}

function displayNameFor(user: AuthorizedUser): string {
    return user.profile?.globalName
        ?? user.profile?.username
        ?? t('admin.users.unknownProfile');
}

function initialFor(user: AuthorizedUser): string {
    const name = user.profile?.globalName ?? user.profile?.username;
    return (name ?? user.userId).trim().charAt(0).toUpperCase() || '?';
}

const manageableUsers = computed(() => props.data.users.filter(u => !u.isOwner));
const ownerEntry = computed(() => props.data.users.find(u => u.isOwner) ?? null);

async function onAdd() {
    const userId = formUserId.value.trim();
    const role = formRole.value.trim();
    if (!userId || !role) return;
    submitting.value = true;
    try {
        await upsertAdminUser({ userId, role, note: formNote.value.trim() || null });
        resetForm();
        emit('changed');
    } catch (err) {
        emit('error', err instanceof ApiError ? err.message : String(err));
    } finally {
        submitting.value = false;
    }
}

async function onChangeRole(user: AuthorizedUser, role: string) {
    if (role === user.role) return;
    try {
        await upsertAdminUser({ userId: user.userId, role, note: user.note });
        emit('changed');
    } catch (err) {
        emit('error', err instanceof ApiError ? err.message : String(err));
    }
}

async function onRemove(user: AuthorizedUser) {
    if (!window.confirm(t('admin.users.removeConfirm', { user: displayNameFor(user) }))) return;
    try {
        await deleteAdminUser(user.userId);
        emit('changed');
    } catch (err) {
        emit('error', err instanceof ApiError ? err.message : String(err));
    }
}
</script>

<template>
    <div class="panel">
        <form class="add-form" @submit.prevent="onAdd">
            <h3>{{ $t('admin.users.add') }}</h3>
            <div class="fields">
                <label>
                    <span>{{ $t('admin.users.userIdLabel') }}</span>
                    <input v-model="formUserId" type="text" required pattern="\d+" inputmode="numeric" />
                </label>
                <label>
                    <span>{{ $t('admin.users.roleLabel') }}</span>
                    <select v-model="formRole" required>
                        <option v-for="r in roles" :key="r.name" :value="r.name">{{ r.name }}</option>
                    </select>
                </label>
                <label class="note-field">
                    <span>{{ $t('admin.users.noteLabel') }}</span>
                    <input v-model="formNote" type="text" :placeholder="$t('admin.users.notePlaceholder')" />
                </label>
            </div>
            <button type="submit" class="primary" :disabled="submitting || roles.length === 0">
                {{ $t('admin.users.addSubmit') }}
            </button>
        </form>

        <h3 class="list-heading">{{ $t('admin.users.title') }}</h3>

        <div class="card-grid">
            <!-- Owner card is always pinned first, never editable. -->
            <article v-if="ownerEntry" class="user-card owner-card">
                <img v-if="ownerEntry.profile?.avatarUrl" :src="ownerEntry.profile.avatarUrl" alt="" class="avatar" />
                <div v-else class="avatar avatar-fallback">{{ initialFor(ownerEntry) }}</div>
                <div class="card-body">
                    <div class="display-name">
                        {{ displayNameFor(ownerEntry) }}
                        <span class="owner-pill">{{ $t('admin.users.ownerBadge') }}</span>
                    </div>
                    <code class="user-id">{{ ownerEntry.userId }}</code>
                </div>
            </article>

            <article
                v-for="user in manageableUsers"
                :key="user.userId"
                class="user-card"
            >
                <img v-if="user.profile?.avatarUrl" :src="user.profile.avatarUrl" alt="" class="avatar" />
                <div v-else class="avatar avatar-fallback">{{ initialFor(user) }}</div>
                <div class="card-body">
                    <div class="display-name">{{ displayNameFor(user) }}</div>
                    <code class="user-id">{{ user.userId }}</code>
                    <p v-if="user.note" class="user-note">{{ user.note }}</p>
                    <div class="card-controls">
                        <label class="role-wrap">
                            <span class="role-caption">{{ $t('admin.users.roleLabel') }}</span>
                            <select
                                class="role-select"
                                :value="user.role"
                                :title="$t('admin.users.changeRole')"
                                @change="onChangeRole(user, ($event.target as HTMLSelectElement).value)"
                            >
                                <option v-for="r in roles" :key="r.name" :value="r.name">{{ r.name }}</option>
                                <option v-if="!roles.some(r => r.name === user.role)" :value="user.role">
                                    {{ user.role }} (unknown)
                                </option>
                            </select>
                        </label>
                        <button type="button" class="danger" :title="$t('admin.users.remove')" @click="onRemove(user)">
                            <Icon icon="material-symbols:delete-rounded" width="18" height="18" />
                        </button>
                    </div>
                </div>
            </article>
        </div>

        <p v-if="manageableUsers.length === 0 && !ownerEntry" class="muted empty">{{ $t('admin.users.empty') }}</p>
    </div>
</template>

<style scoped>
.panel {
    display: flex;
    flex-direction: column;
    gap: 1rem;
}
.add-form {
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 0.75rem 1rem;
    background: var(--bg-surface);
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
}
.add-form h3 { margin: 0; font-size: 0.9rem; }
.fields {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 0.6rem;
}
.fields label {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    font-size: 0.8rem;
    color: var(--text-muted);
}
.fields input,
.fields select {
    padding: 0.35rem 0.5rem;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg-surface);
    color: var(--text);
    font: inherit;
    font-size: 0.9rem;
}
.note-field { grid-column: span 2; }
@media (max-width: 520px) { .note-field { grid-column: span 1; } }
.primary {
    align-self: flex-start;
    padding: 0.4rem 0.9rem;
    background: var(--accent);
    color: var(--text-on-accent);
    border: 1px solid var(--accent);
    border-radius: 4px;
    cursor: pointer;
    font: inherit;
}
.primary:disabled { opacity: 0.5; cursor: default; }
.list-heading { margin: 0; font-size: 0.95rem; }
.card-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 0.7rem;
}
.user-card {
    display: flex;
    gap: 0.75rem;
    padding: 0.75rem;
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    align-items: flex-start;
}
.owner-card {
    background: var(--accent-bg);
    border-color: var(--accent);
}
.avatar {
    width: 48px;
    height: 48px;
    border-radius: 50%;
    flex-shrink: 0;
    object-fit: cover;
    background: var(--bg-surface-2);
}
.avatar-fallback {
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--accent);
    color: var(--text-on-accent);
    font-weight: 600;
    font-size: 1.1rem;
}
.card-body {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
}
.display-name {
    font-weight: 600;
    color: var(--text-strong);
    display: flex;
    align-items: center;
    gap: 0.4rem;
    flex-wrap: wrap;
}
.owner-pill {
    display: inline-flex;
    align-items: center;
    padding: 0.05rem 0.5rem;
    background: var(--accent);
    color: var(--text-on-accent);
    border-radius: 999px;
    font-size: 0.7rem;
    font-weight: 600;
    letter-spacing: 0.03em;
    text-transform: uppercase;
}
.user-id {
    font-size: 0.78rem;
    color: var(--text-muted);
    word-break: break-all;
}
.user-note {
    margin: 0;
    font-size: 0.82rem;
    color: var(--text-muted);
}
.card-controls {
    margin-top: auto;
    padding-top: 0.3rem;
    display: flex;
    gap: 0.4rem;
    align-items: flex-end;
}
.role-wrap {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    font-size: 0.75rem;
    color: var(--text-muted);
}
.role-caption { font-size: 0.7rem; }
.role-select {
    padding: 0.3rem 0.45rem;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg-surface);
    color: var(--text);
    font: inherit;
    font-size: 0.85rem;
    width: 100%;
}
.danger {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg-surface);
    color: var(--danger);
    cursor: pointer;
    flex-shrink: 0;
}
.danger:hover { background: rgba(239, 68, 68, 0.15); }
.muted { color: var(--text-muted); font-size: 0.9rem; }
.empty { padding: 1rem; text-align: center; }
</style>
