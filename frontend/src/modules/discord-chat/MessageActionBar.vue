<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
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

const emit = defineEmits<{
    (e: 'react'): void;
    (e: 'reply'): void;
    (e: 'edit'): void;
    (e: 'copy-link'): void;
    (e: 'delete', event: MouseEvent): void;
    (e: 'register-react-button', el: HTMLButtonElement): void;
    (e: 'unregister-react-button'): void;
}>();

const reactButton = ref<HTMLButtonElement | null>(null);

onMounted(() => {
    if (reactButton.value) emit('register-react-button', reactButton.value);
});

onBeforeUnmount(() => {
    emit('unregister-react-button');
});

defineExpose({ reactButton });
</script>

<template>
    <div class="message-actions">
        <button
            ref="reactButton"
            type="button"
            :class="['action', { active: reacting }]"
            :title="$t('messages.react')"
            @click="emit('react')"
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
    border-radius: 4px;
    padding: 2px;
    opacity: 0;
    transition: opacity 0.15s;
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
