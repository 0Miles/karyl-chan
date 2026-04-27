<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { Icon } from '@iconify/vue';
import AppModal from '../../../components/AppModal.vue';
import { listChannelThreads, type GuildActiveThread } from '../../../api/guilds';

const props = defineProps<{
    visible: boolean;
    guildId: string | null;
    channelId: string | null;
    channelName: string | null;
}>();

const emit = defineEmits<{
    (e: 'close'): void;
    (e: 'pick', threadId: string): void;
}>();

const { t: $t } = useI18n();

const tab = ref<'active' | 'archived'>('active');
const active = ref<GuildActiveThread[]>([]);
const archived = ref<GuildActiveThread[]>([]);
const activeLoaded = ref(false);
const archivedLoaded = ref(false);
const loading = ref(false);
const error = ref<string | null>(null);

async function load(target: 'active' | 'archived') {
    if (!props.guildId || !props.channelId) return;
    if (target === 'active' && activeLoaded.value) return;
    if (target === 'archived' && archivedLoaded.value) return;
    loading.value = true;
    error.value = null;
    const guildId = props.guildId;
    const channelId = props.channelId;
    try {
        const result = await listChannelThreads(guildId, channelId, { archived: target === 'archived' });
        if (props.guildId !== guildId || props.channelId !== channelId) return;
        if (target === 'active') {
            active.value = result;
            activeLoaded.value = true;
        } else {
            archived.value = result;
            archivedLoaded.value = true;
        }
    } catch (err) {
        if (props.guildId !== guildId || props.channelId !== channelId) return;
        error.value = err instanceof Error ? err.message : 'Failed to load threads';
    } finally {
        if (props.guildId === guildId && props.channelId === channelId) loading.value = false;
    }
}

// Reset & refetch when the modal is opened or the channel changes; the
// archived tab loads lazily on first switch to avoid the extra REST call
// when the user only cares about active threads.
watch(() => [props.visible, props.guildId, props.channelId] as const, ([visible]) => {
    if (!visible) return;
    tab.value = 'active';
    active.value = [];
    archived.value = [];
    activeLoaded.value = false;
    archivedLoaded.value = false;
    error.value = null;
    void load('active');
}, { immediate: true });

watch(tab, (next) => {
    if (next === 'archived' && !archivedLoaded.value) void load('archived');
});

const visibleList = computed<GuildActiveThread[]>(() =>
    tab.value === 'active' ? active.value : archived.value
);

function pick(thread: GuildActiveThread) {
    emit('pick', thread.id);
    emit('close');
}
</script>

<template>
    <AppModal
        :visible="visible"
        :title="$t('threads.browseTitle', { channel: channelName ?? '' })"
        width="min(440px, 92vw)"
        @close="emit('close')"
    >
        <div class="tabs">
            <button
                type="button"
                :class="['tab', { active: tab === 'active' }]"
                @click="tab = 'active'"
            >{{ $t('threads.active') }}</button>
            <button
                type="button"
                :class="['tab', { active: tab === 'archived' }]"
                @click="tab = 'archived'"
            >{{ $t('threads.archived') }}</button>
        </div>
        <div class="body">
            <p v-if="loading" class="muted center">{{ $t('common.loading') }}</p>
            <p v-else-if="error" class="error">{{ error }}</p>
            <p v-else-if="visibleList.length === 0" class="muted center">{{ $t('threads.empty') }}</p>
            <ul v-else class="list">
                <li v-for="t in visibleList" :key="t.id" class="row" @click="pick(t)">
                    <Icon
                        :icon="t.locked ? 'material-symbols:lock-outline-rounded' : 'material-symbols:forum-outline-rounded'"
                        width="16" height="16"
                        class="row-icon"
                    />
                    <span class="row-name">{{ t.name }}</span>
                    <span v-if="t.messageCount > 0" class="row-meta">{{ $t('threads.messageCount', { count: t.messageCount }) }}</span>
                </li>
            </ul>
        </div>
    </AppModal>
</template>

<style scoped>
.tabs {
    display: flex;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
}
.tab {
    flex: 1;
    background: none;
    border: none;
    padding: 0.6rem 0.8rem;
    cursor: pointer;
    color: var(--text-muted);
    font: inherit;
    font-size: 0.88rem;
    border-bottom: 2px solid transparent;
}
.tab:hover { color: var(--text); }
.tab.active {
    color: var(--text-strong);
    border-bottom-color: var(--accent);
}
.body {
    padding: 0.4rem;
    max-height: 60vh;
    overflow-y: auto;
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
    border-radius: var(--radius-sm);
    cursor: pointer;
    color: var(--text);
}
.row:hover { background: var(--bg-surface-hover); }
.row-icon { color: var(--text-muted); flex-shrink: 0; }
.row-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.row-meta { font-size: 0.78rem; color: var(--text-muted); flex-shrink: 0; }
.muted { color: var(--text-muted); font-size: 0.88rem; }
.center { text-align: center; padding: 1.5rem 0; }
.error { color: var(--danger); padding: 0.8rem; }
</style>
