<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import {
    getGuildSettings,
    listGuildTextChannels,
    listGuildVoiceChannels,
    patchGuildSettings,
    setGuildMfaLevel,
    type GuildChannelCategory,
    type GuildSettings,
    type GuildSettingsPatch,
    type GuildSystemChannelFlagsPayload,
    type GuildVoiceCategory
} from '../../../../api/guilds';
import { useApiError } from '../../../../composables/use-api-error';
import AppSelectField, { type SelectOption } from '../../../../components/AppSelectField.vue';
import { useI18n } from 'vue-i18n';

type SettingsCard = 'general' | 'moderation' | 'system';

const props = withDefaults(defineProps<{
    guildId: string;
    /** Limits which cards render — used by the sub-tab nav so each
     *  sub-tab shows just its slice. Defaults to all three. */
    cards?: readonly SettingsCard[];
}>(), {
    cards: () => ['general', 'moderation', 'system'] as const
});

const showCard = (card: SettingsCard) => props.cards.includes(card);

const { handle: handleApiError } = useApiError();
const { t } = useI18n();

// Server-truth snapshot. Each save replaces this with the response from
// the backend so subsequent dirty checks compare against the freshest
// canonical state — local drafts above mutate independently per-card.
const settings = ref<GuildSettings | null>(null);
const loading = ref(false);
const loadError = ref<string | null>(null);

// Channel pickers. Voice for AFK, text for system/rules/publicUpdates.
// Loaded lazily alongside the settings — both endpoints are cheap and
// only fire when the user lands on the settings tab.
const textCategories = ref<GuildChannelCategory[]>([]);
const voiceCategories = ref<GuildVoiceCategory[]>([]);

interface CardState {
    saving: boolean;
    error: string | null;
    savedFlash: boolean;
}
function makeCard(): CardState {
    return reactive({ saving: false, error: null, savedFlash: false });
}

const generalCard = makeCard();
const moderationCard = makeCard();
const mfaCard = makeCard();
const systemCard = makeCard();

// Per-card draft state. Re-seeded from `settings.value` whenever the
// settings ref changes (load + after successful save) so users see
// confirmation immediately without losing the form layout.
const generalDraft = reactive({ name: '', description: '' });
const moderationDraft = reactive({
    verificationLevel: 0,
    explicitContentFilter: 0,
    defaultMessageNotifications: 0
});
const mfaDraft = reactive({ mfaLevel: 0 });
const systemDraft = reactive({
    systemChannelId: null as string | null,
    rulesChannelId: null as string | null,
    publicUpdatesChannelId: null as string | null,
    afkChannelId: null as string | null,
    afkTimeout: 300,
    premiumProgressBarEnabled: false,
    flags: {
        suppressJoinNotifications: false,
        suppressPremiumSubscriptions: false,
        suppressGuildReminderNotifications: false,
        suppressJoinNotificationReplies: false
    } as GuildSystemChannelFlagsPayload
});

function reseed(s: GuildSettings) {
    generalDraft.name = s.name;
    generalDraft.description = s.description ?? '';

    moderationDraft.verificationLevel = s.verificationLevel;
    moderationDraft.explicitContentFilter = s.explicitContentFilter;
    moderationDraft.defaultMessageNotifications = s.defaultMessageNotifications;
    mfaDraft.mfaLevel = s.mfaLevel;

    systemDraft.systemChannelId = s.systemChannelId;
    systemDraft.rulesChannelId = s.rulesChannelId;
    systemDraft.publicUpdatesChannelId = s.publicUpdatesChannelId;
    systemDraft.afkChannelId = s.afkChannelId;
    systemDraft.afkTimeout = s.afkTimeout;
    systemDraft.premiumProgressBarEnabled = s.premiumProgressBarEnabled;
    systemDraft.flags = { ...s.systemChannelFlags };
}

async function loadAll(guildId: string) {
    loading.value = true;
    loadError.value = null;
    settings.value = null;
    try {
        const [s, text, voice] = await Promise.all([
            getGuildSettings(guildId),
            listGuildTextChannels(guildId).catch(() => [] as GuildChannelCategory[]),
            listGuildVoiceChannels(guildId).catch(() => [] as GuildVoiceCategory[])
        ]);
        settings.value = s;
        textCategories.value = text;
        voiceCategories.value = voice;
        reseed(s);
    } catch (err) {
        if (handleApiError(err) !== 'unhandled') return;
        loadError.value = err instanceof Error ? err.message : 'Failed to load settings';
    } finally {
        loading.value = false;
    }
}

watch(() => props.guildId, (id) => { if (id) loadAll(id); }, { immediate: true });

const isCommunity = computed(() => settings.value?.features.includes('COMMUNITY') ?? false);

// Dirty checks. Cheap — these objects are tiny so a per-render compare
// keeps the UI honest without us having to wire watchers per-field.
const generalDirty = computed(() => {
    if (!settings.value) return false;
    return generalDraft.name !== settings.value.name
        || (generalDraft.description || null) !== settings.value.description;
});
const moderationDirty = computed(() => {
    if (!settings.value) return false;
    return moderationDraft.verificationLevel !== settings.value.verificationLevel
        || moderationDraft.explicitContentFilter !== settings.value.explicitContentFilter
        || moderationDraft.defaultMessageNotifications !== settings.value.defaultMessageNotifications;
});
const mfaDirty = computed(() => {
    if (!settings.value) return false;
    return mfaDraft.mfaLevel !== settings.value.mfaLevel;
});
const systemDirty = computed(() => {
    if (!settings.value) return false;
    const s = settings.value;
    if (systemDraft.systemChannelId !== s.systemChannelId) return true;
    if (systemDraft.rulesChannelId !== s.rulesChannelId) return true;
    if (systemDraft.publicUpdatesChannelId !== s.publicUpdatesChannelId) return true;
    if (systemDraft.afkChannelId !== s.afkChannelId) return true;
    if (systemDraft.afkTimeout !== s.afkTimeout) return true;
    if (systemDraft.premiumProgressBarEnabled !== s.premiumProgressBarEnabled) return true;
    const f = systemDraft.flags;
    const sf = s.systemChannelFlags;
    return f.suppressJoinNotifications !== sf.suppressJoinNotifications
        || f.suppressPremiumSubscriptions !== sf.suppressPremiumSubscriptions
        || f.suppressGuildReminderNotifications !== sf.suppressGuildReminderNotifications
        || f.suppressJoinNotificationReplies !== sf.suppressJoinNotificationReplies;
});

function flashSaved(card: CardState) {
    card.savedFlash = true;
    window.setTimeout(() => { card.savedFlash = false; }, 1800);
}

async function applyPatch(card: CardState, patch: GuildSettingsPatch) {
    card.saving = true;
    card.error = null;
    try {
        const fresh = await patchGuildSettings(props.guildId, patch);
        settings.value = fresh;
        reseed(fresh);
        flashSaved(card);
    } catch (err) {
        if (handleApiError(err) !== 'unhandled') return;
        card.error = err instanceof Error ? err.message : 'Save failed';
    } finally {
        card.saving = false;
    }
}

function saveGeneral() {
    if (!generalDirty.value) return;
    return applyPatch(generalCard, {
        name: generalDraft.name.trim(),
        description: generalDraft.description.trim() || null
    });
}
function saveModeration() {
    if (!moderationDirty.value) return;
    return applyPatch(moderationCard, {
        verificationLevel: moderationDraft.verificationLevel,
        explicitContentFilter: moderationDraft.explicitContentFilter,
        defaultMessageNotifications: moderationDraft.defaultMessageNotifications
    });
}
async function saveMfa() {
    if (!mfaDirty.value) return;
    mfaCard.saving = true;
    mfaCard.error = null;
    try {
        const level = (mfaDraft.mfaLevel === 1 ? 1 : 0) as 0 | 1;
        await setGuildMfaLevel(props.guildId, level);
        if (settings.value) {
            settings.value = { ...settings.value, mfaLevel: level };
        }
        flashSaved(mfaCard);
    } catch (err) {
        if (handleApiError(err) !== 'unhandled') return;
        mfaCard.error = err instanceof Error ? err.message : 'Save failed';
    } finally {
        mfaCard.saving = false;
    }
}
function saveSystem() {
    if (!systemDirty.value) return;
    return applyPatch(systemCard, {
        systemChannelId: systemDraft.systemChannelId,
        rulesChannelId: systemDraft.rulesChannelId,
        publicUpdatesChannelId: systemDraft.publicUpdatesChannelId,
        afkChannelId: systemDraft.afkChannelId,
        afkTimeout: systemDraft.afkTimeout,
        premiumProgressBarEnabled: systemDraft.premiumProgressBarEnabled,
        systemChannelFlags: { ...systemDraft.flags }
    });
}

function discard() {
    if (settings.value) reseed(settings.value);
}

const verificationOptions = computed<SelectOption<number>[]>(() =>
    [0, 1, 2, 3, 4].map(v => ({ value: v, label: t('guilds.settings.verification.' + v) }))
);
const explicitFilterOptions = computed<SelectOption<number>[]>(() =>
    [0, 1, 2].map(v => ({ value: v, label: t('guilds.settings.explicitContentFilterOpt.' + v) }))
);
const defaultNotificationOptions = computed<SelectOption<number>[]>(() =>
    [0, 1].map(v => ({ value: v, label: t('guilds.settings.defaultNotificationsOpt.' + v) }))
);
const mfaLevelOptions = computed<SelectOption<number>[]>(() =>
    [0, 1].map(v => ({ value: v, label: t('guilds.settings.mfaLevelOpt.' + v) }))
);
const afkTimeoutOptions = computed<SelectOption<number>[]>(() =>
    [60, 300, 900, 1800, 3600].map(v => ({ value: v, label: t('guilds.settings.afkTimeoutOpt.' + v) }))
);

// Channel option lists. Each text/voice category becomes a `group`
// header in the picker so users see channels under the right
// category (matches Discord's own channel organisation).
const textChannelOptions = computed<SelectOption<string | null>[]>(() => {
    const out: SelectOption<string | null>[] = [
        { value: null, label: t('guilds.settings.systemChannelNone') }
    ];
    for (const cat of textCategories.value) {
        const groupLabel = cat.name ?? null;
        for (const ch of cat.channels) {
            out.push({ value: ch.id, label: '#' + ch.name, group: groupLabel ?? undefined });
        }
    }
    return out;
});
const voiceChannelOptions = computed<SelectOption<string | null>[]>(() => {
    const out: SelectOption<string | null>[] = [
        { value: null, label: t('guilds.settings.afkChannelNone') }
    ];
    for (const cat of voiceCategories.value) {
        const groupLabel = cat.name ?? null;
        for (const ch of cat.channels) {
            out.push({ value: ch.id, label: ch.name, group: groupLabel ?? undefined });
        }
    }
    return out;
});
</script>

<template>
    <div class="settings">
        <p v-if="loading && !settings" class="muted">{{ $t('guilds.settings.loading') }}</p>
        <p v-else-if="loadError" class="error">{{ loadError }}</p>

        <template v-else-if="settings">
            <!-- General ───────────────────────────────────── -->
            <section v-if="showCard('general')" class="card">
                <header class="card-head">
                    <h3>{{ $t('guilds.settings.general') }}</h3>
                    <span v-if="generalCard.savedFlash" class="saved-flash">{{ $t('guilds.settings.saved') }}</span>
                </header>
                <label class="field">
                    <span>{{ $t('guilds.settings.name') }}</span>
                    <input v-model="generalDraft.name" type="text" maxlength="100" />
                </label>
                <label class="field">
                    <span>{{ $t('guilds.settings.description') }}</span>
                    <textarea
                        v-model="generalDraft.description"
                        rows="2"
                        maxlength="120"
                        :placeholder="$t('guilds.settings.descriptionPlaceholder')"
                    />
                </label>
                <p v-if="generalCard.error" class="error">{{ $t('guilds.settings.saveFailed') }}: {{ generalCard.error }}</p>
                <footer class="actions">
                    <button
                        type="button"
                        class="ghost"
                        :disabled="!generalDirty || generalCard.saving"
                        @click="discard"
                    >{{ $t('guilds.settings.discard') }}</button>
                    <button
                        type="button"
                        class="primary"
                        :disabled="!generalDirty || generalCard.saving"
                        @click="saveGeneral"
                    >{{ $t('guilds.settings.save') }}</button>
                </footer>
            </section>

            <!-- Moderation ───────────────────────────────── -->
            <section v-if="showCard('moderation')" class="card">
                <header class="card-head">
                    <h3>{{ $t('guilds.settings.moderation') }}</h3>
                    <span v-if="moderationCard.savedFlash" class="saved-flash">{{ $t('guilds.settings.saved') }}</span>
                </header>
                <label class="field">
                    <span>{{ $t('guilds.settings.verificationLevel') }}</span>
                    <AppSelectField
                        v-model="moderationDraft.verificationLevel"
                        :options="verificationOptions"
                        :drawer-title="$t('guilds.settings.verificationLevel')"
                    />
                </label>
                <label class="field">
                    <span>{{ $t('guilds.settings.explicitContentFilter') }}</span>
                    <AppSelectField
                        v-model="moderationDraft.explicitContentFilter"
                        :options="explicitFilterOptions"
                        :drawer-title="$t('guilds.settings.explicitContentFilter')"
                    />
                </label>
                <label class="field">
                    <span>{{ $t('guilds.settings.defaultNotifications') }}</span>
                    <AppSelectField
                        v-model="moderationDraft.defaultMessageNotifications"
                        :options="defaultNotificationOptions"
                        :drawer-title="$t('guilds.settings.defaultNotifications')"
                    />
                </label>
                <p v-if="moderationCard.error" class="error">{{ $t('guilds.settings.saveFailed') }}: {{ moderationCard.error }}</p>
                <footer class="actions">
                    <button
                        type="button"
                        class="ghost"
                        :disabled="!moderationDirty || moderationCard.saving"
                        @click="discard"
                    >{{ $t('guilds.settings.discard') }}</button>
                    <button
                        type="button"
                        class="primary"
                        :disabled="!moderationDirty || moderationCard.saving"
                        @click="saveModeration"
                    >{{ $t('guilds.settings.save') }}</button>
                </footer>

                <!-- MFA breaks out into its own row because Discord routes
                     it through a separate owner-only endpoint; coupling it
                     with the rest of moderation would require pretending we
                     can save it at the same time, which we can't. -->
                <div class="subcard">
                    <label class="field">
                        <span>{{ $t('guilds.settings.mfaLevel') }}</span>
                        <AppSelectField
                            v-model="mfaDraft.mfaLevel"
                            :options="mfaLevelOptions"
                            :drawer-title="$t('guilds.settings.mfaLevel')"
                        />
                    </label>
                    <p class="hint">{{ $t('guilds.settings.mfaOwnerOnly') }}</p>
                    <p v-if="mfaCard.error" class="error">{{ $t('guilds.settings.saveFailed') }}: {{ mfaCard.error }}</p>
                    <footer class="actions">
                        <span v-if="mfaCard.savedFlash" class="saved-flash">{{ $t('guilds.settings.saved') }}</span>
                        <button
                            type="button"
                            class="primary"
                            :disabled="!mfaDirty || mfaCard.saving"
                            @click="saveMfa"
                        >{{ $t('guilds.settings.save') }}</button>
                    </footer>
                </div>
            </section>

            <!-- System ───────────────────────────────────── -->
            <section v-if="showCard('system')" class="card">
                <header class="card-head">
                    <h3>{{ $t('guilds.settings.system') }}</h3>
                    <span v-if="systemCard.savedFlash" class="saved-flash">{{ $t('guilds.settings.saved') }}</span>
                </header>
                <label class="field">
                    <span>{{ $t('guilds.settings.systemChannel') }}</span>
                    <AppSelectField
                        v-model="systemDraft.systemChannelId"
                        :options="textChannelOptions"
                        :drawer-title="$t('guilds.settings.systemChannel')"
                    />
                </label>

                <fieldset class="flags">
                    <legend>{{ $t('guilds.settings.systemFlags') }}</legend>
                    <label class="check">
                        <input type="checkbox" :checked="!systemDraft.flags.suppressJoinNotifications"
                            @change="systemDraft.flags.suppressJoinNotifications = !($event.target as HTMLInputElement).checked" />
                        {{ $t('guilds.settings.flagJoin') }}
                    </label>
                    <label class="check">
                        <input type="checkbox" :checked="!systemDraft.flags.suppressPremiumSubscriptions"
                            @change="systemDraft.flags.suppressPremiumSubscriptions = !($event.target as HTMLInputElement).checked" />
                        {{ $t('guilds.settings.flagPremium') }}
                    </label>
                    <label class="check">
                        <input type="checkbox" :checked="!systemDraft.flags.suppressGuildReminderNotifications"
                            @change="systemDraft.flags.suppressGuildReminderNotifications = !($event.target as HTMLInputElement).checked" />
                        {{ $t('guilds.settings.flagReminder') }}
                    </label>
                    <label class="check">
                        <input type="checkbox" :checked="!systemDraft.flags.suppressJoinNotificationReplies"
                            @change="systemDraft.flags.suppressJoinNotificationReplies = !($event.target as HTMLInputElement).checked" />
                        {{ $t('guilds.settings.flagJoinReply') }}
                    </label>
                </fieldset>

                <label class="field">
                    <span>{{ $t('guilds.settings.afkChannel') }}</span>
                    <AppSelectField
                        v-model="systemDraft.afkChannelId"
                        :options="voiceChannelOptions"
                        :drawer-title="$t('guilds.settings.afkChannel')"
                    />
                </label>
                <label class="field">
                    <span>{{ $t('guilds.settings.afkTimeout') }}</span>
                    <AppSelectField
                        v-model="systemDraft.afkTimeout"
                        :options="afkTimeoutOptions"
                        :drawer-title="$t('guilds.settings.afkTimeout')"
                    />
                </label>

                <label class="field" :class="{ disabled: !isCommunity }">
                    <span>
                        {{ $t('guilds.settings.rulesChannel') }}
                        <em v-if="!isCommunity" class="muted">· {{ $t('guilds.settings.communityOnly') }}</em>
                    </span>
                    <AppSelectField
                        v-model="systemDraft.rulesChannelId"
                        :options="textChannelOptions"
                        :disabled="!isCommunity"
                        :drawer-title="$t('guilds.settings.rulesChannel')"
                    />
                </label>
                <label class="field" :class="{ disabled: !isCommunity }">
                    <span>
                        {{ $t('guilds.settings.publicUpdatesChannel') }}
                        <em v-if="!isCommunity" class="muted">· {{ $t('guilds.settings.communityOnly') }}</em>
                    </span>
                    <AppSelectField
                        v-model="systemDraft.publicUpdatesChannelId"
                        :options="textChannelOptions"
                        :disabled="!isCommunity"
                        :drawer-title="$t('guilds.settings.publicUpdatesChannel')"
                    />
                </label>

                <label class="check">
                    <input type="checkbox" v-model="systemDraft.premiumProgressBarEnabled" />
                    {{ $t('guilds.settings.premiumProgressBar') }}
                </label>

                <p class="meta-line">
                    <span>{{ $t('guilds.settings.premiumTier') }}: {{ settings.premiumTier }}</span>
                    <span>· {{ $t('guilds.settings.premiumSubs') }}: {{ settings.premiumSubscriptionCount }}</span>
                </p>

                <p v-if="systemCard.error" class="error">{{ $t('guilds.settings.saveFailed') }}: {{ systemCard.error }}</p>
                <footer class="actions">
                    <button
                        type="button"
                        class="ghost"
                        :disabled="!systemDirty || systemCard.saving"
                        @click="discard"
                    >{{ $t('guilds.settings.discard') }}</button>
                    <button
                        type="button"
                        class="primary"
                        :disabled="!systemDirty || systemCard.saving"
                        @click="saveSystem"
                    >{{ $t('guilds.settings.save') }}</button>
                </footer>
            </section>
        </template>
    </div>
</template>

<style scoped>
.settings {
    display: flex;
    flex-direction: column;
    gap: 0.7rem;
}
.card {
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 0.85rem 0.95rem;
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
}
.card-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.6rem;
}
.card-head h3 {
    margin: 0;
    font-size: 0.95rem;
    color: var(--text-strong);
}
.field { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.85rem; }
.field span { color: var(--text-muted); }
.field.disabled span { opacity: 0.6; }
.field input,
.field select,
.field textarea {
    padding: 0.4rem 0.55rem;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg);
    color: var(--text);
    font: inherit;
    font-size: 0.9rem;
}
.field textarea { resize: vertical; min-height: 2.5rem; }
.field select:disabled,
.field input:disabled { opacity: 0.55; cursor: not-allowed; }
.flags {
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 0.5rem 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    margin: 0;
}
.flags legend {
    color: var(--text-muted);
    font-size: 0.78rem;
    padding: 0 0.3rem;
}
.check { display: flex; align-items: center; gap: 0.4rem; font-size: 0.88rem; }
.subcard {
    margin-top: 0.55rem;
    padding-top: 0.55rem;
    border-top: 1px dashed var(--border);
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
}
.subcard .actions { align-items: center; }
.hint { margin: 0; font-size: 0.78rem; color: var(--text-muted); }
.muted { color: var(--text-muted); font-style: normal; font-size: 0.78rem; margin-left: 0.3rem; }
.meta-line {
    margin: 0;
    color: var(--text-muted);
    font-size: 0.8rem;
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
}
.error {
    color: var(--danger);
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.35);
    border-radius: 4px;
    padding: 0.4rem 0.55rem;
    font-size: 0.82rem;
    margin: 0;
}
.actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    align-items: center;
}
.saved-flash {
    color: var(--accent);
    font-size: 0.78rem;
    font-weight: 500;
    margin-right: auto;
}
.card-head .saved-flash { margin-right: 0; }
.ghost,
.primary {
    padding: 0.4rem 0.85rem;
    border-radius: 4px;
    font: inherit;
    font-size: 0.85rem;
    cursor: pointer;
}
.ghost {
    background: none;
    border: 1px solid var(--border);
    color: var(--text);
}
.ghost:not(:disabled):hover { background: var(--bg-surface-hover); }
.primary {
    background: var(--accent);
    color: var(--text-on-accent);
    border: 1px solid var(--accent);
}
.primary:disabled,
.ghost:disabled { opacity: 0.5; cursor: default; }
</style>
