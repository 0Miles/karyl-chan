<script setup lang="ts">
import { ref } from 'vue';
import { addTodoChannel, removeTodoChannel, type GuildDetail } from '../../api/guilds';
import AppSelectField from '../../components/AppSelectField.vue';
import { useBotFeatureCard } from '../_shared/use-bot-feature-card';
import { useChannelPicker } from '../_shared/use-feature-pickers';

const props = defineProps<{ detail: GuildDetail }>();
const emit = defineEmits<{ (e: 'changed'): void }>();

const { detailLocal, error, action } = useBotFeatureCard(props.detail, () => emit('changed'));
const { channelPickerOptions } = useChannelPicker(detailLocal.value.guild.id);

const todoChannel = ref<string>('');

async function addTodo() {
    if (!todoChannel.value) return;
    if (await action('add-todo', () => addTodoChannel(detailLocal.value.guild.id, todoChannel.value)) !== undefined) {
        todoChannel.value = '';
    }
}
async function rmTodo(channelId: string) {
    await action('rm-todo', () => removeTodoChannel(detailLocal.value.guild.id, channelId));
}
</script>

<template>
    <section class="card">
        <p v-if="error" class="error">{{ error }}</p>
        <header class="card-head">
            <h3>{{ $t('guilds.feature.todoTitle') }}
                <span class="count-pill">{{ detailLocal.todoChannels.length }}</span>
            </h3>
        </header>
        <p class="hint">{{ $t('guilds.feature.todoHint') }}</p>
        <div class="form-row">
            <AppSelectField
                v-model="todoChannel"
                :options="channelPickerOptions"
                :placeholder="$t('guilds.feature.channelPlaceholder')"
                :drawer-title="$t('guilds.feature.todoTitle')"
            />
            <button type="button" class="primary submit" :disabled="!todoChannel" @click="addTodo">
                {{ $t('guilds.feature.addBtn') }}
            </button>
        </div>
        <ul v-if="detailLocal.todoChannels.length" class="bare">
            <li v-for="c in detailLocal.todoChannels" :key="c.channelId" class="row">
                <span class="channel">#{{ c.channelName ?? c.channelId }}</span>
                <button type="button" class="ghost danger small" @click="rmTodo(c.channelId)">{{ $t('guilds.feature.removeBtn') }}</button>
            </li>
        </ul>
        <p v-else class="muted">{{ $t('guilds.feature.noEntries') }}</p>
    </section>
</template>

<style scoped src="../_shared/card.css"></style>
