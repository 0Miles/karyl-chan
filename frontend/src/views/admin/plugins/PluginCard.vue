<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { Icon } from '@iconify/vue';
import AppModal from '../../../components/AppModal.vue';
import AppConfirmDialog from '../../../components/AppConfirmDialog.vue';
import {
    approvePluginScopes,
    deletePlugin,
    generatePluginSetupSecret,
    getPluginConfig,
    setPluginConfig,
    setPluginEnabled,
    type PluginConfigField,
    type PluginRecord
} from '../../../api/plugins';

const props = defineProps<{
    plugin: PluginRecord;
}>();

const emit = defineEmits<{
    (e: 'updated', plugin: { id: number; pluginKey: string; enabled: boolean }): void;
    (e: 'scopes-updated', payload: { id: number; approvedScopes: string[]; pendingScopes: string[] }): void;
    (e: 'deleted', id: number): void;
}>();

const { t } = useI18n();

const open = ref(false);
const saving = ref(false);
const error = ref<string | null>(null);

// Same single-source pattern that finally fixed the behaviors toggle:
// drive the visual state from a local ref that we update optimistically
// on click and reconcile from the prop on success/failure.
const enabledLocal = ref(props.plugin.enabled);
// Watch the prop in case the parent reloads the list and hands us a
// fresh PluginRecord with a different `enabled`.
watch(() => props.plugin.enabled, (next) => { enabledLocal.value = next; });

// Plugin-level config (admin-editable). Loaded lazily on the first
// expand so collapsed cards don't fan out N+1 GETs at page load.
// Each field's "set" status drives the secret placeholder UX —
// secrets come back as "********" sentinel; keeping the sentinel in
// the form means the PUT will skip re-encrypting when the user didn't
// change it (see backend route comment).
const configSchema = ref<PluginConfigField[]>([]);
const configValues = reactive<Record<string, string>>({});
const configLoaded = ref(false);
const configLoading = ref(false);
const configSaving = ref(false);
const configError = ref<string | null>(null);
const configSavedAt = ref<number | null>(null);

const hasConfigSchema = computed(() =>
    (props.plugin.manifest?.config_schema?.length ?? 0) > 0
);

async function loadConfig() {
    if (configLoaded.value || configLoading.value) return;
    configLoading.value = true;
    configError.value = null;
    try {
        const r = await getPluginConfig(props.plugin.id);
        configSchema.value = r.schema;
        for (const v of r.values) {
            // Use empty string for "unset" so two-way binding has a real
            // string. The save path treats "" + non-secret type as
            // "store empty value" which round-trips fine.
            configValues[v.key] = v.value ?? '';
        }
        // Seed defaults for keys the server didn't return (e.g. brand-
        // new schema field) so the form renders something to type into.
        for (const f of r.schema) {
            if (!(f.key in configValues)) {
                configValues[f.key] = (f.default as string | undefined) ?? '';
            }
        }
        configLoaded.value = true;
    } catch (err) {
        configError.value = err instanceof Error ? err.message : String(err);
    } finally {
        configLoading.value = false;
    }
}

async function saveConfig() {
    if (configSaving.value) return;
    configSaving.value = true;
    configError.value = null;
    try {
        // Send everything in the form back. The backend skips secret
        // fields whose value is still the "********" sentinel, so
        // unchanged secrets stay encrypted at rest.
        await setPluginConfig(props.plugin.id, { ...configValues });
        configSavedAt.value = Date.now();
    } catch (err) {
        configError.value = err instanceof Error ? err.message : String(err);
    } finally {
        configSaving.value = false;
    }
}

// Lazily fetch config the first time the card opens AND there is a
// schema to render. Subsequent opens reuse the in-memory state.
watch(open, (isOpen) => {
    if (isOpen && hasConfigSchema.value) void loadConfig();
});

const statusColor = computed(() =>
    props.plugin.status === 'active' ? 'var(--success, #16a34a)' : 'var(--text-muted)'
);
const statusLabel = computed(() =>
    props.plugin.status === 'active'
        ? t('admin.plugins.statusActive')
        : t('admin.plugins.statusInactive')
);

const lastHeartbeat = computed(() => {
    if (!props.plugin.lastHeartbeatAt) return t('admin.plugins.neverHeartbeat');
    const d = new Date(props.plugin.lastHeartbeatAt);
    const ageSec = Math.floor((Date.now() - d.getTime()) / 1000);
    if (ageSec < 60) return t('admin.plugins.heartbeatJustNow');
    if (ageSec < 3600) return t('admin.plugins.heartbeatMinutesAgo', { n: Math.floor(ageSec / 60) });
    if (ageSec < 86400) return t('admin.plugins.heartbeatHoursAgo', { n: Math.floor(ageSec / 3600) });
    return d.toLocaleString();
});

const dmBehaviorCount = computed(() => props.plugin.manifest?.dm_behaviors?.length ?? 0);
const guildFeatureCount = computed(() => props.plugin.manifest?.guild_features?.length ?? 0);
// Top-level (truly global) commands and per-feature commands count
// separately — they have different runtime gating semantics, so the
// admin UI surfaces both.
const globalCommandCount = computed(() => props.plugin.manifest?.commands?.length ?? 0);
const featureCommandCount = computed(() =>
    (props.plugin.manifest?.guild_features ?? []).reduce(
        (n, f) => n + (f.commands?.length ?? 0), 0
    )
);
const commandCount = computed(() => globalCommandCount.value + featureCommandCount.value);
const rpcScopes = computed(() => props.plugin.manifest?.rpc_methods_used ?? []);
const description = computed(() => props.plugin.manifest?.plugin.description ?? '');

// ── Scope approval ──────────────────────────────────────────────────
const approvedScopes = ref<string[]>(props.plugin.approvedScopes ?? []);
const pendingScopes = ref<string[]>(props.plugin.pendingScopes ?? []);

// Keep local refs in sync when the parent reloads and passes fresh data
watch(() => props.plugin.approvedScopes, (v) => { approvedScopes.value = v ?? []; });
watch(() => props.plugin.pendingScopes, (v) => { pendingScopes.value = v ?? []; });

const approveModalOpen = ref(false);
const approving = ref(false);
const approveError = ref<string | null>(null);

async function confirmApproveScopes() {
    if (approving.value) return;
    approving.value = true;
    approveError.value = null;
    try {
        const result = await approvePluginScopes(props.plugin.id);
        approvedScopes.value = result.approved;
        pendingScopes.value = result.pending;
        approveModalOpen.value = false;
        emit('scopes-updated', {
            id: props.plugin.id,
            approvedScopes: result.approved,
            pendingScopes: result.pending,
        });
    } catch (err) {
        approveError.value = err instanceof Error ? err.message : String(err);
    } finally {
        approving.value = false;
    }
}

// ── Setup secret ────────────────────────────────────────────────────
const setupSecretConfirmOpen = ref(false);
const setupSecretResultOpen = ref(false);
const setupSecretGenerating = ref(false);
const setupSecretError = ref<string | null>(null);
const setupSecretValue = ref('');
const setupSecretCopied = ref(false);
const setupSecretAcknowledged = ref(false);

async function confirmGenerateSetupSecret() {
    if (setupSecretGenerating.value) return;
    setupSecretGenerating.value = true;
    setupSecretError.value = null;
    try {
        const result = await generatePluginSetupSecret(props.plugin.pluginKey);
        setupSecretValue.value = result.setupSecret;
        setupSecretAcknowledged.value = false;
        setupSecretCopied.value = false;
        setupSecretConfirmOpen.value = false;
        setupSecretResultOpen.value = true;
    } catch (err) {
        setupSecretError.value = err instanceof Error ? err.message : String(err);
    } finally {
        setupSecretGenerating.value = false;
    }
}

async function copySetupSecret() {
    try {
        await navigator.clipboard.writeText(setupSecretValue.value);
        setupSecretCopied.value = true;
        setTimeout(() => { setupSecretCopied.value = false; }, 2000);
    } catch {
        // Fallback: select the input text
        const el = document.getElementById(`setup-secret-input-${props.plugin.id}`) as HTMLInputElement | null;
        if (el) {
            el.select();
            el.setSelectionRange(0, el.value.length);
        }
    }
}

function closeSecretResult() {
    setupSecretResultOpen.value = false;
    setupSecretValue.value = '';
    setupSecretAcknowledged.value = false;
    setupSecretCopied.value = false;
}

async function onToggleEnabled() {
    if (saving.value) return;
    const next = !enabledLocal.value;
    enabledLocal.value = next;
    saving.value = true;
    error.value = null;
    try {
        const updated = await setPluginEnabled(props.plugin.id, next);
        emit('updated', updated);
    } catch (err) {
        error.value = err instanceof Error ? err.message : String(err);
        enabledLocal.value = props.plugin.enabled;
    } finally {
        saving.value = false;
    }
}

// ── Delete (inactive plugins only) ──────────────────────────────────
const menuOpen = ref(false);
const deleteModalOpen = ref(false);
const deleting = ref(false);
const deleteError = ref<string | null>(null);

function openMenu(e: Event) {
    e.stopPropagation();
    if (menuOpen.value) {
        closeMenu();
        return;
    }
    menuOpen.value = true;
    // One-shot click-outside: anything that bubbles to document closes
    // the menu. The next tick (via setTimeout 0) skips the click that
    // just opened it.
    setTimeout(() => document.addEventListener('click', closeMenu, { once: true }), 0);
}

function closeMenu() {
    menuOpen.value = false;
    document.removeEventListener('click', closeMenu);
}

onBeforeUnmount(() => {
    document.removeEventListener('click', closeMenu);
});

function openDeleteModal() {
    closeMenu();
    deleteModalOpen.value = true;
    deleteError.value = null;
}

async function confirmDelete() {
    if (deleting.value) return;
    deleting.value = true;
    deleteError.value = null;
    try {
        await deletePlugin(props.plugin.id);
        deleteModalOpen.value = false;
        emit('deleted', props.plugin.id);
    } catch (err) {
        deleteError.value = err instanceof Error ? err.message : String(err);
    } finally {
        deleting.value = false;
    }
}
</script>

<template>
    <article :class="['card', { 'is-disabled': !enabledLocal }]">
        <header class="card-head">
            <button
                type="button"
                class="title-btn"
                @click="open = !open"
                :aria-expanded="open"
            >
                <Icon
                    :icon="open ? 'material-symbols:expand-less-rounded' : 'material-symbols:expand-more-rounded'"
                    width="18"
                    height="18"
                />
                <span class="title">{{ plugin.name }}</span>
                <span class="key">{{ plugin.pluginKey }}</span>
                <span class="version">v{{ plugin.version }}</span>
            </button>
            <span class="status-dot" :style="{ background: statusColor }" :title="statusLabel" />
            <span class="status-text">{{ statusLabel }}</span>
            <button
                v-if="pendingScopes.length > 0"
                type="button"
                class="pending-badge"
                :title="t('admin.plugins.scopes.pendingHint', { n: pendingScopes.length })"
                @click.stop="approveModalOpen = true"
            >
                <Icon icon="material-symbols:security-rounded" width="13" height="13" />
                {{ t('admin.plugins.scopes.pendingCount', { n: pendingScopes.length }) }}
            </button>
            <button
                type="button"
                role="switch"
                :class="['toggle', { on: enabledLocal }]"
                :title="enabledLocal ? t('admin.plugins.toggleEnabled') : t('admin.plugins.toggleDisabled')"
                :aria-checked="enabledLocal ? 'true' : 'false'"
                :disabled="saving"
                @click.stop="onToggleEnabled"
            >
                <span class="slider" aria-hidden="true"></span>
            </button>
            <!-- Three-dot menu: only for inactive plugins -->
            <div v-if="plugin.status === 'inactive'" class="more-wrap">
                <button
                    type="button"
                    class="more-btn"
                    :title="t('admin.plugins.menu.delete')"
                    @click="openMenu"
                >
                    <Icon icon="material-symbols:more-vert" width="16" height="16" />
                </button>
                <div v-if="menuOpen" class="more-menu" @click.stop>
                    <button type="button" class="more-menu-item danger" @click="openDeleteModal">
                        <Icon icon="material-symbols:delete-outline-rounded" width="14" height="14" />
                        {{ t('admin.plugins.menu.delete') }}
                    </button>
                </div>
            </div>
        </header>

        <div v-if="open" class="card-body">
            <p v-if="description" class="desc">{{ description }}</p>

            <div class="stats-row">
                <span class="stat" v-if="dmBehaviorCount > 0">
                    <Icon icon="material-symbols:forum-outline" width="14" height="14" />
                    {{ t('admin.plugins.dmBehaviorsCount', { n: dmBehaviorCount }) }}
                </span>
                <span class="stat" v-if="guildFeatureCount > 0">
                    <Icon icon="material-symbols:hub-outline" width="14" height="14" />
                    {{ t('admin.plugins.guildFeaturesCount', { n: guildFeatureCount }) }}
                </span>
                <span class="stat" v-if="commandCount > 0">
                    <Icon icon="material-symbols:terminal" width="14" height="14" />
                    {{ t('admin.plugins.commandsCount', { n: commandCount }) }}
                </span>
            </div>

            <dl class="meta">
                <div class="meta-row">
                    <dt>{{ t('admin.plugins.url') }}</dt>
                    <dd><code>{{ plugin.url }}</code></dd>
                </div>
                <div class="meta-row">
                    <dt>{{ t('admin.plugins.lastHeartbeat') }}</dt>
                    <dd>{{ lastHeartbeat }}</dd>
                </div>
                <div class="meta-row" v-if="approvedScopes.length > 0">
                    <dt>{{ t('admin.plugins.scopes.approved') }}</dt>
                    <dd>
                        <code v-for="s in approvedScopes" :key="s" class="scope-chip scope-chip--approved">{{ s }}</code>
                    </dd>
                </div>
                <div class="meta-row" v-if="pendingScopes.length > 0">
                    <dt>{{ t('admin.plugins.scopes.pending') }}</dt>
                    <dd class="pending-row">
                        <code v-for="s in pendingScopes" :key="s" class="scope-chip scope-chip--pending">{{ s }}</code>
                        <button type="button" class="approve-btn" :disabled="approving" @click="approveModalOpen = true">
                            <Icon icon="material-symbols:check-circle-outline-rounded" width="14" height="14" />
                            {{ t('admin.plugins.scopes.approveButton') }}
                        </button>
                    </dd>
                </div>
                <div class="meta-row" v-else-if="approvedScopes.length === 0 && rpcScopes.length > 0">
                    <dt>{{ t('admin.plugins.rpcScopes') }}</dt>
                    <dd>
                        <code v-for="s in rpcScopes" :key="s" class="scope-chip">{{ s }}</code>
                    </dd>
                </div>
            </dl>

            <!-- Plugin-level config editor. Only renders when the
                 plugin's manifest declares a `config_schema`; values
                 are loaded lazily on first expand. -->
            <section v-if="hasConfigSchema" class="config-section">
                <header class="config-header">
                    <h4>外掛設定</h4>
                    <span v-if="configSavedAt && (Date.now() - configSavedAt < 4000)" class="muted saved">已儲存</span>
                </header>
                <p v-if="configLoading" class="muted">載入中…</p>
                <p v-if="configError" class="error" role="alert">{{ configError }}</p>
                <div v-else-if="configLoaded" class="config-grid">
                    <label
                        v-for="field in configSchema"
                        :key="field.key"
                        :class="['config-field', { full: field.type === 'textarea' }]"
                    >
                        <span class="config-label">
                            {{ field.label }}
                            <span v-if="field.required" class="req" aria-hidden="true">*</span>
                            <span v-if="field.description" class="hint">{{ field.description }}</span>
                        </span>
                        <textarea
                            v-if="field.type === 'textarea'"
                            v-model="configValues[field.key]"
                            rows="3"
                            spellcheck="false"
                        />
                        <select
                            v-else-if="field.type === 'select' && field.options"
                            v-model="configValues[field.key]"
                        >
                            <option value="">—</option>
                            <option v-for="opt in field.options" :key="opt.value" :value="opt.value">
                                {{ opt.label }}
                            </option>
                        </select>
                        <input
                            v-else-if="field.type === 'boolean'"
                            type="checkbox"
                            :checked="configValues[field.key] === 'true'"
                            @change="(e) => { configValues[field.key] = (e.target as HTMLInputElement).checked ? 'true' : 'false'; }"
                        />
                        <input
                            v-else
                            v-model="configValues[field.key]"
                            :type="field.type === 'secret' ? 'password' : (field.type === 'number' ? 'number' : 'text')"
                            :placeholder="field.type === 'secret' ? '留空 = 不變更' : ''"
                            autocomplete="off"
                            spellcheck="false"
                        />
                    </label>
                    <div class="config-actions">
                        <button type="button" class="primary" :disabled="configSaving" @click="saveConfig">
                            {{ configSaving ? '儲存中…' : '儲存設定' }}
                        </button>
                    </div>
                </div>
            </section>

            <!-- Setup secret section -->
            <section class="setup-secret-section">
                <button
                    type="button"
                    class="setup-secret-btn"
                    @click="setupSecretConfirmOpen = true"
                >
                    <Icon icon="material-symbols:key-outline-rounded" width="14" height="14" />
                    {{ t('admin.plugins.setupSecret.button') }}
                </button>
            </section>

            <details v-if="plugin.manifest" class="manifest-fold">
                <summary>{{ t('admin.plugins.manifestRaw') }}</summary>
                <pre>{{ JSON.stringify(plugin.manifest, null, 2) }}</pre>
            </details>

            <p v-if="error" class="error" role="alert">{{ error }}</p>
        </div>
    </article>

    <!-- Setup secret: confirm modal -->
    <AppConfirmDialog
        :visible="setupSecretConfirmOpen"
        :title="t('admin.plugins.setupSecret.confirmTitle')"
        :message="t('admin.plugins.setupSecret.confirmBody', { name: plugin.name })"
        :confirm-label="t('admin.plugins.setupSecret.button')"
        confirm-variant="danger"
        :loading="setupSecretGenerating"
        :error="setupSecretError ?? undefined"
        @close="setupSecretConfirmOpen = false"
        @confirm="confirmGenerateSetupSecret"
    />

    <!-- Setup secret: result modal (cleartext, shown once) -->
    <AppModal
        :visible="setupSecretResultOpen"
        :title="t('admin.plugins.setupSecret.resultTitle')"
        :close-on-backdrop="false"
        :close-on-escape="false"
        width="min(540px, 94vw)"
        @close="closeSecretResult"
    >
        <div class="secret-result-body">
            <p class="secret-result-label">{{ t('admin.plugins.setupSecret.secretLabel') }}</p>
            <div class="secret-input-row">
                <input
                    :id="`setup-secret-input-${plugin.id}`"
                    type="text"
                    class="secret-input"
                    :value="setupSecretValue"
                    readonly
                    spellcheck="false"
                    autocomplete="off"
                    @click="($event.target as HTMLInputElement).select()"
                />
                <button type="button" class="copy-btn" :class="{ copied: setupSecretCopied }" @click="copySetupSecret">
                    <Icon
                        :icon="setupSecretCopied ? 'material-symbols:check-rounded' : 'material-symbols:content-copy-outline-rounded'"
                        width="15"
                        height="15"
                    />
                    {{ setupSecretCopied ? t('admin.plugins.setupSecret.copiedButton') : t('admin.plugins.setupSecret.copyButton') }}
                </button>
            </div>
            <p class="secret-instruction">{{ t('admin.plugins.setupSecret.instruction') }}</p>
            <div class="secret-env-hint">
                <code>{{ t('admin.plugins.setupSecret.envHint', { secret: setupSecretValue }) }}</code>
            </div>
            <div class="secret-warning" role="alert">
                <Icon icon="material-symbols:warning-outline-rounded" width="15" height="15" class="secret-warning-icon" />
                <span>{{ t('admin.plugins.setupSecret.warning') }}</span>
            </div>
            <label class="secret-ack-label">
                <input
                    type="checkbox"
                    v-model="setupSecretAcknowledged"
                    class="secret-ack-checkbox"
                />
                <span>{{ t('admin.plugins.setupSecret.checkboxLabel') }}</span>
            </label>
            <div class="secret-result-actions">
                <button
                    type="button"
                    class="primary"
                    :disabled="!setupSecretAcknowledged"
                    @click="closeSecretResult"
                >
                    {{ t('admin.plugins.setupSecret.closeButton') }}
                </button>
            </div>
        </div>
    </AppModal>

    <!-- Scope approve confirmation modal -->
    <AppModal
        :visible="approveModalOpen"
        :title="t('admin.plugins.scopes.approveModalTitle')"
        :close-on-backdrop="!approving"
        :close-on-escape="!approving"
        @close="approveModalOpen = false"
    >
        <div class="acd-scope-body">
            <p class="acd-scope-desc">{{ t('admin.plugins.scopes.approveConfirm', { name: plugin.name }) }}</p>
            <div class="approve-scope-list" role="list">
                <code v-for="s in pendingScopes" :key="s" role="listitem" class="scope-chip scope-chip--pending">{{ s }}</code>
            </div>
            <p v-if="approveError" class="error" role="alert">{{ approveError }}</p>
            <div class="acd-scope-actions">
                <button type="button" class="acd-scope-btn acd-scope-btn--ghost" :disabled="approving" @click="approveModalOpen = false">
                    {{ t('common.cancel') }}
                </button>
                <button type="button" class="acd-scope-btn acd-scope-btn--primary" :disabled="approving" @click="confirmApproveScopes">
                    <Icon v-if="approving" icon="material-symbols:progress-activity" width="14" height="14" class="spin" />
                    {{ approving ? t('common.loading') : t('admin.plugins.scopes.approveButton') }}
                </button>
            </div>
        </div>
    </AppModal>

    <!-- Delete plugin confirmation modal -->
    <AppConfirmDialog
        :visible="deleteModalOpen"
        :title="t('admin.plugins.deleteConfirmTitle')"
        :message="t('admin.plugins.deleteConfirm', { name: plugin.name })"
        :confirm-label="t('admin.plugins.menu.delete')"
        confirm-variant="danger"
        :loading="deleting"
        :error="deleteError ?? undefined"
        @close="deleteModalOpen = false"
        @confirm="confirmDelete"
    />
</template>

<style scoped>
.card {
    border: 1px solid var(--border);
    border-radius: var(--radius-base);
    background: var(--bg-surface);
    /* Don't clip absolutely-positioned descendants (more-menu drops out
       of the header). The radius is preserved by .card-head's own
       border-radius rather than relying on the parent to mask. */
}
.card.is-disabled .title { color: var(--text-muted); }
.card-head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem;
    background: var(--bg-page);
    border-bottom: 1px solid transparent;
}
.card-head:has(+ .card-body) { border-bottom-color: var(--border); }
.title-btn {
    flex: 1;
    min-width: 0;
    background: none;
    border: none;
    text-align: left;
    cursor: pointer;
    color: var(--text);
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.25rem 0.1rem;
    overflow: hidden;
}
.title-btn:hover { color: var(--text-strong); }
.title {
    font-weight: 600;
    color: var(--text-strong);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.key {
    font-family: var(--font-mono, monospace);
    font-size: 0.78rem;
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
}
.version {
    font-size: 0.72rem;
    color: var(--text-faint);
    flex-shrink: 0;
}
.status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
}
.status-text {
    font-size: 0.78rem;
    color: var(--text-muted);
    flex-shrink: 0;
}
.toggle {
    position: relative;
    width: 32px;
    height: 18px;
    flex-shrink: 0;
    cursor: pointer;
    border: none;
    padding: 0;
    background: none;
}
.toggle:disabled { cursor: not-allowed; opacity: 0.6; }
.slider {
    position: absolute;
    inset: 0;
    background: var(--border-strong);
    border-radius: 999px;
    transition: background 0.15s;
}
.slider::before {
    content: '';
    position: absolute;
    top: 2px;
    left: 2px;
    width: 14px;
    height: 14px;
    background: var(--bg-surface);
    border-radius: 50%;
    transition: transform 0.15s;
}
.toggle.on .slider { background: var(--accent); }
.toggle.on .slider::before { transform: translateX(14px); }

.card-body {
    padding: 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
}
.desc {
    margin: 0;
    color: var(--text);
    white-space: pre-wrap;
    line-height: 1.5;
}
.stats-row {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
}
.stat {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.78rem;
    color: var(--text-muted);
    background: var(--bg-page);
    padding: 0.18rem 0.5rem;
    border-radius: 999px;
    border: 1px solid var(--border);
}
.meta {
    margin: 0;
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 0.3rem 0.6rem;
    font-size: 0.85rem;
}
.meta-row { display: contents; }
.meta dt { color: var(--text-muted); }
.meta dd { margin: 0; color: var(--text); display: flex; flex-wrap: wrap; gap: 0.25rem; }
.meta code {
    font-family: var(--font-mono, monospace);
    font-size: 0.78rem;
    background: var(--bg-page);
    padding: 0.1rem 0.35rem;
    border-radius: var(--radius-sm);
}
.scope-chip { background: var(--bg-page); }
.manifest-fold summary { cursor: pointer; color: var(--text-muted); font-size: 0.85rem; }
.manifest-fold pre {
    margin-top: 0.4rem;
    padding: 0.5rem;
    background: var(--bg-page);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    font-size: 0.75rem;
    overflow: auto;
    max-height: 24rem;
    color: var(--text);
}
.error { color: var(--danger); margin: 0; font-size: 0.85rem; }

.config-section {
    margin-top: 0.6rem;
    padding: 0.6rem 0.75rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg-page);
}
.config-header {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    margin-bottom: 0.5rem;
}
.config-header h4 { margin: 0; font-size: 0.92rem; color: var(--text-strong); flex: 1; }
.muted.saved { color: var(--accent); font-size: 0.78rem; }
.config-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: 0.6rem 0.85rem;
}
.config-field {
    display: flex; flex-direction: column; gap: 0.25rem;
}
.config-field.full { grid-column: 1 / -1; }
.config-label {
    display: flex; flex-direction: column;
    font-size: 0.82rem;
    color: var(--text-strong);
    font-weight: 500;
}
.config-label .req { color: var(--danger); margin-left: 0.2rem; font-weight: 400; }
.config-label .hint { color: var(--text-muted); font-weight: 400; font-size: 0.75rem; margin-top: 0.1rem; }
.config-field input[type="text"],
.config-field input[type="number"],
.config-field input[type="password"],
.config-field textarea,
.config-field select {
    padding: 0.35rem 0.5rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg-surface);
    color: var(--text);
    font-size: 0.85rem;
    font-family: inherit;
}
.config-field input[type="checkbox"] { align-self: flex-start; margin-top: 0.2rem; }
.config-actions {
    grid-column: 1 / -1;
    display: flex; justify-content: flex-end;
}
.config-actions .primary {
    padding: 0.4rem 0.85rem;
    background: var(--accent);
    color: var(--text-on-accent);
    border: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
    font-size: 0.85rem;
}
.config-actions .primary:disabled { opacity: 0.55; cursor: not-allowed; }

/* ── Scope chips ─────────────────────────────────────────────────── */
.scope-chip--approved {
    background: color-mix(in srgb, var(--success, #16a34a) 14%, var(--bg-page));
    color: var(--success, #16a34a);
    border: 1px solid color-mix(in srgb, var(--success, #16a34a) 30%, transparent);
}
.scope-chip--pending {
    background: color-mix(in srgb, var(--warning, #d97706) 14%, var(--bg-page));
    color: var(--warning, #d97706);
    border: 1px solid color-mix(in srgb, var(--warning, #d97706) 30%, transparent);
}

/* ── Pending badge in card header ───────────────────────────────── */
.pending-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.22rem;
    padding: 0.18rem 0.5rem;
    font-size: 0.72rem;
    font-weight: 500;
    border-radius: 999px;
    background: color-mix(in srgb, var(--warning, #d97706) 14%, var(--bg-surface));
    color: var(--warning, #d97706);
    border: 1px solid color-mix(in srgb, var(--warning, #d97706) 35%, transparent);
    cursor: pointer;
    flex-shrink: 0;
}
.pending-badge:hover {
    background: color-mix(in srgb, var(--warning, #d97706) 22%, var(--bg-surface));
}

/* ── Pending row in meta table ──────────────────────────────────── */
.pending-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
    align-items: center;
}
.approve-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
    padding: 0.18rem 0.55rem;
    font-size: 0.78rem;
    font-weight: 500;
    border-radius: var(--radius-sm);
    background: var(--accent);
    color: var(--text-on-accent);
    border: none;
    cursor: pointer;
    flex-shrink: 0;
}
.approve-btn:hover { filter: brightness(1.1); }
.approve-btn:disabled { opacity: 0.55; cursor: not-allowed; }

/* ── Setup secret section ────────────────────────────────────────── */
.setup-secret-section {
    display: flex;
    padding-top: 0.1rem;
}
.setup-secret-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.3rem 0.7rem;
    font-size: 0.78rem;
    font-weight: 500;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--danger, #dc2626);
    border: 1px solid color-mix(in srgb, var(--danger, #dc2626) 45%, transparent);
    cursor: pointer;
    transition: background 0.12s, border-color 0.12s;
}
.setup-secret-btn:hover {
    background: color-mix(in srgb, var(--danger, #dc2626) 9%, var(--bg-surface));
    border-color: color-mix(in srgb, var(--danger, #dc2626) 65%, transparent);
}

/* ── Secret result modal ─────────────────────────────────────────── */
.secret-result-body {
    padding: 0.9rem 1rem 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.7rem;
}
.secret-result-label {
    margin: 0;
    font-size: 0.82rem;
    font-weight: 600;
    color: var(--text-strong);
}
.secret-input-row {
    display: flex;
    gap: 0.4rem;
    align-items: stretch;
}
.secret-input {
    flex: 1;
    min-width: 0;
    padding: 0.4rem 0.6rem;
    font-family: var(--font-mono, monospace);
    font-size: 0.82rem;
    letter-spacing: 0.02em;
    background: var(--bg-page);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text-strong);
    cursor: text;
    user-select: all;
}
.secret-input:focus {
    outline: 2px solid var(--accent);
    outline-offset: -1px;
}
.copy-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.22rem;
    flex-shrink: 0;
    padding: 0.35rem 0.7rem;
    font-size: 0.8rem;
    font-weight: 500;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
    background: var(--bg-surface);
    color: var(--text);
    cursor: pointer;
    transition: background 0.12s, color 0.12s, border-color 0.12s;
}
.copy-btn:hover { background: var(--bg-surface-hover, var(--bg-page)); }
.copy-btn.copied {
    background: color-mix(in srgb, var(--success, #16a34a) 14%, var(--bg-surface));
    color: var(--success, #16a34a);
    border-color: color-mix(in srgb, var(--success, #16a34a) 35%, transparent);
}
.secret-instruction {
    margin: 0;
    font-size: 0.82rem;
    color: var(--text-muted);
}
.secret-env-hint {
    background: var(--bg-page);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 0.5rem 0.7rem;
    overflow-x: auto;
}
.secret-env-hint code {
    font-family: var(--font-mono, monospace);
    font-size: 0.82rem;
    color: var(--text-strong);
    white-space: nowrap;
}
.secret-warning {
    display: flex;
    align-items: flex-start;
    gap: 0.35rem;
    padding: 0.5rem 0.65rem;
    background: color-mix(in srgb, var(--warning, #d97706) 11%, var(--bg-surface));
    border: 1px solid color-mix(in srgb, var(--warning, #d97706) 35%, transparent);
    border-radius: var(--radius-sm);
    font-size: 0.82rem;
    color: var(--warning, #d97706);
    line-height: 1.45;
}
.secret-warning-icon {
    flex-shrink: 0;
    margin-top: 0.1rem;
}
.secret-ack-label {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    font-size: 0.85rem;
    color: var(--text);
    cursor: pointer;
    user-select: none;
}
.secret-ack-checkbox {
    width: 15px;
    height: 15px;
    flex-shrink: 0;
    cursor: pointer;
    accent-color: var(--accent);
}
.secret-result-actions {
    display: flex;
    justify-content: flex-end;
    padding-top: 0.25rem;
    border-top: 1px solid var(--border);
}
.secret-result-actions .primary {
    padding: 0.4rem 0.85rem;
    background: var(--accent);
    color: var(--text-on-accent);
    border: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
    font-size: 0.85rem;
    font-weight: 500;
}
.secret-result-actions .primary:disabled {
    opacity: 0.45;
    cursor: not-allowed;
}

/* ── Three-dot more menu ─────────────────────────────────────────── */
.more-wrap {
    position: relative;
    flex-shrink: 0;
}
.more-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    background: none;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text-muted);
    cursor: pointer;
    padding: 0;
    transition: background 0.12s, color 0.12s;
}
.more-btn:hover {
    background: var(--bg-surface-hover, var(--bg-page));
    color: var(--text);
}
.more-menu {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    z-index: 50;
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    min-width: 120px;
    padding: 0.2rem 0;
}
.more-menu-item {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    width: 100%;
    padding: 0.4rem 0.75rem;
    background: none;
    border: none;
    text-align: left;
    font-size: 0.85rem;
    cursor: pointer;
    color: var(--text);
}
.more-menu-item:hover { background: var(--bg-surface-hover, var(--bg-page)); }
.more-menu-item.danger { color: var(--danger, #dc2626); }
.more-menu-item.danger:hover {
    background: color-mix(in srgb, var(--danger, #dc2626) 9%, var(--bg-surface));
}

/* ── Scope approve modal internals ───────────────────────────────── */
.acd-scope-body {
    padding: 0.9rem 1rem 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
}
.acd-scope-desc {
    margin: 0;
    color: var(--text);
    font-size: 0.9rem;
    line-height: 1.5;
}
.approve-scope-list {
    margin: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
}
.approve-scope-list code {
    font-family: var(--font-mono, monospace);
    font-size: 0.8rem;
    padding: 0.15rem 0.45rem;
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--warning, #d97706) 14%, var(--bg-page));
    color: var(--warning, #d97706);
    border: 1px solid color-mix(in srgb, var(--warning, #d97706) 30%, transparent);
}
.acd-scope-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    padding-top: 0.25rem;
    border-top: 1px solid var(--border);
}
.acd-scope-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.4rem 0.85rem;
    border-radius: var(--radius-sm);
    font-size: 0.85rem;
    font-weight: 500;
    cursor: pointer;
}
.acd-scope-btn:disabled { opacity: 0.55; cursor: not-allowed; }
.acd-scope-btn--ghost {
    background: none;
    border: 1px solid var(--border);
    color: var(--text);
}
.acd-scope-btn--ghost:not(:disabled):hover { background: var(--bg-surface-hover); }
.acd-scope-btn--primary {
    background: var(--accent);
    color: var(--text-on-accent);
    border: none;
}
.acd-scope-btn--primary:not(:disabled):hover { filter: brightness(1.1); }
@keyframes spin { to { transform: rotate(360deg); } }
.spin { animation: spin 0.8s linear infinite; }
</style>
