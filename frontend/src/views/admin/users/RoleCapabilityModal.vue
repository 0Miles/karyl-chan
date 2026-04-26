<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { Icon } from '@iconify/vue';
import AppModal from '../../../components/AppModal.vue';
import AppTabs from '../../../components/AppTabs.vue';
import { listGuilds, type GuildSummary } from '../../../api/guilds';
import {
    GLOBAL_CAPABILITY_KEYS,
    makeGuildScopedCapability,
    type GuildScope
} from '../../../libs/admin-capabilities';

interface RoleLite {
    name: string;
    capabilities: string[];
}

interface CatalogItem { key: string; description: string }

const props = defineProps<{
    /** Role to edit. `null` keeps the modal hidden. */
    role: RoleLite | null;
    /** Server-side capability catalog; surfaces descriptions when i18n
     *  hasn't shipped a key yet. */
    capabilityCatalog?: CatalogItem[];
    /** Disable inputs while a mutation is in flight. */
    pending: boolean;
}>();

const emit = defineEmits<{
    (e: 'close'): void;
    /** Add `token` to the role's grants. */
    (e: 'grant', token: string): void;
    /** Remove `token` from the role's grants. */
    (e: 'revoke', token: string): void;
}>();

const { t } = useI18n();

const visible = computed(() => props.role !== null);

const tab = ref<'global' | 'per-guild'>('global');
const tabs = computed(() => [
    { key: 'global', label: t('admin.roles.capabilityTabs.global'), icon: 'material-symbols:tune-rounded' },
    { key: 'per-guild', label: t('admin.roles.capabilityTabs.perGuild'), icon: 'material-symbols:groups-outline-rounded' }
]);

// Guild list is shared across opens — fetched once on first show. The
// admin user opening this modal carries the `admin` token (the page
// itself is gated behind it), so listGuilds returns every guild the
// bot is in regardless of per-guild grants on the editor's account.
const guilds = ref<GuildSummary[]>([]);
const guildsLoading = ref(false);
const search = ref('');

// ── Pending edits — committed only on Confirm ────────────────────────
//
// Toggling a checkbox stages the change in `pendingGrants`/`pendingRevokes`
// instead of firing the API immediately. Confirm flushes both as
// emit('grant'/'revoke', token) — the parent's per-token handler still
// runs serially, but from the user's perspective it's a single intent
// to apply, with Cancel as a clean escape hatch.
const pendingGrants = ref<Set<string>>(new Set());
const pendingRevokes = ref<Set<string>>(new Set());

watch([visible, () => props.role?.name], ([open, _name]) => {
    // Reset whenever the modal reopens or switches roles. Without
    // this, pending edits would carry across role switches.
    pendingGrants.value = new Set();
    pendingRevokes.value = new Set();
    if (open) {
        search.value = '';
        tab.value = 'global';
    }
});

watch(visible, async (open) => {
    if (!open || guilds.value.length > 0) return;
    guildsLoading.value = true;
    try {
        guilds.value = await listGuilds();
    } catch {
        // Surface nothing — the parent already shows API errors at the
        // page level. The list just stays empty.
    } finally {
        guildsLoading.value = false;
    }
});

const originalGranted = computed(() => new Set(props.role?.capabilities ?? []));

function isGranted(token: string): boolean {
    if (pendingRevokes.value.has(token)) return false;
    if (pendingGrants.value.has(token)) return true;
    return originalGranted.value.has(token);
}

function toggle(token: string) {
    if (props.pending) return;
    const want = !isGranted(token);
    const wasOriginal = originalGranted.value.has(token);

    // Snapshot first, mutate copies — Vue tracks Set additions/removals
    // through reactive(), but reassigning makes intent obvious and
    // avoids subtle bugs if the underlying ref switches sets.
    const grants = new Set(pendingGrants.value);
    const revokes = new Set(pendingRevokes.value);

    if (want === wasOriginal) {
        // User flipped back to the original state — clear any pending
        // edit for this token so we don't emit an unnecessary call.
        grants.delete(token);
        revokes.delete(token);
    } else if (want) {
        revokes.delete(token);
        grants.add(token);
    } else {
        grants.delete(token);
        revokes.add(token);
    }

    pendingGrants.value = grants;
    pendingRevokes.value = revokes;
}

const pendingCount = computed(() => pendingGrants.value.size + pendingRevokes.value.size);
const hasChanges = computed(() => pendingCount.value > 0);

function descFor(key: string): string {
    const i18nKey = `admin.capabilityDesc.${key}`;
    const localized = t(i18nKey);
    if (localized !== i18nKey) return localized;
    return props.capabilityCatalog?.find(c => c.key === key)?.description ?? '';
}

function scopedDescFor(scope: GuildScope): string {
    return t(`admin.capabilityDesc.guildScoped.${scope}`);
}

const filteredGuilds = computed(() => {
    const needle = search.value.trim().toLowerCase();
    if (!needle) return guilds.value;
    return guilds.value.filter(g =>
        g.name.toLowerCase().includes(needle) || g.id.includes(needle)
    );
});

function scopedToken(guildId: string, scope: GuildScope): string {
    return makeGuildScopedCapability(guildId, scope);
}

function modalTitle(): string {
    return props.role ? t('admin.roles.capabilityModalTitle', { name: props.role.name }) : '';
}

function onCancel() {
    pendingGrants.value = new Set();
    pendingRevokes.value = new Set();
    emit('close');
}

function onConfirm() {
    if (!hasChanges.value) {
        emit('close');
        return;
    }
    // Emit grants then revokes. Parent's per-token handler queues
    // each through withRoleLock so the API calls serialize even
    // though we synchronously fire all the events here.
    for (const token of pendingGrants.value) emit('grant', token);
    for (const token of pendingRevokes.value) emit('revoke', token);
    pendingGrants.value = new Set();
    pendingRevokes.value = new Set();
    emit('close');
}
</script>

<template>
    <AppModal
        :visible="visible"
        :title="modalTitle()"
        width="min(680px, 94vw)"
        @close="onCancel"
    >
        <div v-if="role" class="body">
            <AppTabs v-model="tab" :tabs="tabs">
                <!-- Global capabilities -->
                <section v-if="tab === 'global'" class="pane">
                    <p class="hint">{{ t('admin.roles.capabilityTabs.globalHint') }}</p>
                    <ul class="cap-list">
                        <li
                            v-for="key in GLOBAL_CAPABILITY_KEYS"
                            :key="key"
                            :class="['cap', { granted: isGranted(key), pending: pendingGrants.has(key) || pendingRevokes.has(key) }]"
                            @click="toggle(key)"
                        >
                            <input
                                type="checkbox"
                                tabindex="-1"
                                :checked="isGranted(key)"
                                :disabled="pending"
                                @click.stop
                                @change="toggle(key)"
                            />
                            <div class="cap-text">
                                <code class="cap-key">{{ key }}</code>
                                <span v-if="descFor(key)" class="cap-desc">{{ descFor(key) }}</span>
                            </div>
                        </li>
                    </ul>
                </section>

                <!-- Per-guild capabilities — same row style as global,
                     but grouped under each server header. -->
                <section v-else class="pane">
                    <p class="hint">{{ t('admin.roles.capabilityTabs.perGuildHint') }}</p>
                    <input
                        v-model="search"
                        type="search"
                        class="search"
                        :placeholder="t('admin.roles.searchGuilds')"
                    />
                    <p v-if="guildsLoading" class="muted">{{ t('common.loading') }}</p>
                    <p v-else-if="filteredGuilds.length === 0" class="muted">{{ t('admin.roles.noGuilds') }}</p>
                    <div v-else class="guild-sections">
                        <article v-for="g in filteredGuilds" :key="g.id" class="guild-section">
                            <header class="guild-head">
                                <img v-if="g.iconUrl" :src="g.iconUrl" alt="" class="guild-icon" />
                                <div v-else class="guild-icon icon-fallback">{{ g.name.charAt(0).toUpperCase() }}</div>
                                <div class="guild-text">
                                    <span class="guild-name">{{ g.name }}</span>
                                    <code class="guild-id">{{ g.id }}</code>
                                </div>
                            </header>
                            <ul class="cap-list inset">
                                <li
                                    v-for="scope in (['message', 'manage'] as const)"
                                    :key="scope"
                                    :class="[
                                        'cap',
                                        {
                                            granted: isGranted(scopedToken(g.id, scope)),
                                            pending: pendingGrants.has(scopedToken(g.id, scope)) || pendingRevokes.has(scopedToken(g.id, scope))
                                        }
                                    ]"
                                    @click="toggle(scopedToken(g.id, scope))"
                                >
                                    <input
                                        type="checkbox"
                                        tabindex="-1"
                                        :checked="isGranted(scopedToken(g.id, scope))"
                                        :disabled="pending"
                                        @click.stop
                                        @change="toggle(scopedToken(g.id, scope))"
                                    />
                                    <div class="cap-text">
                                        <code class="cap-key">{{ scopedToken(g.id, scope) }}</code>
                                        <span class="cap-desc">{{ scopedDescFor(scope) }}</span>
                                    </div>
                                </li>
                            </ul>
                        </article>
                    </div>
                </section>
            </AppTabs>

            <footer class="actions">
                <span v-if="hasChanges" class="pending-pill">
                    <Icon icon="material-symbols:edit-outline-rounded" width="14" height="14" />
                    {{ t('admin.roles.pendingChanges', { count: pendingCount }) }}
                </span>
                <button type="button" class="ghost" @click="onCancel">{{ t('common.cancel') }}</button>
                <button
                    type="button"
                    class="primary"
                    :disabled="!hasChanges || pending"
                    @click="onConfirm"
                >{{ t('admin.roles.confirmChanges') }}</button>
            </footer>
        </div>
    </AppModal>
</template>

<style scoped>
.body {
    display: flex;
    flex-direction: column;
    min-height: 380px;
    max-height: 78vh;
    padding: 16px;
}
.pane {
    padding: 0.75rem 0;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    min-height: 0;
    overflow-y: auto;
}
.hint {
    margin: 0;
    color: var(--text-muted);
    font-size: 0.82rem;
}
.muted {
    margin: 0;
    color: var(--text-muted);
    font-size: 0.85rem;
    text-align: center;
    padding: 1.2rem 0.5rem;
}
.search {
    padding: 0.45rem 0.6rem;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg);
    color: var(--text);
    font: inherit;
    font-size: 0.88rem;
}
.search:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }

.cap-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
}
.cap-list.inset { gap: 0.25rem; }
.cap {
    display: flex;
    gap: 0.6rem;
    align-items: flex-start;
    padding: 0.55rem 0.7rem;
    border: 1px solid var(--border);
    border-radius: 6px;
    cursor: pointer;
    background: var(--bg);
    transition: background-color 0.12s, border-color 0.12s;
}
.cap:hover { background: var(--bg-surface-hover); }
.cap.granted {
    background: var(--accent-bg);
    border-color: var(--accent);
}
.cap.pending {
    /* Dashed accent border calls out staged but-not-yet-committed
       changes so the user knows what's about to be sent on Confirm. */
    border-style: dashed;
    border-color: var(--accent);
}
.cap input[type="checkbox"] {
    margin-top: 0.15rem;
    accent-color: var(--accent);
    width: 16px;
    height: 16px;
    cursor: pointer;
    flex-shrink: 0;
}
.cap-text { display: flex; flex-direction: column; gap: 0.2rem; min-width: 0; flex: 1; }
.cap-key {
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--text-strong);
    background: transparent;
    padding: 0;
    word-break: break-all;
}
.cap-desc {
    font-size: 0.76rem;
    color: var(--text-muted);
    line-height: 1.4;
}

.guild-sections {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
}
.guild-section {
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg-surface);
    overflow: hidden;
}
.guild-head {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    padding: 0.5rem 0.7rem;
    background: var(--bg-surface-2);
    border-bottom: 1px solid var(--border);
}
.guild-icon {
    width: 28px;
    height: 28px;
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
    font-size: 0.78rem;
}
.guild-text { display: flex; flex-direction: column; gap: 0.1rem; min-width: 0; flex: 1; }
.guild-name {
    font-size: 0.92rem;
    font-weight: 500;
    color: var(--text-strong);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.guild-id {
    font-size: 0.7rem;
    color: var(--text-muted);
    background: transparent;
    padding: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.guild-section .cap-list.inset {
    padding: 0.4rem 0.5rem;
}

.actions {
    display: flex;
    justify-content: end;
    align-items: center;
    gap: 0.5rem;
    padding: 0.7rem 0;
    border-top: 1px solid var(--border);
    background: var(--bg-surface);
    flex-shrink: 0;
}
.pending-pill {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.2rem 0.6rem;
    background: var(--accent-bg);
    color: var(--accent-text-strong);
    border-radius: 999px;
    font-size: 0.76rem;
    font-weight: 500;
    margin-right: auto;
}
.actions .ghost,
.actions .primary {
    padding: 0.45rem 0.95rem;
    border-radius: 6px;
    font: inherit;
    font-size: 0.88rem;
    cursor: pointer;
}
.ghost {
    background: none;
    border: 1px solid var(--border);
    color: var(--text);
}
.ghost:hover { background: var(--bg-surface-hover); }
.primary {
    background: var(--accent);
    color: var(--text-on-accent);
    border: 1px solid var(--accent);
    font-weight: 500;
}
.primary:disabled { opacity: 0.5; cursor: default; }
</style>
