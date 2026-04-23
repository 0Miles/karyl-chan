<script setup lang="ts">
import { ref } from 'vue';
import { Icon } from '@iconify/vue';
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

const formUserId = ref('');
const formRole = ref('');
const formNote = ref('');
const submitting = ref(false);

function resetForm() {
    formUserId.value = '';
    formRole.value = props.roles[0]?.name ?? '';
    formNote.value = '';
}

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
    if (!window.confirm(`Remove ${user.userId}?`)) return;
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
        <p class="muted owner-note">
            <Icon icon="material-symbols:key-rounded" width="16" height="16" />
            {{ $t('admin.users.ownerNote') }}
            <span v-if="data.ownerId" class="owner-id"><code>{{ data.ownerId }}</code></span>
        </p>

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
        <p v-if="data.users.length === 0" class="muted empty">{{ $t('admin.users.empty') }}</p>
        <ul v-else class="user-list">
            <li v-for="user in data.users" :key="user.userId" class="user-row">
                <div class="user-main">
                    <code class="user-id">{{ user.userId }}</code>
                    <span v-if="user.note" class="user-note">{{ user.note }}</span>
                </div>
                <div class="user-controls">
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
                    <button type="button" class="danger" :title="$t('admin.users.remove')" @click="onRemove(user)">
                        <Icon icon="material-symbols:delete-rounded" width="18" height="18" />
                    </button>
                </div>
            </li>
        </ul>
    </div>
</template>

<style scoped>
.panel {
    display: flex;
    flex-direction: column;
    gap: 1rem;
}
.owner-note {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.85rem;
    color: var(--text-muted);
    padding: 0.6rem 0.75rem;
    background: var(--bg-surface-2);
    border: 1px solid var(--border);
    border-radius: 6px;
    margin: 0;
}
.owner-id code { font-size: 0.8rem; }
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
@media (max-width: 520px) {
    .note-field { grid-column: span 1; }
}
.primary {
    align-self: flex-start;
    padding: 0.4rem 0.9rem;
    background: var(--accent);
    color: var(--text-on-accent);
    border: 1px solid var(--accent);
    border-radius: 4px;
    cursor: pointer;
}
.primary:disabled { opacity: 0.5; cursor: default; }
.list-heading { margin: 0; font-size: 0.95rem; }
.user-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
}
.user-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.55rem 0.75rem;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg-surface);
}
.user-main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
}
.user-id {
    font-size: 0.85rem;
    color: var(--text-strong);
}
.user-note {
    font-size: 0.78rem;
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.user-controls {
    display: flex;
    gap: 0.4rem;
    align-items: center;
}
.role-select {
    padding: 0.3rem 0.45rem;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg-surface);
    color: var(--text);
    font: inherit;
    font-size: 0.85rem;
}
.danger {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg-surface);
    color: var(--danger);
    cursor: pointer;
}
.danger:hover { background: rgba(239, 68, 68, 0.15); }
.muted { color: var(--text-muted); font-size: 0.9rem; }
.empty { padding: 1rem; text-align: center; }
</style>
