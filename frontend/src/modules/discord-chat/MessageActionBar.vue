<script setup lang="ts">
import { Icon } from '@iconify/vue';
import { useI18n } from 'vue-i18n';
import type { Message } from '../../libs/messages/types';

const { t: $t } = useI18n();

const props = defineProps<{
    message: Message;
    isOwn: boolean;
    shiftHeld: boolean;
    reacting: boolean;
    copied: boolean;
}>();

// React fires with the button DOM the click landed on. Earlier versions
// kept a Map<messageId, button> populated via onMounted/onBeforeUnmount,
// which silently broke inside DynamicScroller — the scroller recycles
// the same component instance across rows, so onMounted only fires once
// and the Map's (id → button) pair stays bound to whichever message the
// view rendered first. Reading `currentTarget` per click is reuse-proof
// (the button DOM is always the one the user just pressed, which is the
// row currently mounted).
const emit = defineEmits<{
    (e: 'react', el: HTMLButtonElement): void;
    (e: 'reply'): void;
    (e: 'edit'): void;
    (e: 'copy-link'): void;
    (e: 'delete', event: MouseEvent): void;
}>();

function onReactClick(ev: MouseEvent) {
    emit('react', ev.currentTarget as HTMLButtonElement);
}
</script>

<template>
    <div class="message-actions">
        <button
            type="button"
            :class="['action', { active: reacting }]"
            :title="$t('messages.react')"
            @click="onReactClick"
        >
            <Icon icon="material-symbols:add-reaction-rounded" width="16" height="16" />
        </button>
        <button type="button" class="action" :title="$t('messages.reply')" @click="emit('reply')">
            <Icon icon="material-symbols:reply-rounded" width="16" height="16" />
        </button>
        <template v-if="isOwn">
            <button type="button" class="action" :title="$t('messages.edit')" @click="emit('edit')">
                <Icon icon="material-symbols:edit-rounded" width="16" height="16" />
            </button>
        </template>
        <button
            type="button"
            :class="['action', { copied: copied }]"
            :title="copied ? $t('messages.copyLinkDone') : $t('messages.copyLink')"
            @click="emit('copy-link')"
        >
            <Icon :icon="copied ? 'material-symbols:check-rounded' : 'material-symbols:link-rounded'" width="16" height="16" />
        </button>
        <template v-if="isOwn">
            <button
                type="button"
                :class="['action', { danger: shiftHeld }]"
                :title="shiftHeld ? $t('messages.deleteNoConfirm') : $t('messages.deleteShiftConfirm')"
                @click="emit('delete', $event)"
            >
                <Icon icon="material-symbols:delete-rounded" width="16" height="16" />
            </button>
        </template>
    </div>
</template>

<style scoped>
.message-actions {
    position: absolute;
    top: 4px;
    right: 12px;
    display: flex;
    gap: 0.2rem;
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 2px;
    opacity: 0;
    transition: opacity var(--transition-base);
    z-index: 2;
}
.action {
    background: none;
    border: none;
    cursor: pointer;
    padding: 4px;
    border-radius: 3px;
    color: var(--text);
    line-height: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
}
.action:hover { background: var(--bg-surface-hover); }
.action.active {
    background: var(--accent-bg);
    color: var(--accent-text-strong);
}
.action.danger {
    background: rgba(239, 68, 68, 0.18);
    color: var(--danger);
}
.action.copied {
    background: var(--accent-bg);
    color: var(--accent-text-strong);
}
</style>
