<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useGuildSettings } from './use-guild-settings';
import { setGuildMfaLevel, type GuildSettings } from '../../../../api/guilds';
import { useApiError } from '../../../../composables/use-api-error';
import AppSelectField, { type SelectOption } from '../../../../components/AppSelectField.vue';
import { useI18n } from 'vue-i18n';

const props = defineProps<{ guildId: string }>();
const { t } = useI18n();
const { handle: handleApiError } = useApiError();

const { settings, loading, loadError, saving, error, savedFlash, applyPatch } =
    useGuildSettings(props.guildId);

const draft = reactive({
    verificationLevel: 0,
    explicitContentFilter: 0,
    defaultMessageNotifications: 0
});

// MFA breaks out into its own row because Discord routes it through a
// separate owner-only endpoint; coupling it with the rest of moderation
// would require pretending we can save it at the same time, which we can't.
const mfaDraft = reactive({ mfaLevel: 0 });
const mfaSaving = ref(false);
const mfaError = ref<string | null>(null);
const mfaSavedFlash = ref(false);

function reseed(s: GuildSettings) {
    draft.verificationLevel = s.verificationLevel;
    draft.explicitContentFilter = s.explicitContentFilter;
    draft.defaultMessageNotifications = s.defaultMessageNotifications;
    mfaDraft.mfaLevel = s.mfaLevel;
}

watch(settings, (s) => { if (s) reseed(s); });

const dirty = computed(() => {
    if (!settings.value) return false;
    return draft.verificationLevel !== settings.value.verificationLevel
        || draft.explicitContentFilter !== settings.value.explicitContentFilter
        || draft.defaultMessageNotifications !== settings.value.defaultMessageNotifications;
});

const mfaDirty = computed(() => {
    if (!settings.value) return false;
    return mfaDraft.mfaLevel !== settings.value.mfaLevel;
});

function discard() {
    if (settings.value) reseed(settings.value);
}

function save() {
    if (!dirty.value) return;
    return applyPatch({
        verificationLevel: draft.verificationLevel,
        explicitContentFilter: draft.explicitContentFilter,
        defaultMessageNotifications: draft.defaultMessageNotifications
    });
}

async function saveMfa() {
    if (!mfaDirty.value) return;
    mfaSaving.value = true;
    mfaError.value = null;
    try {
        const level = (mfaDraft.mfaLevel === 1 ? 1 : 0) as 0 | 1;
        await setGuildMfaLevel(props.guildId, level);
        if (settings.value) {
            settings.value = { ...settings.value, mfaLevel: level };
        }
        mfaSavedFlash.value = true;
        window.setTimeout(() => { mfaSavedFlash.value = false; }, 1800);
    } catch (err) {
        if (handleApiError(err) !== 'unhandled') return;
        mfaError.value = err instanceof Error ? err.message : 'Save failed';
    } finally {
        mfaSaving.value = false;
    }
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
</script>

<template>
    <div class="settings">
        <p v-if="loading && !settings" class="muted">{{ $t('guilds.settings.loading') }}</p>
        <p v-else-if="loadError" class="error">{{ loadError }}</p>

        <section v-else-if="settings" class="card">
            <header class="card-head">
                <h3>{{ $t('guilds.settings.moderation') }}</h3>
                <span v-if="savedFlash" class="saved-flash">{{ $t('guilds.settings.saved') }}</span>
            </header>
            <label class="field">
                <span>{{ $t('guilds.settings.verificationLevel') }}</span>
                <AppSelectField
                    v-model="draft.verificationLevel"
                    :options="verificationOptions"
                    :drawer-title="$t('guilds.settings.verificationLevel')"
                />
            </label>
            <label class="field">
                <span>{{ $t('guilds.settings.explicitContentFilter') }}</span>
                <AppSelectField
                    v-model="draft.explicitContentFilter"
                    :options="explicitFilterOptions"
                    :drawer-title="$t('guilds.settings.explicitContentFilter')"
                />
            </label>
            <label class="field">
                <span>{{ $t('guilds.settings.defaultNotifications') }}</span>
                <AppSelectField
                    v-model="draft.defaultMessageNotifications"
                    :options="defaultNotificationOptions"
                    :drawer-title="$t('guilds.settings.defaultNotifications')"
                />
            </label>
            <p v-if="error" class="error">{{ $t('guilds.settings.saveFailed') }}: {{ error }}</p>
            <footer class="actions">
                <button type="button" class="ghost" :disabled="!dirty || saving" @click="discard">
                    {{ $t('guilds.settings.discard') }}
                </button>
                <button type="button" class="primary" :disabled="!dirty || saving" @click="save">
                    {{ $t('guilds.settings.save') }}
                </button>
            </footer>

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
                <p v-if="mfaError" class="error">{{ $t('guilds.settings.saveFailed') }}: {{ mfaError }}</p>
                <footer class="actions">
                    <span v-if="mfaSavedFlash" class="saved-flash">{{ $t('guilds.settings.saved') }}</span>
                    <button type="button" class="primary" :disabled="!mfaDirty || mfaSaving" @click="saveMfa">
                        {{ $t('guilds.settings.save') }}
                    </button>
                </footer>
            </div>
        </section>
    </div>
</template>

<style scoped src="./settings-card.css"></style>
<style scoped>
.settings { display: flex; flex-direction: column; gap: 0.7rem; }
.muted { color: var(--text-muted); font-size: 0.85rem; }
</style>
