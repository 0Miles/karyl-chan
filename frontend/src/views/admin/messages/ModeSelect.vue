<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { GuildSummary } from '../../../api/guilds';
import AppSelect from '../../../components/AppSelect.vue';

const props = defineProps<{
    mode: string;
    guilds: GuildSummary[];
}>();

const emit = defineEmits<{
    (e: 'mode-change', mode: string): void;
}>();

const { t } = useI18n();
const isOpen = ref(false);

const selectedGuild = computed(() =>
    props.guilds.find(g => g.id === props.mode) ?? null
);

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
                <span v-else class="icon icon-dm">💬</span>
                <span class="label">{{ selectedGuild?.name ?? $t('messages.modeDm') }}</span>
                <span class="chevron" :class="{ open }">›</span>
            </button>
        </template>

        <ul class="mode-dropdown">
            <li :class="{ active: mode === 'dm' }" @click="select('dm')">
                <span class="icon icon-dm">💬</span>
                <span class="label">{{ $t('messages.modeDm') }}</span>
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
            </li>
        </ul>
    </AppSelect>
</template>

<style scoped>
/* AppPopover's trigger wrapper is display: contents, so the button
   below ends up as a direct flex child of the caller's container
   (sidebar-header). flex: 1 makes it fill the available width. */
.trigger {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.35rem 0.5rem;
    border: 1px solid var(--border);
    border-radius: 6px;
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

.icon {
    flex-shrink: 0;
    width: 20px;
    height: 20px;
    border-radius: 4px;
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
    transition: transform 0.15s;
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
    border-radius: 4px;
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
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

/* On mobile the drawer body owns the scroll region; release the
   popover-oriented max-height cap so the 70vh drawer drives it. Mirrors
   the useBreakpoint MOBILE_QUERY (max-width: 768px). */
@media (max-width: 768px) {
    .mode-dropdown { max-height: none; }
}
</style>
