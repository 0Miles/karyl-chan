<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { Icon } from '@iconify/vue';
import AppModal from '../../../components/AppModal.vue';
import AppSelectField from '../../../components/AppSelectField.vue';
import AppButton from '../../../components/AppButton.vue';
import {
    createBehaviorV2,
    type BehaviorRow,
    type BehaviorTriggerType,
    type BehaviorWebhookAuthMode,
    type ScopeTabRow,
} from '../../../api/behavior';

/**
 * AddBehaviorModal — admin-defined behaviors.
 *
 * Pick a trigger (slash command or message pattern), then point it at a
 * webhook URL (optionally signed). Plugins that want to power a behavior
 * simply expose the webhook URL the operator points at here.
 */

const { t } = useI18n();

const props = defineProps<{
    visible: boolean;
    scopeTabId: number;
    scopeTab: ScopeTabRow | null;
}>();

const emit = defineEmits<{
    (e: 'close'): void;
    (e: 'created', row: BehaviorRow): void;
}>();

// ── reset on open ─────────────────────────────────────────────────────────────

watch(() => props.visible, (open) => {
    if (open) {
        resetForm();
        error.value = null;
    }
});

// ── form state ────────────────────────────────────────────────────────────────

const form = ref({
    title: '',
    description: '',
    triggerType: 'message_pattern' as BehaviorTriggerType,
    messagePatternKind: 'startswith',
    messagePatternValue: '',
    slashCommandName: '',
    slashCommandDescription: '',
    integrationTypes: 'user_install',
    webhookUrl: '',
    webhookSecret: '',
    webhookAuthMode: '' as BehaviorWebhookAuthMode | '',
});

function resetForm() {
    form.value = {
        title: '',
        description: '',
        triggerType: 'message_pattern',
        messagePatternKind: 'startswith',
        messagePatternValue: '',
        slashCommandName: '',
        slashCommandDescription: '',
        integrationTypes: 'user_install',
        webhookUrl: '',
        webhookSecret: '',
        webhookAuthMode: '',
    };
}

// ── select options ────────────────────────────────────────────────────────────

const messagePatternKindOptions = [
    { value: 'startswith', label: t('behaviors.card.triggerStartsWith') },
    { value: 'endswith', label: t('behaviors.card.triggerEndsWith') },
    { value: 'regex', label: t('behaviors.card.triggerRegex') },
];

const webhookAuthModeOptions = [
    { value: 'token' as BehaviorWebhookAuthMode, label: 'Token' },
    { value: 'hmac' as BehaviorWebhookAuthMode, label: 'HMAC' },
];

// ── submit ────────────────────────────────────────────────────────────────────

const submitting = ref(false);
const error = ref<string | null>(null);

async function onSubmit() {
    if (submitting.value) return;
    error.value = null;

    const f = form.value;
    if (!f.title.trim()) { error.value = t('behaviors.card.titleRequired'); return; }
    if (f.triggerType === 'slash_command' && !f.slashCommandName.trim()) {
        error.value = t('behaviors.card.triggerValueRequired'); return;
    }
    if (f.triggerType === 'message_pattern' && !f.messagePatternValue.trim()) {
        error.value = t('behaviors.card.triggerValueRequired'); return;
    }
    if (!f.webhookUrl.trim()) {
        error.value = t('behaviors.card.webhookUrlRequired'); return;
    }

    submitting.value = true;
    try {
        const created = await createBehaviorV2({
            title: f.title.trim(),
            description: f.description,
            triggerType: f.triggerType,
            ...(f.triggerType === 'slash_command'
                ? { slashCommandName: f.slashCommandName.trim(), slashCommandDescription: f.slashCommandDescription }
                : { messagePatternKind: f.messagePatternKind as 'startswith' | 'endswith' | 'regex', messagePatternValue: f.messagePatternValue.trim() }),
            integrationTypes: f.integrationTypes,
            scopeTabId: props.scopeTabId,
            webhookUrl: f.webhookUrl.trim(),
            ...(f.webhookSecret
                ? { webhookSecret: f.webhookSecret, webhookAuthMode: (f.webhookAuthMode as BehaviorWebhookAuthMode) || 'token' }
                : {}),
        });
        emit('created', created);
        emit('close');
    } catch (err) {
        error.value = err instanceof Error ? err.message : String(err);
    } finally {
        submitting.value = false;
    }
}

const showAuthMode = computed(() => form.value.webhookSecret.length > 0);
</script>

<template>
    <AppModal :visible="visible" :title="t('behaviors.addModal.title')" width="min(560px, 94vw)" @close="emit('close')">
        <div class="modal-body">
            <p class="step-hint">{{ t('behaviors.addModal.subtitle') }}</p>

            <div class="form-section">
                <label class="field">
                    <span class="label">{{ t('behaviors.addModal.nameLabel') }} *</span>
                    <input v-model="form.title" type="text" maxlength="200" :placeholder="t('behaviors.addModal.namePlaceholder')" autofocus />
                </label>

                <!-- 觸發方式 -->
                <div class="section-heading">{{ t('behaviors.card.triggerType') }}</div>
                <div class="trigger-type-cards">
                    <button
                        type="button"
                        :class="['trigger-card', { selected: form.triggerType === 'slash_command' }]"
                        @click="form.triggerType = 'slash_command'"
                    >
                        <Icon icon="material-symbols:bolt-outline-rounded" width="20" height="20" />
                        {{ t('behaviors.addModal.triggerSlash') }}
                    </button>
                    <button
                        type="button"
                        :class="['trigger-card', { selected: form.triggerType === 'message_pattern' }]"
                        @click="form.triggerType = 'message_pattern'"
                    >
                        <Icon icon="material-symbols:article-outline" width="20" height="20" />
                        {{ t('behaviors.addModal.triggerPattern') }}
                    </button>
                </div>

                <template v-if="form.triggerType === 'slash_command'">
                    <label class="field">
                        <span class="label">{{ t('behaviors.card.slashCommandName') }} *</span>
                        <input v-model="form.slashCommandName" type="text" maxlength="100" placeholder="指令名稱（不含 /）" />
                    </label>
                </template>
                <template v-else>
                    <div class="field">
                        <span class="label">{{ t('behaviors.card.messagePatternKind') }}</span>
                        <AppSelectField v-model="form.messagePatternKind" :options="messagePatternKindOptions" />
                    </div>
                    <label class="field">
                        <span class="label">{{ t('behaviors.card.messagePatternValue') }} *</span>
                        <input v-model="form.messagePatternValue" type="text" maxlength="2000" placeholder="觸發詞" />
                    </label>
                </template>

                <!-- Integration Types -->
                <div class="section-heading">{{ t('behaviors.addModal.axesLabel') }}</div>
                <label class="field">
                    <span class="label">Integration Types</span>
                    <input v-model="form.integrationTypes" type="text" placeholder="user_install" />
                </label>

                <!-- Webhook 設定 -->
                <div class="section-heading">{{ t('behaviors.addModal.forwardLabel') }}</div>
                <label class="field">
                    <span class="label">Webhook URL *</span>
                    <input v-model="form.webhookUrl" type="text" maxlength="1000" placeholder="https://…" />
                </label>
                <label class="field">
                    <span class="label">
                        {{ t('behaviors.card.webhookSecret') }}
                        <span class="hint">{{ t('behaviors.card.webhookSecretHint') }}</span>
                    </span>
                    <input v-model="form.webhookSecret" type="text" maxlength="200" :placeholder="t('behaviors.card.webhookSecretPlaceholder')" autocomplete="off" />
                </label>
                <div v-if="showAuthMode" class="field">
                    <span class="label">{{ t('behaviors.card.webhookAuthMode') }}</span>
                    <AppSelectField v-model="form.webhookAuthMode" :options="webhookAuthModeOptions" />
                </div>
            </div>

            <p v-if="error" class="error" role="alert">{{ error }}</p>

            <footer class="actions">
                <AppButton variant="ghost" :disabled="submitting" @click="emit('close')">{{ t('common.cancel') }}</AppButton>
                <AppButton variant="primary" :loading="submitting" @click="onSubmit">
                    {{ t('behaviors.addModal.create') }}
                </AppButton>
            </footer>
        </div>
    </AppModal>
</template>

<style scoped>
.modal-body {
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
}

.step-hint {
    margin: 0;
    font-size: 0.9rem;
    color: var(--text-muted);
}

/* ── form fields ─────────────────────────────────────────────── */
.form-section {
    display: flex;
    flex-direction: column;
    gap: 0.65rem;
}
.field { display: flex; flex-direction: column; gap: 0.25rem; }
.label {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--text-muted);
    display: flex;
    gap: 0.4rem;
    align-items: center;
}
.hint { font-size: 0.7rem; font-weight: 400; color: var(--text-faint, var(--text-muted)); }
.field input, .field select {
    padding: 0.45rem 0.6rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg-surface);
    color: var(--text);
    font: inherit;
    width: 100%;
    box-sizing: border-box;
}
.field input:focus, .field select:focus { outline: none; border-color: var(--accent); }

.section-heading {
    font-size: 0.72rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-muted);
    padding-bottom: 0.2rem;
    border-bottom: 1px solid var(--border);
}

/* trigger-type 小卡片 */
.trigger-type-cards {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.4rem;
}
.trigger-card {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.35rem;
    padding: 0.6rem 0.5rem;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
    background: var(--bg-page);
    cursor: pointer;
    font: inherit;
    font-size: 0.85rem;
    color: var(--text-muted);
    transition: background 0.1s, border-color 0.1s, color 0.1s;
}
.trigger-card:hover { background: var(--bg-surface-hover); color: var(--text); }
.trigger-card.selected {
    background: var(--accent-bg);
    border-color: var(--accent);
    color: var(--accent-text-strong);
    font-weight: 600;
}

/* ── footer actions ──────────────────────────────────────────── */
.error { color: var(--danger); font-size: 0.85rem; margin: 0; }
.actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    padding-top: 0.25rem;
}

@media (max-width: 480px) {
    .trigger-type-cards { grid-template-columns: 1fr; }
}
</style>
