<script setup lang="ts">
import { toRef } from 'vue';
import { Icon } from '@iconify/vue';
import { useI18n } from 'vue-i18n';
import PinnedPanel from './PinnedPanel.vue';
import { useMuteControl } from './useMuteControl';
import { usePinnedMessages } from './usePinnedMessages';
import type { Message } from '../../libs/messages/types';

const { t: $t } = useI18n();

type PinFetcher = (channelId: string) => Promise<Message[]>;

const props = defineProps<{
    channelId: string | null;
    headerTitle?: string | null;
    headerSubtitle?: string | null;
    canBrowseThreads?: boolean;
    pinFetcher?: PinFetcher | null;
}>();

const emit = defineEmits<{
    (e: 'browse-threads'): void;
    (e: 'jump-to-message', messageId: string): void;
}>();

const { isMuted, muteIcon, muteTooltip, toggleMute } = useMuteControl(toRef(props, 'channelId'));

const { pinsOpen, pinsLoading, pinsError, pinsList, togglePins, onPinJump } = usePinnedMessages({
    channelId: toRef(props, 'channelId'),
    pinFetcher: toRef(props, 'pinFetcher'),
    emit: (event, id) => emit(event, id),
});
</script>

<template>
    <header class="conv-header">
        <slot>
            <span class="title">{{ headerTitle }}</span>
            <span v-if="headerSubtitle" class="subtitle">{{ headerSubtitle }}</span>
            <span class="header-spacer"></span>
            <button
                v-if="canBrowseThreads"
                type="button"
                class="header-action"
                :title="$t('threads.view')"
                :aria-label="$t('threads.view')"
                @click="emit('browse-threads')"
            >
                <Icon icon="material-symbols:forum-outline-rounded" width="18" height="18" />
            </button>
            <button
                v-if="pinFetcher"
                type="button"
                :class="['header-action', { active: pinsOpen }]"
                :title="$t('messages.pinnedMessages')"
                :aria-label="$t('messages.pinnedMessages')"
                data-pins-trigger
                @click="togglePins"
            >
                <Icon icon="material-symbols:keep-outline-rounded" width="18" height="18" />
            </button>
            <button
                type="button"
                :class="['header-action', { active: isMuted }]"
                :title="muteTooltip"
                :aria-label="muteTooltip"
                @click="toggleMute"
            >
                <Icon :icon="muteIcon" width="18" height="18" />
            </button>
        </slot>
        <PinnedPanel
            :visible="pinsOpen"
            :loading="pinsLoading"
            :error="pinsError"
            :messages="pinsList"
            @close="pinsOpen = false"
            @jump="onPinJump"
        />
    </header>
</template>

<style scoped>
.conv-header {
    height: 54px;
    padding: 1rem;
    border-bottom: 1px solid var(--border);
    display: flex;
    align-items: center;
    gap: 0.5rem;
    /* Anchor for the absolutely-positioned PinnedPanel below. */
    position: relative;
}
@media (max-width: 768px) {
    .conv-header {
        height: auto;
    }
}
.title { font-weight: 600; color: var(--text-strong); }
.subtitle {
    color: var(--text-faint);
    font-size: 0.8rem;
    font-family: ui-monospace, SFMono-Regular, monospace;
}
.header-spacer { flex: 1; }
.header-action {
    background: none;
    border: 1px solid transparent;
    border-radius: 4px;
    padding: 4px;
    cursor: pointer;
    color: var(--text-muted);
    line-height: 0;
    transition: background 0.12s, color 0.12s, border-color 0.12s;
}
.header-action:hover { background: var(--bg-surface-hover); color: var(--text); }
.header-action.active { color: var(--accent-text-strong); border-color: var(--accent); }
</style>
