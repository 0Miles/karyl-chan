<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { Icon } from '@iconify/vue';
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

function onKey(event: KeyboardEvent) {
    if (!props.visible) return;
    if (event.key === 'Escape') {
        event.preventDefault();
        emit('close');
    }
}

onMounted(() => window.addEventListener('keydown', onKey));
onUnmounted(() => window.removeEventListener('keydown', onKey));

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
    <Teleport to="body">
        <div v-if="visible" class="fwd-backdrop" @click.self="emit('close')">
            <div class="fwd-modal" role="dialog" aria-modal="true">
                <header class="fwd-head">
                    <span>{{ $t('messages.forwardTitle') }}</span>
                    <button type="button" class="fwd-close" @click="emit('close')" :aria-label="$t('common.close')">
                        <Icon icon="material-symbols:close-rounded" width="18" height="18" />
                    </button>
                </header>
                <div class="fwd-search">
                    <input
                        v-model="filter"
                        type="text"
                        placeholder="#"
                        class="fwd-input"
                        autofocus
                    />
                </div>
                <div class="fwd-body">
                    <p v-if="filtered.length === 0" class="muted center">{{ $t('messages.forwardEmpty') }}</p>
                    <ul v-else class="fwd-list">
                        <li
                            v-for="ch in filtered"
                            :key="ch.id"
                            class="fwd-row"
                            @click="pick(ch.id)"
                        >
                            <Icon :icon="iconFor(ch.kind)" width="16" height="16" class="fwd-icon" />
                            <span class="fwd-name">{{ ch.name }}</span>
                        </li>
                    </ul>
                </div>
            </div>
        </div>
    </Teleport>
</template>

<style scoped>
.fwd-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
}
.fwd-modal {
    width: min(420px, 92vw);
    max-height: 70vh;
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: 0 12px 36px rgba(0, 0, 0, 0.32);
    display: flex;
    flex-direction: column;
    overflow: hidden;
}
.fwd-head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.6rem 0.9rem;
    border-bottom: 1px solid var(--border);
    font-weight: 600;
}
.fwd-head span { flex: 1; }
.fwd-close {
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    padding: 0.2rem;
    display: inline-flex;
}
.fwd-close:hover { color: var(--text); }
.fwd-search {
    padding: 0.6rem 0.9rem;
    border-bottom: 1px solid var(--border);
}
.fwd-input {
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
.fwd-body {
    flex: 1;
    overflow-y: auto;
    padding: 0.4rem;
}
.fwd-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
}
.fwd-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.45rem 0.6rem;
    border-radius: 4px;
    cursor: pointer;
    color: var(--text);
}
.fwd-row:hover { background: var(--bg-surface-hover); }
.fwd-icon { color: var(--text-muted); flex-shrink: 0; }
.fwd-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.muted { color: var(--text-muted); }
.center { text-align: center; padding: 1.5rem 0; }
</style>
