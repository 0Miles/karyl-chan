<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useGuildSettings } from './use-guild-settings';
import {
    listGuildTextChannels,
    listGuildVoiceChannels,
    type GuildChannelCategory,
    type GuildSettings,
    type GuildSystemChannelFlagsPayload,
    type GuildVoiceCategory
} from '../../../../api/guilds';
import AppSelectField, { type SelectOption } from '../../../../components/AppSelectField.vue';
import { useI18n } from 'vue-i18n';

const props = defineProps<{ guildId: string }>();
const { t } = useI18n();

const { settings, loading, loadError, saving, error, savedFlash, applyPatch } =
    useGuildSettings(props.guildId);

// Channel pickers — text for system/rules/publicUpdates, voice for AFK.
// Loaded on mount; both endpoints are cheap and only fire when the user
// lands on the system sub-tab.
const textCategories = ref<GuildChannelCategory[]>([]);
const voiceCategories = ref<GuildVoiceCategory[]>([]);

onMounted(async () => {
    const [text, voice] = await Promise.all([
        listGuildTextChannels(props.guildId).catch(() => [] as GuildChannelCategory[]),
        listGuildVoiceChannels(props.guildId).catch(() => [] as GuildVoiceCategory[])
    ]);
    textCategories.value = text;
    voiceCategories.value = voice;
});

const draft = reactive({
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
    draft.systemChannelId = s.systemChannelId;
    draft.rulesChannelId = s.rulesChannelId;
    draft.publicUpdatesChannelId = s.publicUpdatesChannelId;
    draft.afkChannelId = s.afkChannelId;
    draft.afkTimeout = s.afkTimeout;
    draft.premiumProgressBarEnabled = s.premiumProgressBarEnabled;
    draft.flags = { ...s.systemChannelFlags };
}

watch(settings, (s) => { if (s) reseed(s); });

const isCommunity = computed(() => settings.value?.features.includes('COMMUNITY') ?? false);

const dirty = computed(() => {
    if (!settings.value) return false;
    const s = settings.value;
    if (draft.systemChannelId !== s.systemChannelId) return true;
    if (draft.rulesChannelId !== s.rulesChannelId) return true;
    if (draft.publicUpdatesChannelId !== s.publicUpdatesChannelId) return true;
    if (draft.afkChannelId !== s.afkChannelId) return true;
    if (draft.afkTimeout !== s.afkTimeout) return true;
    if (draft.premiumProgressBarEnabled !== s.premiumProgressBarEnabled) return true;
    const f = draft.flags;
    const sf = s.systemChannelFlags;
    return f.suppressJoinNotifications !== sf.suppressJoinNotifications
        || f.suppressPremiumSubscriptions !== sf.suppressPremiumSubscriptions
        || f.suppressGuildReminderNotifications !== sf.suppressGuildReminderNotifications
        || f.suppressJoinNotificationReplies !== sf.suppressJoinNotificationReplies;
});

function discard() {
    if (settings.value) reseed(settings.value);
}

function save() {
    if (!dirty.value) return;
    return applyPatch({
        systemChannelId: draft.systemChannelId,
        rulesChannelId: draft.rulesChannelId,
        publicUpdatesChannelId: draft.publicUpdatesChannelId,
        afkChannelId: draft.afkChannelId,
        afkTimeout: draft.afkTimeout,
        premiumProgressBarEnabled: draft.premiumProgressBarEnabled,
        systemChannelFlags: { ...draft.flags }
    });
}

const afkTimeoutOptions = computed<SelectOption<number>[]>(() =>
    [60, 300, 900, 1800, 3600].map(v => ({ value: v, label: t('guilds.settings.afkTimeoutOpt.' + v) }))
);

// Channel option lists. Each text/voice category becomes a `group`
// header in the picker so users see channels under the right category
// (matches Discord's own channel organisation).
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

        <section v-else-if="settings" class="card">
            <header class="card-head">
                <h3>{{ $t('guilds.settings.system') }}</h3>
                <span v-if="savedFlash" class="saved-flash">{{ $t('guilds.settings.saved') }}</span>
            </header>
            <label class="field">
                <span>{{ $t('guilds.settings.systemChannel') }}</span>
                <AppSelectField
                    v-model="draft.systemChannelId"
                    :options="textChannelOptions"
                    :drawer-title="$t('guilds.settings.systemChannel')"
                />
            </label>

            <fieldset class="flags">
                <legend>{{ $t('guilds.settings.systemFlags') }}</legend>
                <label class="check">
                    <input type="checkbox" :checked="!draft.flags.suppressJoinNotifications"
                        @change="draft.flags.suppressJoinNotifications = !($event.target as HTMLInputElement).checked" />
                    {{ $t('guilds.settings.flagJoin') }}
                </label>
                <label class="check">
                    <input type="checkbox" :checked="!draft.flags.suppressPremiumSubscriptions"
                        @change="draft.flags.suppressPremiumSubscriptions = !($event.target as HTMLInputElement).checked" />
                    {{ $t('guilds.settings.flagPremium') }}
                </label>
                <label class="check">
                    <input type="checkbox" :checked="!draft.flags.suppressGuildReminderNotifications"
                        @change="draft.flags.suppressGuildReminderNotifications = !($event.target as HTMLInputElement).checked" />
                    {{ $t('guilds.settings.flagReminder') }}
                </label>
                <label class="check">
                    <input type="checkbox" :checked="!draft.flags.suppressJoinNotificationReplies"
                        @change="draft.flags.suppressJoinNotificationReplies = !($event.target as HTMLInputElement).checked" />
                    {{ $t('guilds.settings.flagJoinReply') }}
                </label>
            </fieldset>

            <label class="field">
                <span>{{ $t('guilds.settings.afkChannel') }}</span>
                <AppSelectField
                    v-model="draft.afkChannelId"
                    :options="voiceChannelOptions"
                    :drawer-title="$t('guilds.settings.afkChannel')"
                />
            </label>
            <label class="field">
                <span>{{ $t('guilds.settings.afkTimeout') }}</span>
                <AppSelectField
                    v-model="draft.afkTimeout"
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
                    v-model="draft.rulesChannelId"
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
                    v-model="draft.publicUpdatesChannelId"
                    :options="textChannelOptions"
                    :disabled="!isCommunity"
                    :drawer-title="$t('guilds.settings.publicUpdatesChannel')"
                />
            </label>

            <label class="check">
                <input type="checkbox" v-model="draft.premiumProgressBarEnabled" />
                {{ $t('guilds.settings.premiumProgressBar') }}
            </label>

            <p class="meta-line">
                <span>{{ $t('guilds.settings.premiumTier') }}: {{ settings.premiumTier }}</span>
                <span>· {{ $t('guilds.settings.premiumSubs') }}: {{ settings.premiumSubscriptionCount }}</span>
            </p>

            <p v-if="error" class="error">{{ $t('guilds.settings.saveFailed') }}: {{ error }}</p>
            <footer class="actions">
                <button type="button" class="ghost" :disabled="!dirty || saving" @click="discard">
                    {{ $t('guilds.settings.discard') }}
                </button>
                <button type="button" class="primary" :disabled="!dirty || saving" @click="save">
                    {{ $t('guilds.settings.save') }}
                </button>
            </footer>
        </section>
    </div>
</template>

<style scoped src="./settings-card.css"></style>
<style scoped>
.settings { display: flex; flex-direction: column; gap: 0.7rem; }
.muted { color: var(--text-muted); font-size: 0.85rem; }
</style>
