<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { Icon } from '@iconify/vue';
import AppModal from '../../../components/AppModal.vue';
import AppTabs from '../../../components/AppTabs.vue';
import AppButton from '../../../components/AppButton.vue';
import { useGuildListStore } from '../../../stores/guildListStore';
import { listScopeTabs, type ScopeTabRow } from '../../../api/behavior';
import { listPluginCapabilities, type PluginCapabilityGroup } from '../../../api/admin';
import {
    GLOBAL_CAPABILITY_KEYS,
    makeBehaviorScopeToken,
    makeGuildScopedCapability,
    isBehaviorScopeToken,
    isPluginCapabilityToken,
    parsePluginCapabilityToken,
    type GuildScope
} from '../../../libs/admin-capabilities';
import { useUserSummaries } from '../../../composables/use-user-summaries';

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

const tab = ref<'global' | 'per-guild' | 'per-plugin' | 'per-behavior-tab'>('global');
const tabs = computed(() => [
    { key: 'global', label: t('admin.roles.capabilityTabs.global'), icon: 'material-symbols:tune-rounded' },
    { key: 'per-guild', label: t('admin.roles.capabilityTabs.perGuild'), icon: 'material-symbols:groups-outline-rounded' },
    { key: 'per-plugin', label: t('admin.roles.capabilityTabs.perPlugin'), icon: 'material-symbols:extension-outline-rounded' },
    { key: 'per-behavior-tab', label: t('admin.roles.capabilityTabs.perBehaviorTab'), icon: 'material-symbols:forum-outline-rounded' }
]);

// Guild list is shared across opens — fetched once on first show. The
// admin user opening this modal carries the `admin` token (the page
// itself is gated behind it), so listGuilds returns every guild the
// bot is in regardless of per-guild grants on the editor's account.
const guildListStore = useGuildListStore();
const guilds = computed(() => guildListStore.guilds);
const guildsLoading = ref(false);
const search = ref('');

// Behavior scope tabs — same lazy-fetch pattern as guilds. The opening
// admin user always carries `admin` (this modal is reachable only
// from the user-management page, itself admin-gated), so listScopeTabs
// returns the full catalog regardless of the editor's per-tab
// grants on their own account.
const behaviorTabs = ref<ScopeTabRow[]>([]);
const behaviorTabsLoading = ref(false);
const behaviorTabsFetched = ref(false);

// Plugin-declared capabilities — same lazy-fetch pattern. Catalog comes
// from GET /api/admin/plugin-capabilities (only currently-enabled plugins).
const pluginCaps = ref<PluginCapabilityGroup[]>([]);
const pluginCapsLoading = ref(false);
const pluginCapsFetched = ref(false);

// Resolve display names for specific_user tabs.
const behaviorUserIds = computed(() =>
    behaviorTabs.value.filter(t => t.tabType === 'specific_user' && t.userId).map(t => t.userId!)
);
const { getDisplayName: getBehaviorDisplayName } = useUserSummaries(behaviorUserIds);

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
    if (!open) return;
    if (guilds.value.length === 0) {
        guildsLoading.value = true;
        try {
            await guildListStore.ensure();
        } catch {
            // Surface nothing — the parent already shows API errors at the
            // page level. The list just stays empty.
        } finally {
            guildsLoading.value = false;
        }
    }
    if (!behaviorTabsFetched.value) {
        behaviorTabsLoading.value = true;
        try {
            behaviorTabs.value = await listScopeTabs();
            behaviorTabsFetched.value = true;
        } catch {
            // Same: silent — empty list is OK as a fallback.
        } finally {
            behaviorTabsLoading.value = false;
        }
    }
    if (!pluginCapsFetched.value) {
        pluginCapsLoading.value = true;
        try {
            pluginCaps.value = await listPluginCapabilities();
            pluginCapsFetched.value = true;
        } catch {
            // Silent — empty list is an acceptable fallback.
        } finally {
            pluginCapsLoading.value = false;
        }
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

function behaviorTabToken(scopeKey: string): string {
    return makeBehaviorScopeToken(scopeKey);
}

function tabIcon(tab: ScopeTabRow): string {
    switch (tab.tabType) {
        case 'global_all': return 'material-symbols:public-rounded';
        case 'all_dms': return 'material-symbols:forum-outline-rounded';
        case 'all_bot_dms': return 'material-symbols:smart-toy-outline-rounded';
        case 'all_guilds': return 'material-symbols:dns-outline-rounded';
        case 'specific_guild': return 'material-symbols:shield-outline-rounded';
        case 'specific_channel': return 'material-symbols:tag-rounded';
        case 'specific_user': return 'material-symbols:person-outline-rounded';
        case 'specific_group': return 'material-symbols:groups-outline-rounded';
    }
}

function tabLabel(tab: ScopeTabRow): string {
    switch (tab.tabType) {
        case 'global_all': return t('behaviors.sidebar.globalAll');
        case 'all_dms': return t('behaviors.sidebar.allDms');
        case 'all_bot_dms': return t('behaviors.sidebar.allBotDms');
        case 'all_guilds': return t('behaviors.sidebar.allGuilds');
        case 'specific_guild': return tab.label || tab.guildId || '?';
        case 'specific_channel': return tab.label || tab.channelId || '?';
        case 'specific_user': {
            const name = tab.userId ? getBehaviorDisplayName(tab.userId) : null;
            return name ?? tab.label ?? tab.userId ?? '?';
        }
        case 'specific_group': return tab.label || tab.groupName || '?';
    }
}

function tabSubtext(tab: ScopeTabRow): string {
    return t('behaviors.sidebar.behaviorCount', { count: tab.behaviorCount });
}

const filteredBehaviorTabs = computed(() => {
    const needle = search.value.trim().toLowerCase();
    if (!needle) return behaviorTabs.value;
    return behaviorTabs.value.filter(row => {
        const label = tabLabel(row).toLowerCase();
        const token = behaviorTabToken(row.scopeKey).toLowerCase();
        return label.includes(needle) || token.includes(needle);
    });
});

const legacyBehaviorTokens = computed(() => {
    if (!props.role) return [];
    const BEHAVIOR_RE = /^behavior:.+\.manage$/;
    const allTokens = new Set([
        ...props.role.capabilities,
        ...pendingGrants.value
    ]);
    for (const r of pendingRevokes.value) allTokens.delete(r);
    return [...allTokens].filter(cap =>
        BEHAVIOR_RE.test(cap) && !isBehaviorScopeToken(cap)
    );
});

// ── Plugin capability tab ────────────────────────────────────────────
const filteredPluginCaps = computed(() => {
    const needle = search.value.trim().toLowerCase();
    if (!needle) return pluginCaps.value;
    return pluginCaps.value
        .map(group => ({
            ...group,
            capabilities: group.capabilities.filter(c =>
                c.token.toLowerCase().includes(needle) ||
                c.description.toLowerCase().includes(needle) ||
                group.pluginName.toLowerCase().includes(needle) ||
                group.pluginKey.toLowerCase().includes(needle)
            )
        }))
        .filter(group => group.capabilities.length > 0);
});

// `plugin:*` grants the role still holds whose plugin/capKey isn't in
// the live catalog (plugin disabled, removed, or capability dropped).
// Shown so an admin can revoke them; the backend purges them
// automatically on plugin delete / re-register, but a disabled plugin's
// grants linger by design.
const knownPluginTokens = computed(() => {
    const s = new Set<string>();
    for (const g of pluginCaps.value) for (const c of g.capabilities) s.add(c.token);
    return s;
});
const orphanedPluginTokens = computed(() => {
    if (!props.role) return [];
    const allTokens = new Set([
        ...props.role.capabilities,
        ...pendingGrants.value
    ]);
    for (const r of pendingRevokes.value) allTokens.delete(r);
    return [...allTokens].filter(cap =>
        isPluginCapabilityToken(cap) && !knownPluginTokens.value.has(cap)
    );
});
function orphanLabel(token: string): string {
    const p = parsePluginCapabilityToken(token);
    return p ? `${p.pluginKey} · ${p.capKey}` : token;
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
                <section v-else-if="tab === 'per-guild'" class="pane">
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

                <!-- Per-plugin capabilities. Each currently-enabled
                     plugin that declared `capabilities[]` in its
                     manifest gets a section here; granting one of these
                     `plugin:<key>:<capKey>` tokens lets the holder use
                     whatever the plugin gates on it (e.g. its WebUI).
                     Plugin delete / re-register cleans these up; a
                     disabled plugin's grants linger until re-enabled. -->
                <section v-else-if="tab === 'per-plugin'" class="pane">
                    <p class="hint">{{ t('admin.roles.capabilityTabs.perPluginHint') }}</p>
                    <input
                        v-model="search"
                        type="search"
                        class="search"
                        :placeholder="t('admin.roles.searchPlugins')"
                    />
                    <p v-if="pluginCapsLoading" class="muted">{{ t('common.loading') }}</p>
                    <p v-else-if="filteredPluginCaps.length === 0 && orphanedPluginTokens.length === 0" class="muted">
                        {{ search.trim() ? t('admin.roles.noPluginCapabilitiesFiltered') : t('admin.roles.noPluginCapabilities') }}
                    </p>
                    <div v-if="filteredPluginCaps.length > 0" class="guild-sections">
                        <article v-for="group in filteredPluginCaps" :key="group.pluginKey" class="guild-section">
                            <header class="guild-head">
                                <Icon icon="material-symbols:extension-outline-rounded" width="22" height="22" class="cap-tab-icon" />
                                <div class="guild-text">
                                    <span class="guild-name">{{ group.pluginName }}</span>
                                    <code class="guild-id">{{ group.pluginKey }}</code>
                                </div>
                            </header>
                            <ul class="cap-list inset">
                                <li
                                    v-for="c in group.capabilities"
                                    :key="c.token"
                                    :class="[
                                        'cap',
                                        {
                                            granted: isGranted(c.token),
                                            pending: pendingGrants.has(c.token) || pendingRevokes.has(c.token)
                                        }
                                    ]"
                                    @click="toggle(c.token)"
                                >
                                    <input
                                        type="checkbox"
                                        tabindex="-1"
                                        :checked="isGranted(c.token)"
                                        :disabled="pending"
                                        @click.stop
                                        @change="toggle(c.token)"
                                    />
                                    <div class="cap-text">
                                        <code class="cap-key">{{ c.token }}</code>
                                        <span class="cap-desc">{{ c.description }}</span>
                                    </div>
                                </li>
                            </ul>
                        </article>
                    </div>

                    <!-- Orphaned plugin grants (disabled / removed plugin,
                         or a dropped capability). Shown so admins can revoke. -->
                    <template v-if="orphanedPluginTokens.length > 0">
                        <p class="legacy-header">{{ t('admin.roles.orphanedPluginHeader') }}</p>
                        <ul class="cap-list">
                            <li
                                v-for="token in orphanedPluginTokens"
                                :key="token"
                                :class="[
                                    'cap', 'legacy',
                                    {
                                        granted: isGranted(token),
                                        pending: pendingGrants.has(token) || pendingRevokes.has(token)
                                    }
                                ]"
                                @click="toggle(token)"
                            >
                                <input
                                    type="checkbox"
                                    tabindex="-1"
                                    :checked="isGranted(token)"
                                    :disabled="pending"
                                    @click.stop
                                    @change="toggle(token)"
                                />
                                <Icon icon="material-symbols:extension-off-outline-rounded" width="18" height="18" class="cap-tab-icon" />
                                <div class="cap-text">
                                    <code class="cap-key">{{ token }}</code>
                                    <span class="cap-desc">{{ orphanLabel(token) }} · {{ t('admin.roles.orphanedPluginDesc') }}</span>
                                </div>
                            </li>
                        </ul>
                    </template>
                </section>

                <!-- Per-tab behavior capabilities. Granting one of
                     these lets the holder CRUD behaviors within that
                     scope tab without giving them the full
                     `behavior.manage` token; adding/removing tabs
                     stays admin-only. -->
                <section v-else class="pane">
                    <p class="hint">{{ t('admin.roles.capabilityTabs.perBehaviorTabHint') }}</p>
                    <input
                        v-model="search"
                        type="search"
                        class="search"
                        :placeholder="t('admin.roles.searchBehaviorTabs')"
                    />
                    <p v-if="behaviorTabsLoading" class="muted">{{ t('common.loading') }}</p>
                    <p v-else-if="filteredBehaviorTabs.length === 0" class="muted">
                        {{ t('admin.roles.noBehaviorTabs') }}
                    </p>
                    <ul v-else class="cap-list">
                        <li
                            v-for="entry in filteredBehaviorTabs"
                            :key="entry.id"
                            :class="[
                                'cap',
                                {
                                    granted: isGranted(behaviorTabToken(entry.scopeKey)),
                                    pending: pendingGrants.has(behaviorTabToken(entry.scopeKey)) || pendingRevokes.has(behaviorTabToken(entry.scopeKey))
                                }
                            ]"
                            @click="toggle(behaviorTabToken(entry.scopeKey))"
                        >
                            <input
                                type="checkbox"
                                tabindex="-1"
                                :checked="isGranted(behaviorTabToken(entry.scopeKey))"
                                :disabled="pending"
                                @click.stop
                                @change="toggle(behaviorTabToken(entry.scopeKey))"
                            />
                            <Icon :icon="tabIcon(entry)" width="18" height="18" class="cap-tab-icon" />
                            <div class="cap-text">
                                <code class="cap-key">{{ behaviorTabToken(entry.scopeKey) }}</code>
                                <span class="cap-desc">
                                    {{ tabLabel(entry) }}
                                    <span class="cap-kind">· {{ tabSubtext(entry) }}</span>
                                </span>
                            </div>
                        </li>
                    </ul>

                    <!-- Legacy audience-scoped tokens (pre-tab migration).
                         Shown so admins can revoke them; new grants use tab tokens. -->
                    <template v-if="legacyBehaviorTokens.length > 0">
                        <p class="legacy-header">{{ t('admin.roles.legacyBehaviorHeader') }}</p>
                        <ul class="cap-list">
                            <li
                                v-for="token in legacyBehaviorTokens"
                                :key="token"
                                :class="[
                                    'cap', 'legacy',
                                    {
                                        granted: isGranted(token),
                                        pending: pendingGrants.has(token) || pendingRevokes.has(token)
                                    }
                                ]"
                                @click="toggle(token)"
                            >
                                <input
                                    type="checkbox"
                                    tabindex="-1"
                                    :checked="isGranted(token)"
                                    :disabled="pending"
                                    @click.stop
                                    @change="toggle(token)"
                                />
                                <Icon icon="material-symbols:history-rounded" width="18" height="18" class="cap-tab-icon" />
                                <div class="cap-text">
                                    <code class="cap-key">{{ token }}</code>
                                    <span class="cap-desc">{{ t('admin.roles.legacyBehaviorDesc') }}</span>
                                </div>
                            </li>
                        </ul>
                    </template>
                </section>
            </AppTabs>

            <footer class="actions">
                <span v-if="hasChanges" class="pending-pill">
                    <Icon icon="material-symbols:edit-outline-rounded" width="14" height="14" />
                    {{ t('admin.roles.pendingChanges', { count: pendingCount }) }}
                </span>
                <AppButton variant="ghost" @click="onCancel">{{ t('common.cancel') }}</AppButton>
                <AppButton variant="primary" :loading="pending" :disabled="!hasChanges" @click="onConfirm">
                    {{ t('admin.roles.confirmChanges') }}
                </AppButton>
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
    border-radius: var(--radius-base);
    background: var(--bg-surface);
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
    border-radius: var(--radius-base);
    cursor: pointer;
    background: var(--bg-surface);
    transition: background-color var(--transition-fast), border-color var(--transition-fast);
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
.cap-kind {
    color: var(--text-faint);
    font-size: 0.72rem;
    margin-left: 0.15rem;
}
.cap-tab-icon {
    color: var(--text-muted);
    flex-shrink: 0;
    margin-top: 0.1rem;
}
.legacy-header {
    margin: 0.5rem 0 0;
    padding-top: 0.6rem;
    border-top: 1px dashed var(--border);
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--text-muted);
}
.cap.legacy {
    border-color: var(--warning, #d97706);
    border-style: dashed;
    opacity: 0.85;
}

.guild-sections {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
}
.guild-section {
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
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
    border-radius: var(--radius-pill);
    font-size: 0.76rem;
    font-weight: 500;
    margin-right: auto;
}
</style>
