<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref } from 'vue';
import type { GuildSummary } from '../../../api/guilds';
import { useClickOutsideStack } from '../../../composables/use-click-outside-stack';
import { useEscapeStack } from '../../../composables/use-escape-stack';

const props = defineProps<{
    mode: string;
    guilds: GuildSummary[];
}>();

const emit = defineEmits<{
    (e: 'mode-change', mode: string): void;
}>();

const isOpen = ref(false);
const triggerRef = ref<HTMLButtonElement | null>(null);
const dropdownStyle = ref<Record<string, string>>({});

const { register: regOutside, unregister: unregOutside } = useClickOutsideStack();
const { register: regEsc, unregister: unregEsc } = useEscapeStack();

const selectedGuild = computed(() =>
    props.guilds.find(g => g.id === props.mode) ?? null
);

async function open() {
    isOpen.value = true;
    await nextTick();
    if (triggerRef.value) {
        const rect = triggerRef.value.getBoundingClientRect();
        dropdownStyle.value = {
            position: 'fixed',
            top: `${rect.bottom + 4}px`,
            left: `${rect.left}px`,
            width: `${rect.width}px`,
            zIndex: '200'
        };
    }
    regOutside({
        shouldIgnore: () => false,
        isInside: (target) => triggerRef.value?.contains(target) ?? false,
        close: () => { isOpen.value = false; unregOutside(); unregEsc(); }
    });
    regEsc(() => { isOpen.value = false; unregOutside(); unregEsc(); });
}

function close() {
    isOpen.value = false;
    unregOutside();
    unregEsc();
}

function toggle() {
    if (isOpen.value) close();
    else open();
}

function select(mode: string) {
    emit('mode-change', mode);
    close();
}

onUnmounted(() => {
    unregOutside();
    unregEsc();
});
</script>

<template>
    <div class="mode-select">
        <button ref="triggerRef" class="trigger" type="button" @click="toggle">
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
            <span class="chevron" :class="{ open: isOpen }">›</span>
        </button>

        <Teleport to="body">
            <ul v-if="isOpen" class="mode-dropdown" :style="dropdownStyle">
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
        </Teleport>
    </div>
</template>

<style scoped>
.mode-select {
    flex: 1;
    min-width: 0;
}

.trigger {
    width: 100%;
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
</style>

<style>
.mode-dropdown {
    list-style: none;
    margin: 0;
    padding: 0.25rem 0;
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: 6px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
    overflow-y: auto;
    max-height: 320px;
}
.mode-dropdown li {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.45rem 0.75rem;
    cursor: pointer;
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--text);
}
.mode-dropdown li:hover { background: var(--bg-surface-hover); }
.mode-dropdown li.active { background: var(--bg-surface-active); }
.mode-dropdown li .icon {
    flex-shrink: 0;
    width: 20px;
    height: 20px;
    border-radius: 4px;
    object-fit: cover;
}
.mode-dropdown li .icon-fallback {
    background: var(--accent);
    color: var(--text-on-accent);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.7rem;
    font-weight: 700;
    border-radius: 50%;
}
.mode-dropdown li .icon-dm {
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.85rem;
}
.mode-dropdown li .label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
</style>
