<script setup lang="ts">
import { ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { Icon } from '@iconify/vue';
import AppModal from '../../../components/AppModal.vue';
import { createGroupTarget, createUserTarget, type BehaviorTargetSummary } from '../../../api/behavior';

const { t } = useI18n();

const props = defineProps<{ visible: boolean }>();
const emit = defineEmits<{
    (e: 'close'): void;
    (e: 'created', target: BehaviorTargetSummary): void;
}>();

const kind = ref<'user' | 'group'>('user');
const userId = ref('');
const groupName = ref('');
const submitting = ref(false);
const error = ref<string | null>(null);

watch(() => props.visible, (open) => {
    if (open) {
        kind.value = 'user';
        userId.value = '';
        groupName.value = '';
        error.value = null;
        submitting.value = false;
    }
});

async function onSubmit() {
    if (submitting.value) return;
    error.value = null;
    submitting.value = true;
    try {
        let created: BehaviorTargetSummary;
        if (kind.value === 'user') {
            const id = userId.value.trim();
            if (!/^\d{17,20}$/.test(id)) {
                error.value = t('behaviors.modal.userIdInvalid');
                submitting.value = false;
                return;
            }
            created = await createUserTarget(id);
        } else {
            const name = groupName.value.trim();
            if (!name) {
                error.value = t('behaviors.modal.groupNameRequired');
                submitting.value = false;
                return;
            }
            created = await createGroupTarget(name);
        }
        emit('created', created);
        emit('close');
    } catch (err) {
        error.value = err instanceof Error ? err.message : String(err);
    } finally {
        submitting.value = false;
    }
}
</script>

<template>
    <AppModal :visible="visible" :title="t('behaviors.modal.addTarget')" @close="emit('close')">
        <form class="add-target-form" @submit.prevent="onSubmit">
            <fieldset class="kind-row">
                <legend class="sr-only">{{ t('behaviors.modal.kindLabel') }}</legend>
                <label class="kind-option">
                    <input type="radio" value="user" v-model="kind" class="sr-only" />
                    <Icon icon="material-symbols:person-rounded" width="18" height="18" />
                    <span>{{ t('behaviors.modal.kindUser') }}</span>
                </label>
                <label class="kind-option">
                    <input type="radio" value="group" v-model="kind" class="sr-only" />
                    <Icon icon="material-symbols:groups-outline-rounded" width="18" height="18" />
                    <span>{{ t('behaviors.modal.kindGroup') }}</span>
                </label>
            </fieldset>

            <label v-if="kind === 'user'" class="field">
                <span class="label">{{ t('behaviors.modal.userIdLabel') }}</span>
                <input
                    type="text"
                    v-model="userId"
                    inputmode="numeric"
                    pattern="\d*"
                    :placeholder="t('behaviors.modal.userIdPlaceholder')"
                    autofocus
                />
            </label>

            <label v-else class="field">
                <span class="label">{{ t('behaviors.modal.groupNameLabel') }}</span>
                <input
                    type="text"
                    v-model="groupName"
                    maxlength="80"
                    :placeholder="t('behaviors.modal.groupNamePlaceholder')"
                    autofocus
                />
            </label>

            <p v-if="error" class="error" role="alert">{{ error }}</p>

            <footer class="actions">
                <button type="button" class="ghost" @click="emit('close')" :disabled="submitting">
                    {{ t('common.cancel') }}
                </button>
                <button type="submit" class="primary" :disabled="submitting">
                    {{ submitting ? t('common.saving') : t('behaviors.modal.create') }}
                </button>
            </footer>
        </form>
    </AppModal>
</template>

<style scoped>
.add-target-form {
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
    padding: 0.9rem 1rem 1rem;
}
.kind-row {
    display: flex;
    gap: 0.4rem;
    border: 0;
    padding: 0;
    margin: 0;
}
.kind-row legend { display: contents; }
.kind-option {
    flex: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    padding: 0.7rem 0.6rem;
    border-radius: var(--radius-base);
    cursor: pointer;
    font-size: 0.9rem;
    color: var(--text-muted);
    background: var(--bg-page);
    border: 1px solid var(--border);
    transition: background 0.12s, color 0.12s, border-color 0.12s;
}
.kind-option:hover { background: var(--bg-surface-hover); color: var(--text); }
.kind-option:has(input:checked) {
    background: var(--accent-bg);
    color: var(--accent-text-strong);
    border-color: var(--accent);
    font-weight: 600;
}
.kind-option:has(input:focus-visible) {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
}
.field { display: flex; flex-direction: column; gap: 0.3rem; }
.label { font-size: 0.8rem; color: var(--text-muted); font-weight: 600; }
.field input {
    padding: 0.55rem 0.7rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg-surface);
    color: var(--text);
    font: inherit;
}
.field input:focus {
    outline: none;
    border-color: var(--accent);
}
.error {
    color: var(--danger);
    font-size: 0.85rem;
    margin: 0;
}
.actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
}
.actions button {
    padding: 0.5rem 0.9rem;
    border-radius: var(--radius-sm);
    font: inherit;
    cursor: pointer;
}
.actions .primary {
    background: var(--accent);
    color: var(--text-on-accent);
    border: 1px solid var(--accent);
}
.actions .primary:disabled { opacity: 0.6; cursor: progress; }
.actions .ghost {
    background: transparent;
    color: var(--text);
    border: 1px solid var(--border);
}
.sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
}
</style>
