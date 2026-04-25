<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { Icon } from '@iconify/vue';

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

function onKey(event: KeyboardEvent) {
    if (!props.visible) return;
    if (event.key === 'Escape') {
        event.preventDefault();
        emit('close');
    }
}
onMounted(() => window.addEventListener('keydown', onKey));
onUnmounted(() => window.removeEventListener('keydown', onKey));

const clamped = computed(() => Math.max(2, Math.min(100, Math.floor(count.value || 0))));

function submit() {
    emit('confirm', clamped.value);
}
</script>

<template>
    <Teleport to="body">
        <div v-if="visible" class="bd-backdrop" @click.self="emit('close')">
            <div class="bd-modal" role="dialog" aria-modal="true">
                <header class="bd-head">
                    <span>{{ $t('messageMgmt.bulkTitle') }}</span>
                    <button type="button" class="icon-btn" @click="emit('close')" :aria-label="$t('common.close')">
                        <Icon icon="material-symbols:close-rounded" width="18" height="18" />
                    </button>
                </header>
                <form class="bd-body" @submit.prevent="submit">
                    <label class="field">
                        <span>{{ $t('messageMgmt.bulkCountLabel') }}</span>
                        <input v-model.number="count" type="number" min="2" max="100" autofocus />
                    </label>
                    <footer class="bd-actions">
                        <button type="button" class="ghost" @click="emit('close')">{{ $t('common.cancel') }}</button>
                        <button type="submit" class="primary danger">
                            {{ $t('messageMgmt.bulkConfirm', { count: clamped }) }}
                        </button>
                    </footer>
                </form>
            </div>
        </div>
    </Teleport>
</template>

<style scoped>
.bd-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
}
.bd-modal {
    width: min(380px, 92vw);
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: 0 12px 36px rgba(0, 0, 0, 0.32);
    display: flex;
    flex-direction: column;
    overflow: hidden;
}
.bd-head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.6rem 0.9rem;
    border-bottom: 1px solid var(--border);
    font-weight: 600;
}
.bd-head span { flex: 1; }
.icon-btn {
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    padding: 0.2rem;
    display: inline-flex;
}
.icon-btn:hover { color: var(--text); }
.bd-body {
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
    border-radius: 4px;
    background: var(--bg);
    color: var(--text);
    font: inherit;
    font-size: 0.9rem;
}
.bd-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
}
.ghost,
.primary {
    padding: 0.45rem 0.9rem;
    border-radius: 4px;
    font: inherit;
    font-size: 0.88rem;
    cursor: pointer;
}
.ghost {
    background: none;
    border: 1px solid var(--border);
    color: var(--text);
}
.ghost:hover { background: var(--bg-surface-hover); }
.primary {
    background: var(--accent);
    color: var(--text-on-accent);
    border: 1px solid var(--accent);
}
.primary.danger {
    background: var(--danger);
    border-color: var(--danger);
}
</style>
