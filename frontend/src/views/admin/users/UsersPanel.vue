<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Icon } from '@iconify/vue';
import { useI18n } from 'vue-i18n';
import {
    deleteAdminUser,
    upsertAdminUser,
    type AdminRole,
    type AdminUserList,
    type AuthorizedUser
} from '../../../api/admin';
import { ApiError } from '../../../api/client';
import AppModal from '../../../components/AppModal.vue';
import AppSelectField, { type SelectOption } from '../../../components/AppSelectField.vue';

const props = defineProps<{
    data: AdminUserList;
    roles: AdminRole[];
}>();

const emit = defineEmits<{
    /** Mutation succeeded — patch the parent's local list with the
     *  returned entity. The parent never refetches the whole list, so
     *  no inputs lose focus and the panel never flashes. */
    (e: 'upsert-user', user: AuthorizedUser): void;
    (e: 'remove-user', userId: string): void;
    (e: 'error', message: string): void;
}>();

const { t } = useI18n();

const search = ref('');
const roleFilter = ref<string>('');

const filterRoleOptions = computed<SelectOption<string>[]>(() => [
    { value: '', label: t('admin.users.filterAll') },
    ...props.roles.map(r => ({ value: r.name, label: r.name }))
]);
const addRoleOptions = computed<SelectOption<string>[]>(() =>
    props.roles.map(r => ({ value: r.name, label: r.name }))
);
function rowRoleOptionsFor(user: AuthorizedUser): SelectOption<string>[] {
    const known = props.roles.map(r => ({ value: r.name, label: r.name }));
    if (!props.roles.some(r => r.name === user.role)) {
        return [...known, { value: user.role, label: t('admin.users.unknownRole', { name: user.role }) }];
    }
    return known;
}

const ownerEntry = computed(() => props.data.users.find(u => u.isOwner) ?? null);
const manageableUsers = computed(() => props.data.users.filter(u => !u.isOwner));

const filtered = computed(() => {
    const q = search.value.trim().toLowerCase();
    const role = roleFilter.value;
    return manageableUsers.value.filter(u => {
        if (role && u.role !== role) return false;
        if (!q) return true;
        const name = (u.profile?.globalName ?? u.profile?.username ?? '').toLowerCase();
        return name.includes(q) || u.userId.includes(q);
    });
});

function displayNameFor(user: AuthorizedUser): string {
    return user.profile?.globalName
        ?? user.profile?.username
        ?? t('admin.users.unknownProfile');
}
function handleFor(user: AuthorizedUser): string | null {
    return user.profile?.username ? `@${user.profile.username}` : null;
}
function initialFor(user: AuthorizedUser): string {
    const name = user.profile?.globalName ?? user.profile?.username;
    return (name ?? user.userId).trim().charAt(0).toUpperCase() || '?';
}

// ── Per-user lock so a slow API can't stack mutations on the same row.
const pendingUserIds = ref(new Set<string>());
function isUserPending(userId: string) {
    return pendingUserIds.value.has(userId);
}
async function withUserLock<T>(userId: string, fn: () => Promise<T>): Promise<T | undefined> {
    if (pendingUserIds.value.has(userId)) return undefined;
    pendingUserIds.value = new Set([...pendingUserIds.value, userId]);
    try {
        return await fn();
    } finally {
        const next = new Set(pendingUserIds.value);
        next.delete(userId);
        pendingUserIds.value = next;
    }
}

function reportErr(err: unknown) {
    emit('error', err instanceof ApiError ? err.message : String(err));
}

// Inline role change → optimistic, with rollback on error.
async function onChangeRole(user: AuthorizedUser, role: string) {
    if (role === user.role) return;
    await withUserLock(user.userId, async () => {
        try {
            const updated = await upsertAdminUser({ userId: user.userId, role, note: user.note });
            emit('upsert-user', updated);
        } catch (err) {
            reportErr(err);
        }
    });
}

async function onRemove(user: AuthorizedUser) {
    if (!window.confirm(t('admin.users.removeConfirm', { user: displayNameFor(user) }))) return;
    await withUserLock(user.userId, async () => {
        try {
            await deleteAdminUser(user.userId);
            emit('remove-user', user.userId);
        } catch (err) {
            reportErr(err);
        }
    });
}

// ── Add-user modal ────────────────────────────────────────────────
const addOpen = ref(false);
const addForm = ref({ userId: '', role: '', note: '' });
const adding = ref(false);

watch(addOpen, (open) => {
    if (open) {
        addForm.value = {
            userId: '',
            role: props.roles[0]?.name ?? '',
            note: ''
        };
    }
});

async function submitAdd() {
    const userId = addForm.value.userId.trim();
    const role = addForm.value.role.trim();
    if (!userId || !role) return;
    adding.value = true;
    try {
        const created = await upsertAdminUser({
            userId,
            role,
            note: addForm.value.note.trim() || null
        });
        emit('upsert-user', created);
        addOpen.value = false;
    } catch (err) {
        reportErr(err);
    } finally {
        adding.value = false;
    }
}

const matchSummary = computed(() =>
    t('admin.users.matchCount', { matched: filtered.value.length, total: manageableUsers.value.length })
);
</script>

<template>
    <div class="panel">
        <header class="toolbar">
            <div class="search-wrap">
                <Icon icon="material-symbols:search-rounded" width="18" height="18" class="search-icon" />
                <input
                    v-model="search"
                    type="search"
                    class="search-input"
                    :placeholder="$t('admin.users.searchPlaceholder')"
                />
            </div>
            <div class="role-filter">
                <AppSelectField
                    v-model="roleFilter"
                    :options="filterRoleOptions"
                    :drawer-title="$t('admin.users.filterAll')"
                />
            </div>
            <button type="button" class="primary" @click="addOpen = true">
                <Icon icon="material-symbols:person-add-outline-rounded" width="16" height="16" />
                {{ $t('admin.users.add') }}
            </button>
        </header>

        <p class="muted match-count">{{ matchSummary }}</p>

        <ul class="user-list">
            <li v-if="ownerEntry" class="user-row owner-row">
                <img v-if="ownerEntry.profile?.avatarUrl" :src="ownerEntry.profile.avatarUrl" alt="" class="avatar" />
                <div v-else class="avatar avatar-fallback">{{ initialFor(ownerEntry) }}</div>
                <div class="identity">
                    <div class="display-name">
                        {{ displayNameFor(ownerEntry) }}
                        <span class="owner-badge">{{ $t('admin.users.ownerBadge') }}</span>
                    </div>
                    <code class="handle">{{ handleFor(ownerEntry) ?? ownerEntry.userId }}</code>
                </div>
            </li>
            <li
                v-for="user in filtered"
                :key="user.userId"
                class="user-row"
                :class="{ pending: isUserPending(user.userId) }"
            >
                <img v-if="user.profile?.avatarUrl" :src="user.profile.avatarUrl" alt="" class="avatar" />
                <div v-else class="avatar avatar-fallback">{{ initialFor(user) }}</div>
                <div class="identity">
                    <div class="display-name">{{ displayNameFor(user) }}</div>
                    <code class="handle">{{ handleFor(user) ?? user.userId }}</code>
                    <p v-if="user.note" class="note">{{ user.note }}</p>
                </div>
                <div class="role-select">
                    <AppSelectField
                        :model-value="user.role"
                        :options="rowRoleOptionsFor(user)"
                        :disabled="isUserPending(user.userId)"
                        :drawer-title="$t('admin.users.changeRole')"
                        @update:model-value="onChangeRole(user, $event)"
                    />
                </div>
                <button
                    type="button"
                    class="icon-btn danger"
                    :disabled="isUserPending(user.userId)"
                    :title="$t('admin.users.remove')"
                    :aria-label="$t('admin.users.remove')"
                    @click="onRemove(user)"
                >
                    <Icon icon="material-symbols:delete-outline-rounded" width="18" height="18" />
                </button>
            </li>
        </ul>

        <p v-if="filtered.length === 0 && !ownerEntry" class="muted empty">{{ $t('admin.users.empty') }}</p>
        <p v-else-if="filtered.length === 0" class="muted empty">{{ $t('admin.users.noMatches') }}</p>

        <AppModal :visible="addOpen" :title="$t('admin.users.add')" @close="addOpen = false">
            <form class="add-body" @submit.prevent="submitAdd">
                <label class="field">
                    <span>{{ $t('admin.users.userIdLabel') }}</span>
                    <input
                        v-model="addForm.userId"
                        type="text"
                        required
                        pattern="\d+"
                        inputmode="numeric"
                        autofocus
                    />
                </label>
                <label class="field">
                    <span>{{ $t('admin.users.roleLabel') }}</span>
                    <AppSelectField
                        v-model="addForm.role"
                        :options="addRoleOptions"
                        :drawer-title="$t('admin.users.roleLabel')"
                    />
                </label>
                <label class="field">
                    <span>{{ $t('admin.users.noteLabel') }}</span>
                    <input v-model="addForm.note" type="text" :placeholder="$t('admin.users.notePlaceholder')" />
                </label>
                <footer class="actions">
                    <button type="button" class="ghost" @click="addOpen = false">{{ $t('common.cancel') }}</button>
                    <button type="submit" class="primary" :disabled="adding || !roles.length">
                        {{ $t('admin.users.addSubmit') }}
                    </button>
                </footer>
            </form>
        </AppModal>
    </div>
</template>

<style scoped>
.panel {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
}
.toolbar {
    display: flex;
    align-items: stretch;
    gap: 0.5rem;
    flex-wrap: wrap;
}
.search-wrap {
    flex: 1 1 220px;
    min-width: 0;
    position: relative;
    display: flex;
    align-items: center;
}
.search-icon {
    position: absolute;
    left: 0.55rem;
    color: var(--text-muted);
    pointer-events: none;
}
.search-input {
    width: 100%;
    box-sizing: border-box;
    padding: 0.45rem 0.65rem 0.45rem 2rem;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg-surface);
    color: var(--text);
    font: inherit;
    font-size: 0.9rem;
}
.role-filter {
    min-width: 140px;
}
.primary {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.45rem 0.9rem;
    background: var(--accent);
    color: var(--text-on-accent);
    border: 1px solid var(--accent);
    border-radius: 6px;
    cursor: pointer;
    font: inherit;
    font-size: 0.88rem;
    font-weight: 500;
}
.primary:disabled { opacity: 0.55; cursor: default; }
.match-count {
    margin: 0;
    font-size: 0.78rem;
}

.user-list {
    list-style: none;
    margin: 0;
    padding: 0;
    /* Responsive grid — packs multiple user cards side-by-side once the
       viewport is wide enough. Each card stays self-contained at the
       card's own min width (380px); narrower viewports collapse to a
       single column. */
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(380px, 1fr));
    gap: 0.5rem;
    align-items: start;
}
.user-row {
    display: grid;
    grid-template-columns: 44px 1fr auto auto;
    align-items: center;
    gap: 0.75rem;
    padding: 0.6rem 0.85rem;
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    transition: opacity 0.15s;
    padding: 16px;
}
.user-row.pending { opacity: 0.55; }
.avatar {
    width: 44px;
    height: 44px;
    border-radius: 50%;
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
.identity {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
}
.display-name {
    font-weight: 600;
    color: var(--text-strong);
    display: flex;
    align-items: center;
    gap: 0.4rem;
    flex-wrap: wrap;
}
.owner-badge {
    display: inline-flex;
    align-items: center;
    padding: 0.05rem 0.5rem;
    background: var(--accent);
    color: var(--text-on-accent);
    border-radius: 999px;
    font-size: 0.65rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
}
.handle {
    font-size: 0.78rem;
    color: var(--text-muted);
    word-break: break-all;
}
.note {
    margin: 0;
    font-size: 0.8rem;
    color: var(--text-muted);
}
.role-select {
    min-width: 140px;
}
.icon-btn {
    width: 36px;
    height: 36px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg-surface);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
}
.icon-btn:hover { background: var(--bg-surface-hover); }
.icon-btn.danger { color: var(--danger); }
.icon-btn.danger:hover { background: rgba(239, 68, 68, 0.12); }
.icon-btn:disabled { opacity: 0.55; cursor: default; }
.muted { color: var(--text-muted); font-size: 0.85rem; }
.empty { padding: 1.2rem; text-align: center; }

.add-body {
    padding: 0.8rem 0.9rem;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
}
.field {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.85rem;
}
.field span { color: var(--text-muted); }
.field input,
.field select {
    padding: 0.4rem 0.55rem;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg-surface);
    color: var(--text);
    font: inherit;
    font-size: 0.9rem;
}
.actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    margin-top: 0.4rem;
}
.ghost {
    padding: 0.45rem 0.9rem;
    background: none;
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text);
    cursor: pointer;
    font: inherit;
    font-size: 0.88rem;
}
.ghost:hover { background: var(--bg-surface-hover); }

@media (max-width: 600px) {
    .user-row {
        grid-template-columns: 40px 1fr auto;
        grid-template-rows: auto auto;
        column-gap: 0.55rem;
        row-gap: 0.4rem;
    }
    .role-select {
        grid-column: 2 / -1;
        grid-row: 2;
        min-width: 0;
    }
    .icon-btn {
        grid-column: 3;
        grid-row: 1;
    }
    .avatar { width: 40px; height: 40px; }
}
</style>
