<script setup lang="ts">
import { computed } from 'vue';
import { useConfirm } from '../composables/use-confirm';
import AppConfirmDialog from './AppConfirmDialog.vue';

const { pending, handleConfirm, handleClose } = useConfirm();

const visible = computed(() => pending.value !== null);
const opts = computed(() => pending.value?.options ?? {
    title: '', message: '', confirmLabel: ''
});
</script>

<template>
    <AppConfirmDialog
        :visible="visible"
        :title="opts.title"
        :message="opts.message"
        :confirm-label="opts.confirmLabel ?? 'OK'"
        :confirm-variant="opts.confirmVariant ?? 'primary'"
        :cancel-label="opts.cancelLabel"
        @confirm="handleConfirm"
        @close="handleClose"
    />
</template>
