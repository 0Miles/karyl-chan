<script setup lang="ts">
import { ref } from 'vue';
import { addRoleEmoji, removeRoleEmoji, type GuildDetail } from '../../../../api/guilds';
import AppSelectField from '../../../../components/AppSelectField.vue';
import { useBotFeatureCard } from './use-bot-feature-card';
import { useRolePicker } from './use-feature-pickers';

const props = defineProps<{ detail: GuildDetail }>();
const emit = defineEmits<{ (e: 'changed'): void }>();

const { detailLocal, error, action } = useBotFeatureCard(props.detail, () => emit('changed'));
const { rolePickerOptions } = useRolePicker(detailLocal.value.guild.id);

const roleEmojiRoleId = ref<string>('');
const roleEmojiInput = ref<string>('');

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
</script>

<template>
    <section class="card">
        <p v-if="error" class="error">{{ error }}</p>
        <header class="card-head">
            <h3>{{ $t('guilds.feature.roleEmojiTitle') }}
                <span class="count-pill">{{ detailLocal.roleEmojis.length }}</span>
            </h3>
        </header>
        <p class="hint">{{ $t('guilds.feature.roleEmojiHint') }}</p>
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
        <div class="form-grid">
            <AppSelectField
                v-model="roleEmojiRoleId"
                :options="rolePickerOptions"
                :placeholder="$t('guilds.feature.rolePlaceholder')"
                :drawer-title="$t('guilds.feature.pickRole')"
            />
            <input v-model="roleEmojiInput" type="text" :placeholder="$t('guilds.feature.emoji')" />
            <small class="hint span-2">{{ $t('guilds.feature.emojiHint') }}</small>
            <button type="button" class="primary span-2" :disabled="!roleEmojiRoleId || !roleEmojiInput" @click="addRE">{{ $t('guilds.feature.addBtn') }}</button>
        </div>
    </section>
</template>

<style scoped src="./card.css"></style>
