<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Icon } from '@iconify/vue';
import { useI18n } from 'vue-i18n';
import {
    deleteAdminRole,
    grantRoleCapability,
    patchAdminRole,
    revokeRoleCapability,
    upsertAdminRole,
    type AdminCapabilityCatalogItem,
    type AdminRole
} from '../../../api/admin';
import { ApiError } from '../../../api/client';
import { GLOBAL_CAPABILITY_KEYS } from '../../../libs/admin-capabilities';
import AppModal from '../../../components/AppModal.vue';
import RoleCapabilityModal from './RoleCapabilityModal.vue';

const props = defineProps<{
    roles: AdminRole[];
    /** Authoritative catalog from GET /api/admin/capabilities. Used by
     *  the per-role modal for capability descriptions. */
    capabilityCatalog?: AdminCapabilityCatalogItem[];
}>();

const emit = defineEmits<{
    /** Local-state-update events. The parent patches its lists from
     *  these instead of refetching, so editing doesn't blank the UI. */
    (e: 'upsert-role', role: AdminRole): void;
    (e: 'remove-role', name: string): void;
    (e: 'capability-change', roleName: string, capabilities: string[]): void;
    (e: 'error', message: string): void;
}>();

const { t } = useI18n();

// ── Per-role lock so rapid clicks on different controls of the same
// role don't fire concurrent mutations.
const pendingRoles = ref(new Set<string>());
function isRolePending(name: string) {
    return pendingRoles.value.has(name);
}
async function withRoleLock<T>(name: string, fn: () => Promise<T>): Promise<T | undefined> {
    if (pendingRoles.value.has(name)) return undefined;
    pendingRoles.value = new Set([...pendingRoles.value, name]);
    try {
        return await fn();
    } finally {
        const next = new Set(pendingRoles.value);
        next.delete(name);
        pendingRoles.value = next;
    }
}

function reportErr(err: unknown) {
    emit('error', err instanceof ApiError ? err.message : String(err));
}

// ── Description editor ───────────────────────────────────────────────
//
// Local drafts persist while the role is being edited; the input value
// reads from the draft when present, falling back to the role's saved
// description. `isDirty` drives the Save / Discard buttons.
const descDrafts = ref<Record<string, string>>({});
const justSavedRoles = ref(new Set<string>());

function descValue(role: AdminRole): string {
    return descDrafts.value[role.name] ?? role.description ?? '';
}
function isDescDirty(role: AdminRole): boolean {
    if (!(role.name in descDrafts.value)) return false;
    return descDrafts.value[role.name] !== (role.description ?? '');
}
function onDescInput(roleName: string, value: string) {
    descDrafts.value = { ...descDrafts.value, [roleName]: value };
}
function onDescDiscard(roleName: string) {
    const next = { ...descDrafts.value };
    delete next[roleName];
    descDrafts.value = next;
}
async function onDescSave(role: AdminRole) {
    if (!isDescDirty(role)) return;
    const draft = descValue(role).trim();
    await withRoleLock(role.name, async () => {
        try {
            const updated = await patchAdminRole(role.name, { description: draft || null });
            emit('upsert-role', updated);
            const nextDrafts = { ...descDrafts.value };
            delete nextDrafts[role.name];
            descDrafts.value = nextDrafts;
            justSavedRoles.value = new Set([...justSavedRoles.value, role.name]);
            setTimeout(() => {
                const s = new Set(justSavedRoles.value);
                s.delete(role.name);
                justSavedRoles.value = s;
            }, 1500);
        } catch (err) {
            reportErr(err);
        }
    });
}

// ── Capability toggle (called from the modal) ───────────────────────
//
// Optimistic — the click flips the local state immediately via an emit
// to the parent, then fires the API in the background. On failure we
// emit again with the rollback set so the UI reflects reality. The
// modal stays open across grants so users can edit several tokens in
// one session.
async function onToggleCapability(role: AdminRole, capKey: string, want: boolean) {
    const granted = role.capabilities.includes(capKey);
    if (granted === want) return;
    const next = want
        ? [...role.capabilities, capKey]
        : role.capabilities.filter(c => c !== capKey);
    emit('capability-change', role.name, next);
    await withRoleLock(role.name, async () => {
        try {
            if (want) await grantRoleCapability(role.name, capKey);
            else await revokeRoleCapability(role.name, capKey);
        } catch (err) {
            // Roll back on failure.
            emit('capability-change', role.name, role.capabilities);
            reportErr(err);
        }
    });
}

// ── Capability modal wiring ─────────────────────────────────────────
//
// The modal stays bound to the role *by name*, not by snapshot — so
// when the parent patches the roles list (after grant/revoke), the
// modal sees the latest capability set without needing to be torn
// down + remounted on every toggle.
const editingRoleName = ref<string | null>(null);
const editingRole = computed(() =>
    props.roles.find(r => r.name === editingRoleName.value) ?? null
);

function openCapsModal(role: AdminRole) {
    editingRoleName.value = role.name;
}
function closeCapsModal() {
    editingRoleName.value = null;
}
async function onModalGrant(token: string) {
    if (!editingRole.value) return;
    await onToggleCapability(editingRole.value, token, true);
}
async function onModalRevoke(token: string) {
    if (!editingRole.value) return;
    await onToggleCapability(editingRole.value, token, false);
}

// ── Role delete ─────────────────────────────────────────────────────
async function onDeleteRole(role: AdminRole) {
    if (!window.confirm(t('admin.roles.removeConfirm', { name: role.name }))) return;
    await withRoleLock(role.name, async () => {
        try {
            await deleteAdminRole(role.name);
            emit('remove-role', role.name);
        } catch (err) {
            reportErr(err);
        }
    });
}

// ── Add-role modal ──────────────────────────────────────────────────
const addOpen = ref(false);
const addForm = ref({ name: '', description: '' });
const adding = ref(false);

watch(addOpen, (open) => {
    if (open) addForm.value = { name: '', description: '' };
});

async function submitAdd() {
    const name = addForm.value.name.trim();
    if (!name) return;
    adding.value = true;
    try {
        const created = await upsertAdminRole({
            name,
            description: addForm.value.description.trim() || null
        });
        emit('upsert-role', created);
        addOpen.value = false;
    } catch (err) {
        reportErr(err);
    } finally {
        adding.value = false;
    }
}

// ── Capability summary ─────────────────────────────────────────────
//
// The role card shows a one-glance summary instead of the full grid —
// the modal now owns the granular editing surface. Splits the role's
// stored capabilities into global tokens + per-guild grant counts.
const SCOPED_GUILD_RE = /^guild:([^.:]+)\.(message|manage)$/;

interface CapSummary {
    global: string[];
    perGuildCount: number;
    unknown: string[];
}

function summariseCaps(role: AdminRole): CapSummary {
    const global: string[] = [];
    let perGuild = 0;
    const unknown: string[] = [];
    const knownGlobal = new Set<string>(GLOBAL_CAPABILITY_KEYS);
    for (const cap of role.capabilities) {
        if (knownGlobal.has(cap)) global.push(cap);
        else if (SCOPED_GUILD_RE.test(cap)) perGuild += 1;
        else unknown.push(cap);
    }
    return { global, perGuildCount: perGuild, unknown };
}
</script>

<template>
    <div class="panel">
        <header class="toolbar">
            <button type="button" class="primary" @click="addOpen = true">
                <Icon icon="material-symbols:add-rounded" width="16" height="16" />
                {{ $t('admin.roles.add') }}
            </button>
        </header>

        <p v-if="roles.length === 0" class="muted empty">{{ $t('admin.roles.empty') }}</p>

        <ul v-else class="role-list">
            <li v-for="role in roles" :key="role.name" class="role-card">
                <header class="role-head">
                    <h3 class="role-name">{{ role.name }}</h3>
                    <button
                        type="button"
                        class="icon-btn danger"
                        :disabled="isRolePending(role.name)"
                        :title="$t('admin.roles.remove')"
                        :aria-label="$t('admin.roles.remove')"
                        @click="onDeleteRole(role)"
                    >
                        <Icon icon="material-symbols:delete-outline-rounded" width="18" height="18" />
                    </button>
                </header>

                <div class="desc-row">
                    <input
                        type="text"
                        class="desc-input"
                        :value="descValue(role)"
                        :disabled="isRolePending(role.name)"
                        :placeholder="$t('admin.roles.descriptionPlaceholder')"
                        @input="onDescInput(role.name, ($event.target as HTMLInputElement).value)"
                        @keydown.enter.prevent="onDescSave(role)"
                    />
                    <button
                        v-if="isDescDirty(role)"
                        type="button"
                        class="ghost"
                        :disabled="isRolePending(role.name)"
                        @click="onDescDiscard(role.name)"
                    >{{ $t('admin.roles.discardChanges') }}</button>
                    <button
                        type="button"
                        class="primary small"
                        :disabled="!isDescDirty(role) || isRolePending(role.name)"
                        @click="onDescSave(role)"
                    >{{ $t('admin.roles.saveDescription') }}</button>
                    <span v-if="justSavedRoles.has(role.name)" class="saved-flash">
                        <Icon icon="material-symbols:check-rounded" width="14" height="14" />
                        {{ $t('admin.roles.saved') }}
                    </span>
                </div>

                <!-- Capability summary + edit entry point. The full grid
                     moved into RoleCapabilityModal for headroom — both
                     the global tokens and the per-guild scopes need
                     more space than the inline checkbox list could
                     afford. -->
                <div class="cap-summary">
                    <div class="summary-tags">
                        <span
                            v-for="key in summariseCaps(role).global"
                            :key="key"
                            class="cap-tag"
                        >{{ key }}</span>
                        <span
                            v-if="summariseCaps(role).perGuildCount > 0"
                            class="cap-tag scoped"
                        >
                            <Icon icon="material-symbols:groups-outline-rounded" width="14" height="14" />
                            {{ $t('admin.roles.perGuildSummary', { count: summariseCaps(role).perGuildCount }) }}
                        </span>
                        <span
                            v-for="cap in summariseCaps(role).unknown"
                            :key="cap"
                            class="cap-tag unknown"
                            :title="cap"
                        >?  {{ cap }}</span>
                        <span
                            v-if="summariseCaps(role).global.length === 0
                                && summariseCaps(role).perGuildCount === 0
                                && summariseCaps(role).unknown.length === 0"
                            class="muted"
                        >{{ $t('admin.roles.noGlobalCaps') }}</span>
                    </div>
                    <button
                        type="button"
                        class="ghost"
                        :disabled="isRolePending(role.name)"
                        @click="openCapsModal(role)"
                    >
                        <Icon icon="material-symbols:edit-outline-rounded" width="16" height="16" />
                        {{ $t('admin.roles.editCapabilities') }}
                    </button>
                </div>

                <p v-if="role.capabilities.length === 0" class="muted no-caps">
                    {{ $t('admin.roles.noCapabilities') }}
                </p>
            </li>
        </ul>

        <RoleCapabilityModal
            :role="editingRole"
            :capability-catalog="capabilityCatalog"
            :pending="editingRole ? isRolePending(editingRole.name) : false"
            @close="closeCapsModal"
            @grant="onModalGrant"
            @revoke="onModalRevoke"
        />

        <AppModal :visible="addOpen" :title="$t('admin.roles.add')" @close="addOpen = false">
            <form class="add-body" @submit.prevent="submitAdd">
                <label class="field">
                    <span>{{ $t('admin.roles.nameLabel') }}</span>
                    <input v-model="addForm.name" type="text" required autofocus />
                </label>
                <label class="field">
                    <span>{{ $t('admin.roles.descriptionLabel') }}</span>
                    <input
                        v-model="addForm.description"
                        type="text"
                        :placeholder="$t('admin.roles.descriptionPlaceholder')"
                    />
                </label>
                <footer class="actions">
                    <button type="button" class="ghost" @click="addOpen = false">{{ $t('common.cancel') }}</button>
                    <button type="submit" class="primary" :disabled="adding">{{ $t('admin.roles.addSubmit') }}</button>
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
    justify-content: flex-end;
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
.primary.small { padding: 0.3rem 0.7rem; font-size: 0.85rem; }
.primary:disabled { opacity: 0.55; cursor: default; }
.ghost {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.3rem 0.7rem;
    background: none;
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text);
    cursor: pointer;
    font: inherit;
    font-size: 0.85rem;
}
.ghost:hover { background: var(--bg-surface-hover); }
.ghost:disabled { opacity: 0.55; cursor: default; }
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

.role-list {
    list-style: none;
    margin: 0;
    padding: 0;
    /* Responsive grid — fits one wide card on narrow screens, two or
       more side-by-side on wide screens. The 380px floor is the
       smallest card layout that doesn't force the description input
       below the role name. */
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: 0.7rem;
    align-items: start;
}
.role-card {
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 0.85rem 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.7rem;
    min-height: 12rem;
}
.role-head {
    display: flex;
    align-items: center;
    gap: 0.6rem;
}
.role-name {
    margin: 0;
    font-size: 1rem;
    color: var(--text-strong);
    flex: 1;
    min-width: 0;
}

.desc-row {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    flex-wrap: wrap;
}
.desc-input {
    flex: 1 1 200px;
    min-width: 0;
    padding: 0.4rem 0.55rem;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg-surface);
    color: var(--text);
    font: inherit;
    font-size: 0.88rem;
}
.saved-flash {
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
    color: var(--accent-text-strong);
    font-size: 0.78rem;
    font-weight: 500;
}

.cap-summary {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
}
.summary-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
    flex: 1;
    min-width: 0;
}
.cap-tag {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.15rem 0.55rem;
    background: var(--accent-bg);
    color: var(--accent-text-strong);
    border-radius: 999px;
    font-family: ui-monospace, SFMono-Regular, monospace;
    font-size: 0.75rem;
}
.cap-tag.scoped {
    background: var(--bg-surface-2);
    color: var(--text);
    font-family: inherit;
}
.cap-tag.unknown {
    background: rgba(239, 68, 68, 0.12);
    color: var(--danger);
}

.no-caps {
    margin: 0;
    color: var(--danger);
    font-size: 0.82rem;
}
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
.field input {
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
</style>
