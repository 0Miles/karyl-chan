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
import { ADMIN_CAPABILITY_KEYS } from '../../../libs/admin-capabilities';
import AppModal from '../../../components/AppModal.vue';

const props = defineProps<{
    roles: AdminRole[];
    /** Authoritative catalog from GET /api/admin/capabilities. Falls
     *  back to the bundled key list if the parent fetch failed. */
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

interface CapabilityDef { key: string; description: string; }

// Prefer the server catalog; fall back to the bundled key list. Each
// description is resolved via i18n with the server-provided text as a
// final fallback so a brand-new capability key shows *something*
// before the translation lands.
const capabilities = computed<CapabilityDef[]>(() => {
    const source = props.capabilityCatalog?.length
        ? props.capabilityCatalog.map(item => item.key)
        : (ADMIN_CAPABILITY_KEYS as readonly string[]);
    return source.map(key => {
        const i18nKey = `admin.capabilityDesc.${key}`;
        const localized = t(i18nKey);
        const fromServer = props.capabilityCatalog?.find(c => c.key === key)?.description;
        return {
            key,
            description: localized === i18nKey ? (fromServer ?? '') : localized
        };
    });
});

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

// ── Description editor ────────────────────────────────────────────
//
// Local drafts persist while the role is being edited; the input value
// reads from the draft when present, falling back to the role's saved
// description. `isDirty` drives the Save / Discard buttons. The drafts
// outlive a parent re-render because they're keyed by role name.
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
            // Drop the draft so descValue falls back to the persisted
            // value (now matched by what the server returned).
            const nextDrafts = { ...descDrafts.value };
            delete nextDrafts[role.name];
            descDrafts.value = nextDrafts;
            // Brief "Saved" indicator next to the field.
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

// ── Capability toggle ────────────────────────────────────────────
//
// Optimistic — the click flips the checkbox immediately via an emit
// to the parent, then fires the API in the background. On failure we
// emit again with the rollback set so the UI reflects reality.
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

// ── Role delete ──────────────────────────────────────────────────
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

// ── Add-role modal ──────────────────────────────────────────────
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

function grantedCountFor(role: AdminRole): { granted: number; total: number } {
    return { granted: role.capabilities.length, total: capabilities.value.length };
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
                    <span class="role-meta">{{ $t('admin.roles.capabilitiesGrantedCount', grantedCountFor(role)) }}</span>
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

                <fieldset class="cap-grid">
                    <legend class="cap-legend">{{ $t('admin.roles.capabilities') }}</legend>
                    <label
                        v-for="cap in capabilities"
                        :key="cap.key"
                        :class="['cap', { granted: role.capabilities.includes(cap.key) }]"
                    >
                        <input
                            type="checkbox"
                            :checked="role.capabilities.includes(cap.key)"
                            :disabled="isRolePending(role.name)"
                            @change="onToggleCapability(role, cap.key, ($event.target as HTMLInputElement).checked)"
                        />
                        <div class="cap-text">
                            <code class="cap-key">{{ cap.key }}</code>
                            <span v-if="cap.description" class="cap-desc">{{ cap.description }}</span>
                        </div>
                    </label>
                    <!-- Capabilities the server still has on this role
                         but our catalog doesn't know about (e.g. one
                         that was removed from the spec). Render so
                         the user can revoke them — without rendering
                         the unknown set, they'd be invisible-but-active. -->
                    <label
                        v-for="cap in role.capabilities.filter(c => !capabilities.some(known => known.key === c))"
                        :key="`unknown-${cap}`"
                        class="cap granted unknown"
                    >
                        <input
                            type="checkbox"
                            checked
                            :disabled="isRolePending(role.name)"
                            @change="onToggleCapability(role, cap, false)"
                        />
                        <div class="cap-text">
                            <code class="cap-key">{{ cap }}</code>
                            <span class="cap-desc">unknown capability</span>
                        </div>
                    </label>
                </fieldset>

                <p v-if="role.capabilities.length === 0" class="muted no-caps">
                    {{ $t('admin.roles.noCapabilities') }}
                </p>
            </li>
        </ul>

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
    display: flex;
    flex-direction: column;
    gap: 0.7rem;
}
.role-card {
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 0.85rem 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.7rem;
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
}
.role-meta {
    margin-left: auto;
    font-size: 0.78rem;
    color: var(--text-muted);
    background: var(--bg-surface-2);
    border-radius: 999px;
    padding: 0.15rem 0.55rem;
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
    background: var(--bg);
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

.cap-grid {
    border: 1px solid var(--border);
    border-radius: 6px;
    margin: 0;
    padding: 0.5rem 0.7rem 0.7rem;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 0.4rem 0.6rem;
}
.cap-legend {
    padding: 0 0.3rem;
    font-size: 0.78rem;
    color: var(--text-muted);
}
.cap {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
    padding: 0.45rem 0.55rem;
    border-radius: 6px;
    cursor: pointer;
    transition: background 0.12s;
}
.cap:hover { background: var(--bg-surface-hover); }
.cap input[type="checkbox"] {
    margin-top: 0.15rem;
    accent-color: var(--accent);
    width: 16px;
    height: 16px;
    cursor: pointer;
    flex-shrink: 0;
}
.cap.granted {
    background: var(--accent-bg);
}
.cap.granted:hover {
    background: color-mix(in srgb, var(--accent-bg) 80%, var(--bg-surface-hover) 20%);
}
.cap-text { display: flex; flex-direction: column; gap: 0.1rem; min-width: 0; }
.cap-key {
    font-size: 0.82rem;
    font-weight: 500;
    color: var(--text-strong);
    background: transparent;
    padding: 0;
}
.cap-desc {
    font-size: 0.74rem;
    color: var(--text-muted);
    line-height: 1.3;
}
.cap.unknown { opacity: 0.75; }

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
    background: var(--bg);
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
