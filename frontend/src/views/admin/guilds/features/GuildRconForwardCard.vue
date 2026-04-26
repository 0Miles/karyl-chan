<script setup lang="ts">
import { ref } from 'vue';
import {
    removeRconForward,
    upsertRconForward,
    type GuildDetail
} from '../../../../api/guilds';
import AppSelectField from '../../../../components/AppSelectField.vue';
import { useBotFeatureCard } from './use-bot-feature-card';
import { useChannelPicker } from './use-feature-pickers';

const props = defineProps<{ detail: GuildDetail }>();
const emit = defineEmits<{ (e: 'changed'): void }>();

const { detailLocal, error, action } = useBotFeatureCard(props.detail, () => emit('changed'));
const { channelPickerOptions } = useChannelPicker(detailLocal.value.guild.id);

const rconChannel = ref<string>('');
const rconHost = ref<string>('');
const rconPort = ref<string>('');
const rconPassword = ref<string>('');
const rconCmdPrefix = ref<string>('!');
const rconTriggerPrefix = ref<string>('');

async function saveRcon() {
    if (!rconChannel.value) return;
    const port = Number(rconPort.value);
    const ok = await action('save-rcon', () => upsertRconForward(detailLocal.value.guild.id, {
        channelId: rconChannel.value,
        host: rconHost.value || null,
        port: Number.isFinite(port) && port > 0 ? port : null,
        password: rconPassword.value || null,
        commandPrefix: rconCmdPrefix.value || null,
        triggerPrefix: rconTriggerPrefix.value || null
    }));
    if (ok !== undefined) {
        rconChannel.value = '';
        rconHost.value = '';
        rconPort.value = '';
        rconPassword.value = '';
        rconCmdPrefix.value = '!';
        rconTriggerPrefix.value = '';
    }
}
async function rmRcon(channelId: string) {
    await action('rm-rcon', () => removeRconForward(detailLocal.value.guild.id, channelId));
}
</script>

<template>
    <section class="card">
        <p v-if="error" class="error">{{ error }}</p>
        <header class="card-head">
            <h3>{{ $t('guilds.feature.rconTitle') }}
                <span class="count-pill">{{ detailLocal.rconForwardChannels.length }}</span>
            </h3>
        </header>
        <p class="hint">{{ $t('guilds.feature.rconHint') }}</p>
        <ul v-if="detailLocal.rconForwardChannels.length" class="bare">
            <li v-for="c in detailLocal.rconForwardChannels" :key="c.channelId" class="row">
                <div class="row-meta">
                    <span class="channel">#{{ c.channelName ?? c.channelId }}</span>
                    <span class="muted small"> {{ $t('guilds.rconTarget', { host: c.host ?? '—', port: c.port ?? '—', cmd: c.commandPrefix, trigger: c.triggerPrefix }) }}</span>
                </div>
                <button type="button" class="ghost danger small" @click="rmRcon(c.channelId)">{{ $t('guilds.feature.removeBtn') }}</button>
            </li>
        </ul>
        <p v-else class="muted">{{ $t('guilds.feature.noEntries') }}</p>
        <div class="form-grid">
            <div class="span-2">
                <AppSelectField
                    v-model="rconChannel"
                    :options="channelPickerOptions"
                    :placeholder="$t('guilds.feature.channelPlaceholder')"
                    :drawer-title="$t('guilds.feature.rconTitle')"
                />
            </div>
            <input v-model="rconHost" type="text" :placeholder="$t('guilds.feature.host')" />
            <input v-model="rconPort" type="number" :placeholder="$t('guilds.feature.port')" />
            <input v-model="rconPassword" type="password" :placeholder="$t('guilds.feature.password')" />
            <input v-model="rconCmdPrefix" type="text" :placeholder="$t('guilds.feature.commandPrefix')" />
            <input v-model="rconTriggerPrefix" type="text" :placeholder="$t('guilds.feature.triggerPrefix')" />
            <button type="button" class="primary span-2" :disabled="!rconChannel" @click="saveRcon">{{ $t('guilds.feature.saveBtn') }}</button>
        </div>
    </section>
</template>

<style scoped src="./card.css"></style>
