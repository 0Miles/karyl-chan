<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
    addRoleEmoji,
    addRoleEmojiGroup,
    addRoleReceiveMessage,
    removeRoleEmoji,
    removeRoleEmojiGroup,
    removeRoleReceiveMessage,
    setRoleReceiveMessageGroup,
    type GuildDetail
} from '../../../api/guilds';
import AppSelectField, { type SelectOption } from '../../../components/AppSelectField.vue';
import { useBotFeatureCard } from '../_shared/use-bot-feature-card';
import { useChannelPicker, useRolePicker } from '../_shared/use-feature-pickers';

const props = defineProps<{ detail: GuildDetail }>();
const emit = defineEmits<{ (e: 'changed'): void }>();

const { detailLocal, error, action } = useBotFeatureCard(props.detail, () => emit('changed'));
const { channelPickerOptions } = useChannelPicker(detailLocal.value.guild.id);
const { rolePickerOptions } = useRolePicker(detailLocal.value.guild.id);

// ── Group form state ───────────────────────────────────────────────────
const newGroupName = ref<string>('');

// ── Mapping form state ─────────────────────────────────────────────────
//
// `selectedGroupId` doubles as the active filter for the mapping list
// and the target group when adding a new mapping. Default to the first
// group so the form is usable as soon as one exists.
const selectedGroupId = ref<number | ''>('');
const mappingRoleId = ref<string>('');
const mappingEmojiInput = ref<string>('');

watch(
    () => detailLocal.value.roleEmojiGroups.map(g => g.id).join(','),
    () => {
        if (selectedGroupId.value === '' && detailLocal.value.roleEmojiGroups.length > 0) {
            selectedGroupId.value = detailLocal.value.roleEmojiGroups[0].id;
        } else if (selectedGroupId.value !== '' && !detailLocal.value.roleEmojiGroups.some(g => g.id === selectedGroupId.value)) {
            selectedGroupId.value = detailLocal.value.roleEmojiGroups[0]?.id ?? '';
        }
    },
    { immediate: true }
);

const groupPickerOptions = computed<SelectOption<number | ''>[]>(() => {
    const out: SelectOption<number | ''>[] = [];
    if (detailLocal.value.roleEmojiGroups.length === 0) {
        out.push({ value: '', label: '—' });
    }
    for (const g of detailLocal.value.roleEmojiGroups) {
        out.push({ value: g.id, label: g.name });
    }
    return out;
});

const mappingsInSelectedGroup = computed(() => {
    if (selectedGroupId.value === '') return [];
    const id = selectedGroupId.value;
    return detailLocal.value.roleEmojis.filter(r => r.groupId === id);
});

// ── Watched-message form state ─────────────────────────────────────────
//
// Each watched message is bound to exactly one group (matching the
// /role-emoji watch slash command's single-group design). The schema
// enforces this — a NOT NULL groupId column on RoleReceiveMessage.
const watchChannel = ref<string>('');
const watchMessage = ref<string>('');
const watchGroupId = ref<number | ''>('');

function customEmojiUrl(id: string): string {
    return `https://cdn.discordapp.com/emojis/${id}.webp?size=32&quality=lossless`;
}

// ── Group actions ──────────────────────────────────────────────────────
async function addGroup() {
    const name = newGroupName.value.trim();
    if (!name) return;
    if (await action('add-group', () => addRoleEmojiGroup(detailLocal.value.guild.id, name)) !== undefined) {
        newGroupName.value = '';
    }
}
async function removeGroup(id: number) {
    await action('rm-group', () => removeRoleEmojiGroup(detailLocal.value.guild.id, id));
}

// ── Mapping actions ────────────────────────────────────────────────────
async function addMapping() {
    if (selectedGroupId.value === '' || !mappingRoleId.value || !mappingEmojiInput.value) return;
    const groupId = selectedGroupId.value;
    const ok = await action('add-mapping', () => addRoleEmoji(
        detailLocal.value.guild.id,
        groupId,
        mappingRoleId.value,
        mappingEmojiInput.value
    ));
    if (ok !== undefined) {
        mappingEmojiInput.value = '';
        mappingRoleId.value = '';
    }
}
async function removeMapping(groupId: number, emojiChar: string, emojiId: string) {
    await action('rm-mapping', () => removeRoleEmoji(detailLocal.value.guild.id, { groupId, emojiChar, emojiId }));
}

// ── Watched-message actions ────────────────────────────────────────────
async function addWatchedMessage() {
    if (!watchChannel.value || !watchMessage.value || watchGroupId.value === '') return;
    const groupId = watchGroupId.value;
    const ok = await action('add-rrm', () => addRoleReceiveMessage(
        detailLocal.value.guild.id,
        watchChannel.value,
        watchMessage.value,
        groupId
    ));
    if (ok !== undefined) {
        watchChannel.value = '';
        watchMessage.value = '';
        watchGroupId.value = '';
    }
}
async function removeWatchedMessage(channelId: string, messageId: string) {
    await action('rm-rrm', () => removeRoleReceiveMessage(detailLocal.value.guild.id, channelId, messageId));
}
async function changeWatchedGroup(channelId: string, messageId: string, groupId: number | '') {
    if (groupId === '') return;
    await action('set-rrm-group', () => setRoleReceiveMessageGroup(
        detailLocal.value.guild.id,
        channelId,
        messageId,
        groupId
    ));
}
</script>

<template>
    <div class="cards">
        <p v-if="error" class="error">{{ error }}</p>

        <!-- Emoji groups -->
        <section class="card">
            <header class="card-head">
                <h3>{{ $t('guilds.feature.roleEmojiGroupsTitle') }}
                    <span class="count-pill">{{ detailLocal.roleEmojiGroups.length }}</span>
                </h3>
            </header>
            <p class="hint">{{ $t('guilds.feature.roleEmojiGroupsHint') }}</p>
            <div class="form-row">
                <input
                    v-model="newGroupName"
                    type="text"
                    :placeholder="$t('guilds.feature.roleEmojiGroupNamePlaceholder')"
                    @keyup.enter="addGroup"
                />
                <button type="button" class="primary submit" :disabled="!newGroupName.trim()" @click="addGroup">
                    {{ $t('guilds.feature.addBtn') }}
                </button>
            </div>
            <ul v-if="detailLocal.roleEmojiGroups.length" class="bare">
                <li v-for="g in detailLocal.roleEmojiGroups" :key="g.id" class="row">
                    <div class="row-meta">
                        <span class="group-name">{{ g.name }}</span>
                        <span class="muted small">
                            {{ $t('guilds.feature.mappingsCount', { n: detailLocal.roleEmojis.filter(r => r.groupId === g.id).length }) }}
                        </span>
                    </div>
                    <button type="button" class="ghost danger small" @click="removeGroup(g.id)">
                        {{ $t('guilds.feature.removeBtn') }}
                    </button>
                </li>
            </ul>
            <p v-else class="muted">{{ $t('guilds.feature.noEntries') }}</p>
        </section>

        <!-- Mappings within a group -->
        <section class="card">
            <header class="card-head">
                <h3>{{ $t('guilds.feature.roleEmojiTitle') }}
                    <span class="count-pill">{{ mappingsInSelectedGroup.length }}</span>
                </h3>
            </header>
            <p class="hint">{{ $t('guilds.feature.roleEmojiHint') }}</p>
            <div v-if="detailLocal.roleEmojiGroups.length === 0" class="muted">
                {{ $t('guilds.feature.roleEmojiCreateGroupFirst') }}
            </div>
            <template v-else>
                <div class="form-row">
                    <AppSelectField
                        v-model="selectedGroupId"
                        :options="groupPickerOptions"
                        :placeholder="$t('guilds.feature.roleEmojiGroupPickerPlaceholder')"
                        :drawer-title="$t('guilds.feature.roleEmojiGroupPickerPlaceholder')"
                    />
                    <AppSelectField
                        v-model="mappingRoleId"
                        :options="rolePickerOptions"
                        :placeholder="$t('guilds.feature.rolePlaceholder')"
                        :drawer-title="$t('guilds.feature.pickRole')"
                    />
                    <input v-model="mappingEmojiInput" type="text" :placeholder="$t('guilds.feature.emoji')" />
                    <small class="hint">{{ $t('guilds.feature.emojiHint') }}</small>
                    <button
                        type="button"
                        class="primary submit"
                        :disabled="selectedGroupId === '' || !mappingRoleId || !mappingEmojiInput"
                        @click="addMapping"
                    >
                        {{ $t('guilds.feature.addBtn') }}
                    </button>
                </div>
                <ul v-if="mappingsInSelectedGroup.length" class="bare">
                    <li v-for="(r, idx) in mappingsInSelectedGroup" :key="idx" class="row">
                        <div class="row-meta">
                            <img v-if="r.emojiId" :src="customEmojiUrl(r.emojiId)" :alt="r.emojiName" class="emoji" />
                            <span v-else class="emoji-fallback">{{ r.emojiChar }}</span>
                            <span> → @{{ r.roleName ?? r.roleId }}</span>
                        </div>
                        <button type="button" class="ghost danger small" @click="removeMapping(r.groupId, r.emojiChar, r.emojiId)">
                            {{ $t('guilds.feature.removeBtn') }}
                        </button>
                    </li>
                </ul>
                <p v-else class="muted">{{ $t('guilds.feature.noEntries') }}</p>
            </template>
        </section>

        <!-- Watched messages -->
        <section class="card">
            <header class="card-head">
                <h3>{{ $t('guilds.feature.roleReceiveTitle') }}
                    <span class="count-pill">{{ detailLocal.roleReceiveMessages.length }}</span>
                </h3>
            </header>
            <p class="hint">{{ $t('guilds.feature.roleReceiveHint') }}</p>
            <div v-if="detailLocal.roleEmojiGroups.length === 0" class="muted">
                {{ $t('guilds.feature.roleEmojiCreateGroupFirst') }}
            </div>
            <template v-else>
                <div class="form-row">
                    <AppSelectField
                        v-model="watchChannel"
                        :options="channelPickerOptions"
                        :placeholder="$t('guilds.feature.channelPlaceholder')"
                        :drawer-title="$t('guilds.feature.roleReceiveTitle')"
                    />
                    <input v-model="watchMessage" type="text" inputmode="numeric" :placeholder="$t('guilds.feature.messageId')" />
                    <AppSelectField
                        v-model="watchGroupId"
                        :options="groupPickerOptions"
                        :placeholder="$t('guilds.feature.roleEmojiGroupPickerPlaceholder')"
                        :drawer-title="$t('guilds.feature.roleEmojiGroupPickerPlaceholder')"
                    />
                    <button
                        type="button"
                        class="primary submit"
                        :disabled="!watchChannel || !watchMessage || watchGroupId === ''"
                        @click="addWatchedMessage"
                    >
                        {{ $t('guilds.feature.addBtn') }}
                    </button>
                </div>
            </template>
            <ul v-if="detailLocal.roleReceiveMessages.length" class="bare">
                <li v-for="(m, idx) in detailLocal.roleReceiveMessages" :key="idx" class="row watched">
                    <div class="row-meta">
                        <span class="channel">#{{ m.channelName ?? m.channelId }}</span>
                        <span class="muted small"> {{ $t('guilds.roleReactionMessage', { id: m.messageId }) }}</span>
                        <div class="watched-groups">
                            <span class="muted small">{{ $t('guilds.feature.roleReceiveGroupLabel') }}</span>
                            <AppSelectField
                                :model-value="m.groupId"
                                :options="groupPickerOptions"
                                :placeholder="$t('guilds.feature.roleEmojiGroupPickerPlaceholder')"
                                :drawer-title="$t('guilds.feature.roleEmojiGroupPickerPlaceholder')"
                                @update:model-value="changeWatchedGroup(m.channelId, m.messageId, $event as number | '')"
                            />
                        </div>
                    </div>
                    <button type="button" class="ghost danger small" @click="removeWatchedMessage(m.channelId, m.messageId)">
                        {{ $t('guilds.feature.removeBtn') }}
                    </button>
                </li>
            </ul>
            <p v-else class="muted">{{ $t('guilds.feature.noEntries') }}</p>
        </section>
    </div>
</template>

<style scoped src="../_shared/card.css"></style>
<style scoped>
.cards {
    display: flex;
    flex-direction: column;
    gap: 0.7rem;
}

.group-name {
    font-weight: 600;
}

.watched-groups {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.3rem;
    margin-top: 0.25rem;
}

.row.watched {
    align-items: flex-start;
}
</style>
