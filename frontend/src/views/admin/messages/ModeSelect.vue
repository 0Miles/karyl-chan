<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { GuildSummary } from '../../../api/guilds';
import { useUnreadStore } from '../../../modules/discord-chat/stores/unreadStore';
import AppSelect from '../../../components/AppSelect.vue';
import UnreadPill from '../../../components/UnreadPill.vue';
import { Icon } from '@iconify/vue';

const props = defineProps<{
    mode: string;
    guilds: GuildSummary[];
}>();

const emit = defineEmits<{
    (e: 'mode-change', mode: string): void;
}>();

const { t } = useI18n();
const isOpen = ref(false);
const unreadStore = useUnreadStore();

const selectedGuild = computed(() =>
    props.guilds.find(g => g.id === props.mode) ?? null
);

// Per-mode pill count: DM counts every unread, guild only @-mentions.
function dmPillCount(): number {
    return unreadStore.getModeCount('dm');
}
function guildPillCount(guildId: string): number {
    return unreadStore.getModeMentionCount(guildId);
}
function modePillCount(mode: string): number {
    return mode === 'dm' ? dmPillCount() : guildPillCount(mode);
}

const currentPillCount = computed(() => modePillCount(props.mode));
const otherModesHaveUnread = computed(() => {
    if (props.mode !== 'dm' && dmPillCount() > 0) return true;
    return props.guilds.some(g => g.id !== props.mode && guildPillCount(g.id) > 0);
});

function select(mode: string) {
    emit('mode-change', mode);
    isOpen.value = false;
}
</script>

<template>
    <AppSelect
        v-model:open="isOpen"
        :drawer-title="t('messages.modePickerTitle')"
    >
        <template #trigger="{ isOpen: open }">
            <button class="trigger" type="button">
                <img
                    v-if="selectedGuild?.iconUrl"
                    :src="selectedGuild.iconUrl"
                    alt=""
                    class="icon"
                />
                <span v-else-if="selectedGuild" class="icon icon-fallback">
                    {{ selectedGuild.name.charAt(0).toUpperCase() }}
                </span>
                <span v-else class="icon icon-dm">
                    <Icon icon="material-symbols:chat-bubble-rounded" width="20" height="20" />
                </span>
                <span class="label">{{ selectedGuild?.name ?? $t('messages.modeDm') }}</span>
                <UnreadPill class="trigger-pill" :count="currentPillCount" />
                <span class="chevron" :class="{ open }">›</span>
                <span v-if="otherModesHaveUnread" class="trigger-dot" aria-hidden="true"></span>
            </button>
        </template>

        <ul class="mode-dropdown">
            <li :class="{ active: mode === 'dm' }" @click="select('dm')">
                <span class="icon icon-dm">
                    <Icon icon="material-symbols:chat-bubble-rounded" width="20" height="20" />
                </span>
                <span class="label">{{ $t('messages.modeDm') }}</span>
                <UnreadPill class="mode-pill" :count="dmPillCount()" />
            </li>
            <li
                v-for="g in guilds"
                :key="g.id"
                :class="{ active: mode === g.id }"
                @click="select(g.id)"
            >
                <img v-if="g.iconUrl" :src="g.iconUrl" alt="" class="icon" />
                <span v-else class="icon icon-fallback">{{ g.name.charAt(0).toUpperCase() }}</span>
                <span class="label">{{ g.name }}</span>
                <UnreadPill class="mode-pill" :count="guildPillCount(g.id)" />
            </li>
        </ul>
    </AppSelect>
</template>

<style scoped>
/* AppPopover's trigger wrapper is display: contents, so the button
   below ends up as a direct flex child of the caller's container
   (sidebar-header). flex: 1 makes it fill the available width. */
.trigger {
    position: relative;
    flex: 1;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.35rem 0.5rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-base);
    background: var(--bg-surface);
    color: var(--text);
    font: inherit;
    font-size: 0.875rem;
    font-weight: 500;
    cursor: pointer;
    text-align: left;
    min-width: 0;
}
.trigger:hover { background: var(--bg-surface-hover); }
.trigger:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }

.trigger-dot {
    position: absolute;
    top: -4px;
    right: -4px;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--unread-accent, #f23f43);
    box-shadow: 0 0 0 2px var(--bg-surface);
    pointer-events: none;
}
.icon {
    flex-shrink: 0;
    width: 20px;
    height: 20px;
    border-radius: var(--radius-sm);
    object-fit: cover;
}
.icon-fallback {
    background: var(--accent);
    color: var(--text-on-accent);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.7rem;
    font-weight: 700;
    border-radius: 50%;
}
.icon-dm {
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.85rem;
}

.label {
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
    transition: transform var(--transition-base);
    transform: rotate(90deg);
}
.chevron.open { transform: rotate(270deg); }

/* Dropdown content. The same markup renders into either the popover
   (desktop) or the drawer (mobile) container provided by AppSelect —
   keep it self-contained so it looks right in both. */
.mode-dropdown {
    list-style: none;
    margin: 0;
    padding: 0.25rem 0;
    overflow-y: auto;
    max-height: 320px;
}
.mode-dropdown li {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.55rem 0.9rem;
    cursor: pointer;
    font-size: 0.9rem;
    font-weight: 500;
    color: var(--text);
}
.mode-dropdown li:hover { background: var(--bg-surface-hover); }
.mode-dropdown li.active { background: var(--bg-surface-active); }
.mode-dropdown li .icon {
    flex-shrink: 0;
    width: 24px;
    height: 24px;
    border-radius: var(--radius-sm);
    object-fit: cover;
}
.mode-dropdown li .icon-fallback {
    background: var(--accent);
    color: var(--text-on-accent);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.75rem;
    font-weight: 700;
    border-radius: 50%;
}
.mode-dropdown li .icon-dm {
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.95rem;
}
.mode-dropdown li .label {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.mode-pill { margin-left: auto; }
.trigger-pill { margin-left: auto; }

/* On mobile the drawer body owns the scroll region; release the
   popover-oriented max-height cap so the 70vh drawer drives it. Mirrors
   the useBreakpoint MOBILE_QUERY (max-width: 768px). */
@media (max-width: 768px) {
    .mode-dropdown { max-height: none; }
}
</style>
