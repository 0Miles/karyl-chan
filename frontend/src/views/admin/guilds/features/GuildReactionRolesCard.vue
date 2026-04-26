<script setup lang="ts">
import { ref } from 'vue';
import {
    addRoleEmoji,
    addRoleReceiveMessage,
    removeRoleEmoji,
    removeRoleReceiveMessage,
    type GuildDetail
} from '../../../../api/guilds';
import AppSelectField from '../../../../components/AppSelectField.vue';
import { useBotFeatureCard } from './use-bot-feature-card';
import { useChannelPicker, useRolePicker } from './use-feature-pickers';

const props = defineProps<{ detail: GuildDetail }>();
const emit = defineEmits<{ (e: 'changed'): void }>();

const { detailLocal, error, action } = useBotFeatureCard(props.detail, () => emit('changed'));
const { channelPickerOptions } = useChannelPicker(detailLocal.value.guild.id);
const { rolePickerOptions } = useRolePicker(detailLocal.value.guild.id);

// Emoji → role mapping form state
const roleEmojiRoleId = ref<string>('');
const roleEmojiInput = ref<string>('');

// Watched-message form state
const roleReceiveChannel = ref<string>('');
const roleReceiveMessage = ref<string>('');

function customEmojiUrl(id: string): string {
    return `https://cdn.discordapp.com/emojis/${id}.webp?size=32&quality=lossless`;
}

async function addRE() {
    if (!roleEmojiRoleId.value || !roleEmojiInput.value) return;
    if (await action('add-role-emoji', () => addRoleEmoji(detailLocal.value.guild.id, roleEmojiRoleId.value, roleEmojiInput.value)) !== undefined) {
        roleEmojiInput.value = '';
        roleEmojiRoleId.value = '';
    }
}
async function rmRE(emojiChar: string, emojiId: string) {
    await action('rm-role-emoji', () => removeRoleEmoji(detailLocal.value.guild.id, { emojiChar, emojiId }));
}
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
    <div class="cards">
        <p v-if="error" class="error">{{ error }}</p>

        <!-- Emoji → role mappings -->
        <section class="card">
            <header class="card-head">
                <h3>{{ $t('guilds.feature.roleEmojiTitle') }}
                    <span class="count-pill">{{ detailLocal.roleEmojis.length }}</span>
                </h3>
            </header>
            <p class="hint">{{ $t('guilds.feature.roleEmojiHint') }}</p>
            <div class="form-row">
                <AppSelectField
                    v-model="roleEmojiRoleId"
                    :options="rolePickerOptions"
                    :placeholder="$t('guilds.feature.rolePlaceholder')"
                    :drawer-title="$t('guilds.feature.pickRole')"
                />
                <input v-model="roleEmojiInput" type="text" :placeholder="$t('guilds.feature.emoji')" />
                <small class="hint">{{ $t('guilds.feature.emojiHint') }}</small>
                <button type="button" class="primary submit" :disabled="!roleEmojiRoleId || !roleEmojiInput" @click="addRE">
                    {{ $t('guilds.feature.addBtn') }}
                </button>
            </div>
            <ul v-if="detailLocal.roleEmojis.length" class="bare">
                <li v-for="(r, idx) in detailLocal.roleEmojis" :key="idx" class="row">
                    <div class="row-meta">
                        <img v-if="r.emojiId" :src="customEmojiUrl(r.emojiId)" :alt="r.emojiName" class="emoji" />
                        <span v-else class="emoji-fallback">{{ r.emojiChar }}</span>
                        <span> → @{{ r.roleName ?? r.roleId }}</span>
                    </div>
                    <button type="button" class="ghost danger small" @click="rmRE(r.emojiChar, r.emojiId)">{{ $t('guilds.feature.removeBtn') }}</button>
                </li>
            </ul>
            <p v-else class="muted">{{ $t('guilds.feature.noEntries') }}</p>
        </section>

        <!-- Watched messages -->
        <section class="card">
            <header class="card-head">
                <h3>{{ $t('guilds.feature.roleReceiveTitle') }}
                    <span class="count-pill">{{ detailLocal.roleReceiveMessages.length }}</span>
                </h3>
            </header>
            <p class="hint">{{ $t('guilds.feature.roleReceiveHint') }}</p>
            <div class="form-row">
                <AppSelectField
                    v-model="roleReceiveChannel"
                    :options="channelPickerOptions"
                    :placeholder="$t('guilds.feature.channelPlaceholder')"
                    :drawer-title="$t('guilds.feature.roleReceiveTitle')"
                />
                <input v-model="roleReceiveMessage" type="text" inputmode="numeric" :placeholder="$t('guilds.feature.messageId')" />
                <button type="button" class="primary submit" :disabled="!roleReceiveChannel || !roleReceiveMessage" @click="addRRM">
                    {{ $t('guilds.feature.addBtn') }}
                </button>
            </div>
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
        </section>
    </div>
</template>

<style scoped src="./card.css"></style>
<style scoped>
.cards {
    display: flex;
    flex-direction: column;
    gap: 0.7rem;
}
</style>
