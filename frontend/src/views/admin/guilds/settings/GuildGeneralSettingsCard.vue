<script setup lang="ts">
import { computed, reactive, watch } from 'vue';
import { useGuildSettings } from './use-guild-settings';
import type { GuildSettings } from '../../../../api/guilds';

const props = defineProps<{ guildId: string }>();

const { settings, loading, loadError, saving, error, savedFlash, applyPatch } = useGuildSettings(props.guildId);

const draft = reactive({ name: '', description: '' });

function reseed(s: GuildSettings) {
    draft.name = s.name;
    draft.description = s.description ?? '';
}

watch(settings, (s) => { if (s) reseed(s); });

const dirty = computed(() => {
    if (!settings.value) return false;
    return draft.name !== settings.value.name
        || (draft.description || null) !== settings.value.description;
});

function discard() {
    if (settings.value) reseed(settings.value);
}

function save() {
    if (!dirty.value) return;
    return applyPatch({
        name: draft.name.trim(),
        description: draft.description.trim() || null
    });
}
</script>

<template>
    <div class="settings">
        <p v-if="loading && !settings" class="muted">{{ $t('guilds.settings.loading') }}</p>
        <p v-else-if="loadError" class="error">{{ loadError }}</p>

        <section v-else-if="settings" class="card">
            <header class="card-head">
                <h3>{{ $t('guilds.settings.general') }}</h3>
                <span v-if="savedFlash" class="saved-flash">{{ $t('guilds.settings.saved') }}</span>
            </header>
            <label class="field">
                <span>{{ $t('guilds.settings.name') }}</span>
                <input v-model="draft.name" type="text" maxlength="100" />
            </label>
            <label class="field">
                <span>{{ $t('guilds.settings.description') }}</span>
                <textarea
                    v-model="draft.description"
                    rows="2"
                    maxlength="120"
                    :placeholder="$t('guilds.settings.descriptionPlaceholder')"
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
        </section>
    </div>
</template>

<style scoped src="./settings-card.css"></style>
<style scoped>
.settings { display: flex; flex-direction: column; gap: 0.7rem; }
.muted { color: var(--text-muted); font-size: 0.85rem; }
</style>
