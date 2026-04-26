<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
    addRoleEmoji,
    addRoleEmojiGroup,
    addRoleReceiveMessage,
    removeRoleEmoji,
    removeRoleEmojiGroup,
    removeRoleReceiveMessage,
    setRoleReceiveMessageGroups,
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
const watchChannel = ref<string>('');
const watchMessage = ref<string>('');
const watchGroupIds = ref<number[]>([]);

function customEmojiUrl(id: string): string {
    return `https://cdn.discordapp.com/emojis/${id}.webp?size=32&quality=lossless`;
}

function groupName(id: number): string {
    return detailLocal.value.roleEmojiGroups.find(g => g.id === id)?.name ?? `#${id}`;
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
    if (!watchChannel.value || !watchMessage.value) return;
    const ok = await action('add-rrm', () => addRoleReceiveMessage(
        detailLocal.value.guild.id,
        watchChannel.value,
        watchMessage.value,
        [...watchGroupIds.value]
    ));
    if (ok !== undefined) {
        watchChannel.value = '';
        watchMessage.value = '';
        watchGroupIds.value = [];
    }
}
async function removeWatchedMessage(channelId: string, messageId: string) {
    await action('rm-rrm', () => removeRoleReceiveMessage(detailLocal.value.guild.id, channelId, messageId));
}
async function toggleWatchedGroup(channelId: string, messageId: string, groupId: number) {
    const entry = detailLocal.value.roleReceiveMessages.find(
        m => m.channelId === channelId && m.messageId === messageId
    );
    if (!entry) return;
    const set = new Set(entry.groupIds);
    if (set.has(groupId)) set.delete(groupId);
    else set.add(groupId);
    await action('set-rrm-groups', () => setRoleReceiveMessageGroups(
        detailLocal.value.guild.id,
        channelId,
        messageId,
        [...set]
    ));
}

function isPicked(entry: { groupIds: number[] }, groupId: number): boolean {
    return entry.groupIds.includes(groupId);
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
            <div class="form-row">
                <AppSelectField
                    v-model="watchChannel"
                    :options="channelPickerOptions"
                    :placeholder="$t('guilds.feature.channelPlaceholder')"
                    :drawer-title="$t('guilds.feature.roleReceiveTitle')"
                />
                <input v-model="watchMessage" type="text" inputmode="numeric" :placeholder="$t('guilds.feature.messageId')" />
                <div v-if="detailLocal.roleEmojiGroups.length" class="group-pins">
                    <span class="muted small">{{ $t('guilds.feature.roleReceiveGroupsLabel') }}</span>
                    <label v-for="g in detailLocal.roleEmojiGroups" :key="g.id" class="group-chip">
                        <input
                            type="checkbox"
                            :checked="watchGroupIds.includes(g.id)"
                            @change="watchGroupIds = ($event.target as HTMLInputElement).checked
                                ? [...watchGroupIds, g.id]
                                : watchGroupIds.filter(id => id !== g.id)"
                        />
                        {{ g.name }}
                    </label>
                    <small class="muted small">{{ $t('guilds.feature.roleReceiveGroupsAllHint') }}</small>
                </div>
                <button type="button" class="primary submit" :disabled="!watchChannel || !watchMessage" @click="addWatchedMessage">
                    {{ $t('guilds.feature.addBtn') }}
                </button>
            </div>
            <ul v-if="detailLocal.roleReceiveMessages.length" class="bare">
                <li v-for="(m, idx) in detailLocal.roleReceiveMessages" :key="idx" class="row watched">
                    <div class="row-meta">
                        <span class="channel">#{{ m.channelName ?? m.channelId }}</span>
                        <span class="muted small"> {{ $t('guilds.roleReactionMessage', { id: m.messageId }) }}</span>
                        <div class="watched-groups">
                            <span class="muted small">{{ $t('guilds.feature.roleReceiveGroupsLabel') }}</span>
                            <template v-if="detailLocal.roleEmojiGroups.length">
                                <label v-for="g in detailLocal.roleEmojiGroups" :key="g.id" class="group-chip small">
                                    <input
                                        type="checkbox"
                                        :checked="isPicked(m, g.id)"
                                        @change="toggleWatchedGroup(m.channelId, m.messageId, g.id)"
                                    />
                                    {{ g.name }}
                                </label>
                                <span v-if="m.groupIds.length === 0" class="muted small">
                                    {{ $t('guilds.feature.roleReceiveGroupsAllActive') }}
                                </span>
                            </template>
                            <span v-else class="muted small">
                                {{ $t('guilds.feature.roleReceiveGroupsNone', { name: m.groupIds.map(groupName).join(', ') || '—' }) }}
                            </span>
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

.group-pins {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem;
    width: 100%;
    margin-top: 0.2rem;
}

.group-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.15rem 0.45rem;
    border: 1px solid var(--border-color, #ccc);
    border-radius: 999px;
    font-size: 0.85em;
    cursor: pointer;
}

.group-chip.small {
    font-size: 0.78em;
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
