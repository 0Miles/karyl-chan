<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import AppModal from '../../../components/AppModal.vue';

const props = defineProps<{
    visible: boolean;
}>();

const emit = defineEmits<{
    (e: 'close'): void;
    (e: 'confirm', count: number): void;
}>();

const { t: $t } = useI18n();

// Default 10 — covers the common "clean up a chunk of spam" case while
// keeping the user from accidentally bulk-deleting a hundred messages
// just by accepting the default.
const count = ref(10);

watch(() => props.visible, (v) => { if (v) count.value = 10; });

const clamped = computed(() => Math.max(2, Math.min(100, Math.floor(count.value || 0))));

function submit() {
    emit('confirm', clamped.value);
}
</script>

<template>
    <AppModal :visible="visible" :title="$t('messageMgmt.bulkTitle')" width="min(380px, 92vw)" @close="emit('close')">
        <form class="body" @submit.prevent="submit">
            <label class="field">
                <span>{{ $t('messageMgmt.bulkCountLabel') }}</span>
                <input v-model.number="count" type="number" min="2" max="100" autofocus />
            </label>
            <footer class="actions">
                <button type="button" class="btn-ghost" @click="emit('close')">{{ $t('common.cancel') }}</button>
                <button type="submit" class="primary danger">
                    {{ $t('messageMgmt.bulkConfirm', { count: clamped }) }}
                </button>
            </footer>
        </form>
    </AppModal>
</template>

<style scoped>
.body {
    padding: 0.8rem 0.9rem;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
}
.field { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.85rem; }
.field span { color: var(--text-muted); }
.field input {
    padding: 0.4rem 0.55rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg-surface);
    color: var(--text);
    font: inherit;
    font-size: 0.9rem;
}
.actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
}
.btn-ghost,
.primary {
    padding: 0.45rem 0.9rem;
    border-radius: var(--radius-sm);
    font-size: 0.88rem;
}
.primary {
    background: var(--accent);
    color: var(--text-on-accent);
    border: 1px solid var(--accent);
    font-family: inherit;
    line-height: inherit;
    cursor: pointer;
}
.primary.danger {
    background: var(--danger);
    border-color: var(--danger);
}
</style>
