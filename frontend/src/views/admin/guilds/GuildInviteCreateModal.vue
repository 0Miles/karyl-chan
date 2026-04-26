<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import AppModal from '../../../components/AppModal.vue';
import AppSelectField, { type SelectOption } from '../../../components/AppSelectField.vue';
import {
    listGuildTextChannels,
    type GuildChannelCategory
} from '../../../api/guilds';

const props = defineProps<{
    visible: boolean;
    guildId: string | null;
    creating: boolean;
    /** Last error from the parent's create call so we can render it
     *  inline instead of bouncing the user back to the section. */
    error: string | null;
}>();

const emit = defineEmits<{
    (e: 'close'): void;
    (e: 'submit', payload: {
        channelId: string | null;
        maxAge: number;
        maxUses: number;
        temporary: boolean;
        unique: boolean;
    }): void;
}>();

const { t } = useI18n();

const channelId = ref<string | null>(null);
const maxAge = ref<number>(86400);
const maxUses = ref<number>(0);
const temporary = ref(false);
const unique = ref(true);

const textCategories = ref<GuildChannelCategory[]>([]);

watch(() => [props.visible, props.guildId] as const, async ([v, gid]) => {
    if (!v || !gid) return;
    // Reset form when the modal opens so a previous run doesn't leak
    // values from a different guild.
    channelId.value = null;
    maxAge.value = 86400;
    maxUses.value = 0;
    temporary.value = false;
    unique.value = true;
    try { textCategories.value = await listGuildTextChannels(gid); }
    catch { textCategories.value = []; }
}, { immediate: true });

const channelOptions = computed<SelectOption<string | null>[]>(() => {
    const out: SelectOption<string | null>[] = [
        { value: null, label: t('guilds.invites.fieldChannelHint') }
    ];
    for (const cat of textCategories.value) {
        const groupLabel = cat.name ?? null;
        for (const ch of cat.channels) {
            out.push({ value: ch.id, label: '#' + ch.name, group: groupLabel ?? undefined });
        }
    }
    return out;
});

const ageOptions = computed<SelectOption<number>[]>(() =>
    [1800, 3600, 21600, 43200, 86400, 604800, 0]
        .map(s => ({ value: s, label: t('guilds.invites.expireOpt.' + s) }))
);
const usesOptions = computed<SelectOption<number>[]>(() =>
    [0, 1, 5, 10, 25, 50, 100]
        .map(n => ({ value: n, label: t('guilds.invites.usesOpt.' + n) }))
);

function submit() {
    emit('submit', {
        channelId: channelId.value,
        maxAge: maxAge.value,
        maxUses: maxUses.value,
        temporary: temporary.value,
        unique: unique.value
    });
}
</script>

<template>
    <AppModal
        :visible="visible"
        :title="$t('guilds.invites.modalTitle')"
        width="min(440px, 95vw)"
        @close="$emit('close')"
    >
        <form class="body" @submit.prevent="submit">
            <label class="field">
                <span>{{ $t('guilds.invites.fieldChannel') }}</span>
                <AppSelectField
                    v-model="channelId"
                    :options="channelOptions"
                    :drawer-title="$t('guilds.invites.fieldChannel')"
                />
            </label>
            <label class="field">
                <span>{{ $t('guilds.invites.fieldMaxAge') }}</span>
                <AppSelectField
                    v-model="maxAge"
                    :options="ageOptions"
                    :drawer-title="$t('guilds.invites.fieldMaxAge')"
                />
            </label>
            <label class="field">
                <span>{{ $t('guilds.invites.fieldMaxUses') }}</span>
                <AppSelectField
                    v-model="maxUses"
                    :options="usesOptions"
                    :drawer-title="$t('guilds.invites.fieldMaxUses')"
                />
            </label>

            <label class="check">
                <input type="checkbox" v-model="temporary" />
                <span class="check-text">
                    {{ $t('guilds.invites.fieldTemporary') }}
                    <small class="hint">{{ $t('guilds.invites.fieldTemporaryHint') }}</small>
                </span>
            </label>
            <label class="check">
                <input type="checkbox" v-model="unique" />
                <span class="check-text">
                    {{ $t('guilds.invites.fieldUnique') }}
                    <small class="hint">{{ $t('guilds.invites.fieldUniqueHint') }}</small>
                </span>
            </label>

            <p v-if="error" class="error">{{ error }}</p>

            <footer class="actions">
                <button type="button" class="ghost" @click="$emit('close')">{{ $t('common.cancel') }}</button>
                <button type="submit" class="primary" :disabled="creating">
                    {{ creating ? $t('common.loading') : $t('guilds.invites.submit') }}
                </button>
            </footer>
        </form>
    </AppModal>
</template>

<style scoped>
.body {
    padding: 0.85rem 0.95rem;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
}
.field { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.85rem; }
.field span { color: var(--text-muted); }
.check {
    display: flex;
    align-items: flex-start;
    gap: 0.45rem;
    font-size: 0.88rem;
}
.check-text { display: flex; flex-direction: column; gap: 0.1rem; }
.hint { color: var(--text-muted); font-size: 0.75rem; }
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
    padding-top: 0.4rem;
    border-top: 1px solid var(--border);
}
.ghost,
.primary {
    padding: 0.45rem 0.9rem;
    border-radius: 4px;
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
}
.primary:disabled { opacity: 0.55; cursor: default; }
</style>
