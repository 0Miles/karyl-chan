<script setup lang="ts">
import { computed, ref } from 'vue';
import { Icon } from '@iconify/vue';
import AppModal from '../../../components/AppModal.vue';
import type { GuildChannelCategory, GuildTextChannel } from '../../../api/guilds';

const props = defineProps<{
    visible: boolean;
    /** Pre-loaded categories from the guild — every text/voice channel
     *  with `lastMessageId` support is offered as a destination. Forum
     *  channels are excluded because Discord forwards into a thread,
     *  not a forum root. */
    categories: GuildChannelCategory[];
}>();

const emit = defineEmits<{
    (e: 'close'): void;
    (e: 'pick', channelId: string): void;
}>();

const filter = ref('');

const flatChannels = computed<GuildTextChannel[]>(() =>
    props.categories.flatMap(c => c.channels).filter(c => c.kind !== 'forum')
);

const filtered = computed<GuildTextChannel[]>(() => {
    const q = filter.value.trim().toLowerCase();
    if (!q) return flatChannels.value;
    return flatChannels.value.filter(c => c.name.toLowerCase().includes(q));
});

function pick(channelId: string) {
    emit('pick', channelId);
}

function iconFor(kind: GuildTextChannel['kind']): string {
    switch (kind) {
        case 'voice': return 'material-symbols:volume-up-outline-rounded';
        case 'stage': return 'material-symbols:campaign-outline-rounded';
        case 'forum': return 'material-symbols:forum-outline-rounded';
        default: return 'material-symbols:tag-rounded';
    }
}
</script>

<template>
    <AppModal :visible="visible" :title="$t('messages.forwardTitle')" width="min(420px, 92vw)" @close="emit('close')">
        <div class="search">
            <input
                v-model="filter"
                type="text"
                placeholder="#"
                class="input"
                autofocus
            />
        </div>
        <div class="body">
            <p v-if="filtered.length === 0" class="muted center">{{ $t('messages.forwardEmpty') }}</p>
            <ul v-else class="list">
                <li
                    v-for="ch in filtered"
                    :key="ch.id"
                    class="row"
                    @click="pick(ch.id)"
                >
                    <Icon :icon="iconFor(ch.kind)" width="16" height="16" class="row-icon" />
                    <span class="row-name">{{ ch.name }}</span>
                </li>
            </ul>
        </div>
    </AppModal>
</template>

<style scoped>
.search {
    padding: 0.6rem 0.9rem;
    border-bottom: 1px solid var(--border);
}
.input {
    width: 100%;
    box-sizing: border-box;
    padding: 0.4rem 0.6rem;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text);
    font: inherit;
    font-size: 0.9rem;
}
.body {
    flex: 1;
    overflow-y: auto;
    padding: 0.4rem;
    /* On the desktop branch the panel itself is height-bounded; on the
       drawer branch the parent body wrapper handles scrolling so this
       inner overflow is harmless either way. */
    max-height: 60vh;
}
.list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
}
.row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.55rem 0.6rem;
    border-radius: 4px;
    cursor: pointer;
    color: var(--text);
}
.row:hover { background: var(--bg-surface-hover); }
.row-icon { color: var(--text-muted); flex-shrink: 0; }
.row-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.muted { color: var(--text-muted); }
.center { text-align: center; padding: 1.5rem 0; }
</style>
