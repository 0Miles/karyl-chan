<script setup lang="ts">
import { ref } from 'vue';
import { addPictureOnlyChannel, removePictureOnlyChannel, type GuildDetail } from '../../../../api/guilds';
import AppSelectField from '../../../../components/AppSelectField.vue';
import { useBotFeatureCard } from './use-bot-feature-card';
import { useChannelPicker } from './use-feature-pickers';

const props = defineProps<{ detail: GuildDetail }>();
const emit = defineEmits<{ (e: 'changed'): void }>();

const { detailLocal, error, action } = useBotFeatureCard(props.detail, () => emit('changed'));
const { channelPickerOptions } = useChannelPicker(detailLocal.value.guild.id);

const pictureChannel = ref<string>('');

async function addPicture() {
    if (!pictureChannel.value) return;
    if (await action('add-picture', () => addPictureOnlyChannel(detailLocal.value.guild.id, pictureChannel.value)) !== undefined) {
        pictureChannel.value = '';
    }
}
async function rmPicture(channelId: string) {
    await action('rm-picture', () => removePictureOnlyChannel(detailLocal.value.guild.id, channelId));
}
</script>

<template>
    <section class="card">
        <p v-if="error" class="error">{{ error }}</p>
        <header class="card-head">
            <h3>{{ $t('guilds.feature.pictureTitle') }}
                <span class="count-pill">{{ detailLocal.pictureOnlyChannels.length }}</span>
            </h3>
        </header>
        <p class="hint">{{ $t('guilds.feature.pictureHint') }}</p>
        <div class="form-row">
            <AppSelectField
                v-model="pictureChannel"
                :options="channelPickerOptions"
                :placeholder="$t('guilds.feature.channelPlaceholder')"
                :drawer-title="$t('guilds.feature.pictureTitle')"
            />
            <button type="button" class="primary submit" :disabled="!pictureChannel" @click="addPicture">
                {{ $t('guilds.feature.addBtn') }}
            </button>
        </div>
        <ul v-if="detailLocal.pictureOnlyChannels.length" class="bare">
            <li v-for="c in detailLocal.pictureOnlyChannels" :key="c.channelId" class="row">
                <span class="channel">#{{ c.channelName ?? c.channelId }}</span>
                <button type="button" class="ghost danger small" @click="rmPicture(c.channelId)">{{ $t('guilds.feature.removeBtn') }}</button>
            </li>
        </ul>
        <p v-else class="muted">{{ $t('guilds.feature.noEntries') }}</p>
    </section>
</template>

<style scoped src="./card.css"></style>
