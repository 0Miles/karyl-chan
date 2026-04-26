<script setup lang="ts">
import { ref } from 'vue';
import { addRoleReceiveMessage, removeRoleReceiveMessage, type GuildDetail } from '../../../../api/guilds';
import AppSelectField from '../../../../components/AppSelectField.vue';
import { useBotFeatureCard } from './use-bot-feature-card';
import { useChannelPicker } from './use-feature-pickers';

const props = defineProps<{ detail: GuildDetail }>();
const emit = defineEmits<{ (e: 'changed'): void }>();

const { detailLocal, error, action } = useBotFeatureCard(props.detail, () => emit('changed'));
const { channelPickerOptions } = useChannelPicker(detailLocal.value.guild.id);

const roleReceiveChannel = ref<string>('');
const roleReceiveMessage = ref<string>('');

async function addRRM() {
    if (!roleReceiveChannel.value || !roleReceiveMessage.value) return;
    if (await action('add-rrm', () => addRoleReceiveMessage(detailLocal.value.guild.id, roleReceiveChannel.value, roleReceiveMessage.value)) !== undefined) {
        roleReceiveChannel.value = '';
        roleReceiveMessage.value = '';
    }
}
async function rmRRM(channelId: string, messageId: string) {
    await action('rm-rrm', () => removeRoleReceiveMessage(detailLocal.value.guild.id, channelId, messageId));
}
</script>

<template>
    <section class="card">
        <p v-if="error" class="error">{{ error }}</p>
        <header class="card-head">
            <h3>{{ $t('guilds.feature.roleReceiveTitle') }}
                <span class="count-pill">{{ detailLocal.roleReceiveMessages.length }}</span>
            </h3>
        </header>
        <p class="hint">{{ $t('guilds.feature.roleReceiveHint') }}</p>
        <ul v-if="detailLocal.roleReceiveMessages.length" class="bare">
            <li v-for="(m, idx) in detailLocal.roleReceiveMessages" :key="idx" class="row">
                <div class="row-meta">
                    <span class="channel">#{{ m.channelName ?? m.channelId }}</span>
                    <span class="muted small"> {{ $t('guilds.roleReactionMessage', { id: m.messageId }) }}</span>
                </div>
                <button type="button" class="ghost danger small" @click="rmRRM(m.channelId, m.messageId)">{{ $t('guilds.feature.removeBtn') }}</button>
            </li>
        </ul>
        <p v-else class="muted">{{ $t('guilds.feature.noEntries') }}</p>
        <div class="form-grid">
            <AppSelectField
                v-model="roleReceiveChannel"
                :options="channelPickerOptions"
                :placeholder="$t('guilds.feature.channelPlaceholder')"
                :drawer-title="$t('guilds.feature.roleReceiveTitle')"
            />
            <input v-model="roleReceiveMessage" type="text" inputmode="numeric" :placeholder="$t('guilds.feature.messageId')" />
            <button type="button" class="primary span-2" :disabled="!roleReceiveChannel || !roleReceiveMessage" @click="addRRM">{{ $t('guilds.feature.addBtn') }}</button>
        </div>
    </section>
</template>

<style scoped src="./card.css"></style>
