<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { Icon } from '@iconify/vue';
import AppModal from '../../../components/AppModal.vue';
import AppSelect from '../../../components/AppSelect.vue';
import {
    listGuildTextChannels,
    type GuildChannelCategory,
    type GuildSummary,
    type GuildTextChannel
} from '../../../api/guilds';
import { listChannels as listDmChannels, type DmChannelSummary } from '../../../api/dm';

const { t: $t } = useI18n();

const props = defineProps<{
    visible: boolean;
    /** Pre-loaded guilds the bot is in. The picker uses this to populate
     *  the destination dropdown without an extra round-trip. */
    guilds: GuildSummary[];
    /** When set, the dropdown defaults to this guild — typical case is
     *  forwarding within the active guild. Pass null when invoking from a
     *  DM surface; the DMs option becomes the default instead. */
    currentGuildId: string | null;
}>();

const emit = defineEmits<{
    (e: 'close'): void;
    /** Caller routes the forward call. The picker emits the chosen
     *  channel id only; surface (guild vs DM) is implicit on the
     *  backend, which dispatches via channel resolution. */
    (e: 'pick', channelId: string): void;
}>();

const DM_KEY = '__dm__';

// Selected destination — either a guild id or DM_KEY for the DMs list.
// Defaults to the current guild when one is provided, falling back to
// the first guild or DMs when not.
const selected = ref<string>('');
const filter = ref('');

// Per-guild channel cache. The current guild's tree comes pre-loaded
// in `categories`; other guilds are fetched lazily on selection so the
// picker doesn't fan out N requests up-front.
const guildChannelCache = ref<Record<string, GuildChannelCategory[]>>({});
const guildLoading = ref(false);
const guildError = ref<string | null>(null);

const dmChannels = ref<DmChannelSummary[]>([]);
const dmLoaded = ref(false);
const dmLoading = ref(false);
const dmError = ref<string | null>(null);

watch(() => props.visible, (v) => {
    if (!v) return;
    selected.value = props.currentGuildId
        ?? (props.guilds[0]?.id ?? DM_KEY);
    filter.value = '';
    void loadFor(selected.value);
}, { immediate: true });

watch(selected, (v) => {
    filter.value = '';
    void loadFor(v);
});

async function loadFor(value: string) {
    guildError.value = null;
    dmError.value = null;
    if (value === DM_KEY) {
        if (dmLoaded.value || dmLoading.value) return;
        dmLoading.value = true;
        try {
            dmChannels.value = await listDmChannels();
            dmLoaded.value = true;
        } catch (err) {
            dmError.value = err instanceof Error ? err.message : 'Failed to load DMs';
        } finally {
            dmLoading.value = false;
        }
        return;
    }
    if (guildChannelCache.value[value]) return;
    guildLoading.value = true;
    try {
        const cats = await listGuildTextChannels(value);
        if (selected.value !== value) return;
        guildChannelCache.value = { ...guildChannelCache.value, [value]: cats };
    } catch (err) {
        if (selected.value !== value) return;
        guildError.value = err instanceof Error ? err.message : 'Failed to load channels';
    } finally {
        if (selected.value === value) guildLoading.value = false;
    }
}

const guildChannelsFlat = computed<GuildTextChannel[]>(() => {
    if (selected.value === DM_KEY) return [];
    const cats = guildChannelCache.value[selected.value] ?? [];
    return cats.flatMap(c => c.channels).filter(c => c.kind !== 'forum');
});

const filteredChannels = computed<GuildTextChannel[]>(() => {
    const q = filter.value.trim().toLowerCase();
    if (!q) return guildChannelsFlat.value;
    return guildChannelsFlat.value.filter(c => c.name.toLowerCase().includes(q));
});

const filteredDms = computed<DmChannelSummary[]>(() => {
    const q = filter.value.trim().toLowerCase();
    if (!q) return dmChannels.value;
    return dmChannels.value.filter(c => {
        const name = (c.recipient.globalName ?? c.recipient.username ?? '').toLowerCase();
        return name.includes(q);
    });
});

function pick(channelId: string) {
    emit('pick', channelId);
}

// AppSelect open state lives here so we can close it after the user
// picks a destination from the list.
const destOpen = ref(false);
function pickDestination(value: string) {
    selected.value = value;
    destOpen.value = false;
}

const selectedGuild = computed<GuildSummary | null>(() =>
    selected.value === DM_KEY ? null : (props.guilds.find(g => g.id === selected.value) ?? null)
);
const selectedLabel = computed<string>(() =>
    selected.value === DM_KEY
        ? $t('messages.modeDm')
        : (selectedGuild.value?.name ?? '')
);

function iconFor(kind: GuildTextChannel['kind']): string {
    switch (kind) {
        case 'voice': return 'material-symbols:volume-up-outline-rounded';
        case 'stage': return 'material-symbols:campaign-outline-rounded';
        case 'forum': return 'material-symbols:forum-outline-rounded';
        default: return 'material-symbols:tag-rounded';
    }
}

const isLoading = computed(() => selected.value === DM_KEY ? dmLoading.value : guildLoading.value);
const errorMessage = computed(() => selected.value === DM_KEY ? dmError.value : guildError.value);
</script>

<template>
    <AppModal :visible="visible" :title="$t('messages.forwardTitle')" width="min(440px, 92vw)" @close="emit('close')">
        <div class="dest">
            <label class="dest-label">{{ $t('messages.forwardDestination') }}</label>
            <AppSelect
                v-model:open="destOpen"
                :drawer-title="$t('messages.forwardDestination')"
            >
                <template #trigger="{ isOpen: open }">
                    <button class="dest-trigger" type="button">
                        <img v-if="selectedGuild?.iconUrl" :src="selectedGuild.iconUrl" alt="" class="dest-icon" />
                        <span v-else-if="selectedGuild" class="dest-icon dest-icon-fallback">
                            {{ selectedGuild.name.charAt(0).toUpperCase() }}
                        </span>
                        <span v-else class="dest-icon dest-icon-dm">
                            <Icon icon="material-symbols:chat-bubble-rounded" width="18" height="18" />
                        </span>
                        <span class="dest-label-text">{{ selectedLabel }}</span>
                        <span class="chevron" :class="{ open }">›</span>
                    </button>
                </template>
                <ul class="dest-options">
                    <li
                        :class="{ active: selected === DM_KEY }"
                        @click="pickDestination(DM_KEY)"
                    >
                        <span class="dest-icon dest-icon-dm">
                            <Icon icon="material-symbols:chat-bubble-rounded" width="20" height="20" />
                        </span>
                        <span class="dest-label-text">{{ $t('messages.modeDm') }}</span>
                    </li>
                    <li
                        v-for="g in guilds"
                        :key="g.id"
                        :class="{ active: selected === g.id }"
                        @click="pickDestination(g.id)"
                    >
                        <img v-if="g.iconUrl" :src="g.iconUrl" alt="" class="dest-icon" />
                        <span v-else class="dest-icon dest-icon-fallback">{{ g.name.charAt(0).toUpperCase() }}</span>
                        <span class="dest-label-text">{{ g.name }}</span>
                    </li>
                </ul>
            </AppSelect>
        </div>
        <div class="search">
            <input
                v-model="filter"
                type="text"
                :placeholder="$t('messages.forwardSearchPlaceholder')"
                class="input"
            />
        </div>
        <div class="body">
            <p v-if="isLoading" class="muted center">{{ $t('common.loading') }}</p>
            <p v-else-if="errorMessage" class="error">{{ errorMessage }}</p>
            <template v-else-if="selected === DM_KEY">
                <p v-if="filteredDms.length === 0" class="muted center">{{ $t('messages.forwardEmpty') }}</p>
                <ul v-else class="list">
                    <li v-for="dm in filteredDms" :key="dm.id" class="row" @click="pick(dm.id)">
                        <img v-if="dm.recipient.avatarUrl" :src="dm.recipient.avatarUrl" alt="" class="avatar" />
                        <div v-else class="avatar avatar-fallback">
                            {{ (dm.recipient.globalName ?? dm.recipient.username ?? '?').charAt(0).toUpperCase() }}
                        </div>
                        <span class="row-name">
                            {{ dm.recipient.globalName ?? dm.recipient.username }}
                        </span>
                    </li>
                </ul>
            </template>
            <template v-else>
                <p v-if="filteredChannels.length === 0" class="muted center">{{ $t('messages.forwardEmpty') }}</p>
                <ul v-else class="list">
                    <li v-for="ch in filteredChannels" :key="ch.id" class="row" @click="pick(ch.id)">
                        <Icon :icon="iconFor(ch.kind)" width="16" height="16" class="row-icon" />
                        <span class="row-name">{{ ch.name }}</span>
                    </li>
                </ul>
            </template>
        </div>
    </AppModal>
</template>

<style scoped>
.dest {
    padding: 0.6rem 0.9rem 0;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
}
.dest-label {
    font-size: 0.78rem;
    color: var(--text-muted);
}
.dest-trigger {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    box-sizing: border-box;
    padding: 0.4rem 0.55rem;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg);
    color: var(--text);
    font: inherit;
    font-size: 0.9rem;
    cursor: pointer;
    text-align: left;
}
.dest-trigger:hover { background: var(--bg-surface-hover); }
.dest-icon {
    flex-shrink: 0;
    width: 22px;
    height: 22px;
    border-radius: 4px;
    object-fit: cover;
}
.dest-icon-fallback {
    background: var(--accent);
    color: var(--text-on-accent);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.72rem;
    font-weight: 700;
    border-radius: 50%;
}
.dest-icon-dm {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
}
.dest-label-text {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.chevron {
    flex-shrink: 0;
    font-size: 0.9rem;
    color: var(--text-muted);
    transition: transform 0.15s;
    transform: rotate(90deg);
}
.chevron.open { transform: rotate(270deg); }
.dest-options {
    list-style: none;
    margin: 0;
    padding: 0.25rem 0;
    overflow-y: auto;
    max-height: 320px;
}
.dest-options li {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.7rem;
    cursor: pointer;
    color: var(--text);
    font-size: 0.9rem;
}
.dest-options li:hover { background: var(--bg-surface-hover); }
.dest-options li.active { background: var(--bg-surface-active); }
.dest-options li .dest-icon { width: 24px; height: 24px; }
@media (max-width: 768px) {
    .dest-options { max-height: none; }
}
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
    max-height: 50vh;
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
    gap: 0.6rem;
    padding: 0.5rem 0.6rem;
    border-radius: 4px;
    cursor: pointer;
    color: var(--text);
}
.row:hover { background: var(--bg-surface-hover); }
.row-icon { color: var(--text-muted); flex-shrink: 0; }
.row-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
.avatar {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    object-fit: cover;
    flex-shrink: 0;
    background: var(--bg-surface-2);
}
.avatar-fallback {
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--accent);
    color: var(--text-on-accent);
    font-weight: 600;
    font-size: 0.78rem;
}
.muted { color: var(--text-muted); }
.center { text-align: center; padding: 1.5rem 0; }
.error { color: var(--danger); padding: 0.8rem; }
</style>
