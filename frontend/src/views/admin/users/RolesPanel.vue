<script setup lang="ts">
import { computed, ref } from 'vue';
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

const props = defineProps<{
    roles: AdminRole[];
    /** Authoritative catalog from GET /api/admin/capabilities. Falls
     *  back to the bundled key list if the parent didn't fetch (e.g.
     *  the endpoint failed). The hard-coded mirror exists precisely so
     *  the UI keeps working in that degraded state. */
    capabilityCatalog?: AdminCapabilityCatalogItem[];
}>();

const { t } = useI18n();

interface AdminCapabilityDef {
    key: string;
    description: string;
}

// Prefer the server-provided catalog; fall back to the bundled mirror
// if the parent didn't fetch (e.g. /api/admin/capabilities errored).
// Descriptions still resolve through i18n so they match the active
// locale, with the server's description as a fallback when no i18n key
// matches (e.g. a new capability was added before translations land).
const capabilities = computed<AdminCapabilityDef[]>(() => {
    const source = props.capabilityCatalog?.length
        ? props.capabilityCatalog.map(item => item.key)
        : ADMIN_CAPABILITY_KEYS as readonly string[];
    return source.map(key => {
        const i18nKey = `admin.capabilityDesc.${key}`;
        const localized = t(i18nKey);
        const fromServer = props.capabilityCatalog?.find(c => c.key === key)?.description;
        return {
            key,
            // i18n returns the key itself when no translation exists —
            // fall back to the server-provided description in that case.
            description: localized === i18nKey ? (fromServer ?? key) : localized
        };
    });
});

const emit = defineEmits<{
    (e: 'changed'): void;
    (e: 'error', message: string): void;
}>();

const formName = ref('');
const formDescription = ref('');
const submitting = ref(false);

// Per-role UI state: local description draft + which capability is about
// to be granted. Keyed by role.name; refreshed implicitly when the roles
// array prop changes.
const descDrafts = ref<Record<string, string>>({});
const capPicks = ref<Record<string, string>>({});
// Per-role lock so rapid clicks on grant/revoke/save/delete don't fire
// concurrent mutations against the same role.
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

function descriptionDraft(role: AdminRole): string {
    return descDrafts.value[role.name] ?? role.description ?? '';
}

function capPickFor(role: AdminRole): string {
    return capPicks.value[role.name] ?? '';
}

function availableCapsFor(role: AdminRole): AdminCapabilityDef[] {
    const granted = new Set(role.capabilities);
    return capabilities.value.filter(c => !granted.has(c.key));
}

const knownCapabilities = computed(() => capabilities.value);

function handleErr(err: unknown) {
    emit('error', err instanceof ApiError ? err.message : String(err));
}

async function onAddRole() {
    const name = formName.value.trim();
    if (!name) return;
    submitting.value = true;
    try {
        await upsertAdminRole({ name, description: formDescription.value.trim() || null });
        formName.value = '';
        formDescription.value = '';
        emit('changed');
    } catch (err) {
        handleErr(err);
    } finally {
        submitting.value = false;
    }
}

async function onSaveDescription(role: AdminRole) {
    const draft = descriptionDraft(role).trim();
    if (draft === (role.description ?? '')) return;
    await withRoleLock(role.name, async () => {
        try {
            await patchAdminRole(role.name, { description: draft || null });
            delete descDrafts.value[role.name];
            emit('changed');
        } catch (err) {
            handleErr(err);
        }
    });
}

async function onDeleteRole(role: AdminRole) {
    if (isRolePending(role.name)) return;
    if (!window.confirm(t('admin.roles.removeConfirm', { name: role.name }))) return;
    await withRoleLock(role.name, async () => {
        try {
            await deleteAdminRole(role.name);
            emit('changed');
        } catch (err) {
            handleErr(err);
        }
    });
}

async function onGrantCap(role: AdminRole) {
    const cap = capPickFor(role);
    if (!cap) return;
    await withRoleLock(role.name, async () => {
        try {
            await grantRoleCapability(role.name, cap);
            capPicks.value[role.name] = '';
            emit('changed');
        } catch (err) {
            handleErr(err);
        }
    });
}

async function onRevokeCap(role: AdminRole, capability: string) {
    await withRoleLock(role.name, async () => {
        try {
            await revokeRoleCapability(role.name, capability);
            emit('changed');
        } catch (err) {
            handleErr(err);
        }
    });
}
</script>

<template>
    <div class="panel">
        <form class="add-form" @submit.prevent="onAddRole">
            <h3>{{ $t('admin.roles.add') }}</h3>
            <div class="fields">
                <label>
                    <span>{{ $t('admin.roles.nameLabel') }}</span>
                    <input v-model="formName" type="text" required />
                </label>
                <label class="desc-field">
                    <span>{{ $t('admin.roles.descriptionLabel') }}</span>
                    <input v-model="formDescription" type="text" :placeholder="$t('admin.roles.descriptionPlaceholder')" />
                </label>
            </div>
            <button type="submit" class="primary" :disabled="submitting">
                {{ $t('admin.roles.addSubmit') }}
            </button>
        </form>

        <section class="catalog">
            <h3>{{ $t('admin.capabilitiesCatalog') }}</h3>
            <ul>
                <li v-for="c in knownCapabilities" :key="c.key">
                    <code>{{ c.key }}</code>
                    <span class="muted"> — {{ c.description }}</span>
                </li>
            </ul>
        </section>

        <h3 class="list-heading">{{ $t('admin.roles.title') }}</h3>
        <p v-if="roles.length === 0" class="muted empty">{{ $t('admin.roles.empty') }}</p>
        <ul v-else class="role-list">
            <li v-for="role in roles" :key="role.name" class="role-card">
                <header class="role-head">
                    <h4>{{ role.name }}</h4>
                    <button
                        type="button"
                        class="danger"
                        :disabled="isRolePending(role.name)"
                        :title="$t('admin.roles.remove')"
                        @click="onDeleteRole(role)"
                    >
                        <Icon icon="material-symbols:delete-rounded" width="18" height="18" />
                    </button>
                </header>
                <div class="desc-row">
                    <input
                        type="text"
                        :value="descriptionDraft(role)"
                        :disabled="isRolePending(role.name)"
                        :placeholder="$t('admin.roles.descriptionPlaceholder')"
                        @input="descDrafts[role.name] = ($event.target as HTMLInputElement).value"
                        @blur="onSaveDescription(role)"
                        @keydown.enter.prevent="onSaveDescription(role)"
                    />
                </div>

                <div class="caps-row">
                    <span class="caps-label">{{ $t('admin.roles.capabilities') }}:</span>
                    <span v-if="role.capabilities.length === 0" class="muted">{{ $t('admin.roles.noCapabilities') }}</span>
                    <span
                        v-for="cap in role.capabilities"
                        :key="cap"
                        class="cap-chip"
                    >
                        <code>{{ cap }}</code>
                        <button
                            type="button"
                            class="chip-remove"
                            :disabled="isRolePending(role.name)"
                            :title="$t('admin.roles.revoke')"
                            @click="onRevokeCap(role, cap)"
                        >×</button>
                    </span>
                </div>

                <div v-if="availableCapsFor(role).length > 0" class="grant-row">
                    <select
                        :value="capPickFor(role)"
                        :disabled="isRolePending(role.name)"
                        @change="capPicks[role.name] = ($event.target as HTMLSelectElement).value"
                    >
                        <option value="" disabled>{{ $t('admin.roles.selectCapability') }}</option>
                        <option v-for="c in availableCapsFor(role)" :key="c.key" :value="c.key">{{ c.key }}</option>
                    </select>
                    <button
                        type="button"
                        class="primary small"
                        :disabled="!capPickFor(role) || isRolePending(role.name)"
                        @click="onGrantCap(role)"
                    >
                        {{ $t('admin.roles.grant') }}
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
.add-form,
.catalog {
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 0.75rem 1rem;
    background: var(--bg-surface);
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
}
.add-form h3,
.catalog h3 { margin: 0; font-size: 0.9rem; }
.catalog ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    font-size: 0.85rem;
}
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
.fields input {
    padding: 0.35rem 0.5rem;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg-surface);
    color: var(--text);
    font: inherit;
    font-size: 0.9rem;
}
.desc-field { grid-column: span 2; }
@media (max-width: 520px) { .desc-field { grid-column: span 1; } }
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
.primary.small { padding: 0.3rem 0.7rem; font-size: 0.85rem; }
.primary:disabled { opacity: 0.5; cursor: default; }
.list-heading { margin: 0; font-size: 0.95rem; }
.role-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
}
.role-card {
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 0.65rem 0.85rem;
    background: var(--bg-surface);
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
}
.role-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
}
.role-head h4 {
    margin: 0;
    font-size: 0.95rem;
    color: var(--text-strong);
}
.desc-row input {
    width: 100%;
    padding: 0.3rem 0.5rem;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg-surface);
    color: var(--text);
    font: inherit;
    font-size: 0.85rem;
}
.caps-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.85rem;
}
.caps-label { color: var(--text-muted); }
.cap-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.15rem 0.35rem 0.15rem 0.5rem;
    background: var(--accent-bg);
    color: var(--accent-text-strong);
    border-radius: 999px;
    font-size: 0.78rem;
}
.cap-chip code { background: transparent; padding: 0; }
.chip-remove {
    background: none;
    border: none;
    color: inherit;
    cursor: pointer;
    padding: 0 2px;
    font-size: 1rem;
    line-height: 1;
}
.chip-remove:hover { color: var(--danger); }
.grant-row {
    display: flex;
    gap: 0.4rem;
    align-items: center;
}
.grant-row select {
    flex: 1;
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
.muted { color: var(--text-muted); }
.empty { padding: 1rem; text-align: center; }
</style>
