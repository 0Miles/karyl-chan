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
    type BehaviorSource,
    type BehaviorTriggerType,
    type BehaviorWebhookAuthMode,
    type ScopeTabRow,
} from '../../../api/behavior';
import { listPlugins, type PluginRecord } from '../../../api/plugins';

/**
 * AddBehaviorModal — admin-defined behaviors only.
 *
 * Every behavior here is created by an operator: pick a trigger
 * (slash command or message pattern), then decide where it's
 * forwarded — to a webhook URL, or to a plugin that exposes a
 * spec-compliant behavior endpoint (the "plugin" forward option).
 * There is no separate "plugin-provided behavior" source; a plugin
 * that wants to power a behavior simply provides the webhook the
 * operator points at.
 */

const { t } = useI18n();

const props = defineProps<{
    visible: boolean;
    scopeTabId: number;
    scopeTab: ScopeTabRow | null;
    preloadedPlugins?: PluginRecord[];
}>();

const emit = defineEmits<{
    (e: 'close'): void;
    (e: 'created', row: BehaviorRow): void;
}>();

// ── plugins 預載（優先使用父層傳入的快取，無則自行打 API）────────────────────

const pluginsSelf = ref<PluginRecord[]>([]);
const pluginsLoading = ref(false);

const plugins = computed(() => props.preloadedPlugins ?? pluginsSelf.value);

async function loadPluginsIfNeeded() {
    if (props.preloadedPlugins) return;  // 父層已快取，不重打
    pluginsLoading.value = true;
    try {
        pluginsSelf.value = await listPlugins();
    } catch {
        pluginsSelf.value = [];
    } finally {
        pluginsLoading.value = false;
    }
}

// ── reset on open ─────────────────────────────────────────────────────────────

watch(() => props.visible, (open) => {
    if (open) {
        resetForm();
        error.value = null;
        void loadPluginsIfNeeded();
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
    forwardMode: 'webhook' as 'webhook' | 'plugin',
    webhookUrl: '',
    webhookSecret: '',
    webhookAuthMode: '' as BehaviorWebhookAuthMode | '',
    pluginId: null as number | null,
    pluginBehaviorKey: '',
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
        forwardMode: 'webhook',
        webhookUrl: '',
        webhookSecret: '',
        webhookAuthMode: '',
        pluginId: null,
        pluginBehaviorKey: '',
    };
}

// ── plugin forward options ────────────────────────────────────────────────────

const eligiblePlugins = computed(() =>
    plugins.value.filter(p =>
        p.enabled && p.status === 'active' && (p.manifest?.dm_behaviors?.length ?? 0) > 0
    )
);

const pluginOptions = computed(() =>
    eligiblePlugins.value.map(p => ({ value: p.id, label: `${p.name} (v${p.version})` }))
);

const pluginBehaviorOptions = computed(() =>
    (eligiblePlugins.value.find(p => p.id === form.value.pluginId)?.manifest?.dm_behaviors ?? [])
        .map(b => ({ value: b.key, label: b.name }))
);

// 切換 forward plugin 時重設 behavior key
watch(() => form.value.pluginId, () => {
    form.value.pluginBehaviorKey = '';
});

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
    if (f.forwardMode === 'webhook' && !f.webhookUrl.trim()) {
        error.value = t('behaviors.card.webhookUrlRequired'); return;
    }
    if (f.forwardMode === 'plugin' && !f.pluginId) {
        error.value = t('behaviors.card.pluginRequired'); return;
    }

    submitting.value = true;
    try {
        const payload = {
            title: f.title.trim(),
            description: f.description,
            source: 'custom' as BehaviorSource,
            triggerType: f.triggerType,
            ...(f.triggerType === 'slash_command'
                ? { slashCommandName: f.slashCommandName.trim(), slashCommandDescription: f.slashCommandDescription }
                : { messagePatternKind: f.messagePatternKind as 'startswith' | 'endswith' | 'regex', messagePatternValue: f.messagePatternValue.trim() }),
            integrationTypes: f.integrationTypes,
            scopeTabId: props.scopeTabId,
            ...(f.forwardMode === 'webhook'
                ? {
                    webhookUrl: f.webhookUrl.trim(),
                    ...(f.webhookSecret ? { webhookSecret: f.webhookSecret, webhookAuthMode: (f.webhookAuthMode as BehaviorWebhookAuthMode) || 'token' } : {}),
                }
                : {
                    pluginId: f.pluginId ?? undefined,
                    pluginBehaviorKey: f.pluginBehaviorKey || undefined,
                }),
        };
        const created = await createBehaviorV2(payload);
        emit('created', created);
        emit('close');
    } catch (err) {
        error.value = err instanceof Error ? err.message : String(err);
    } finally {
        submitting.value = false;
    }
}

const showAuthMode = computed(() =>
    form.value.forwardMode === 'webhook' && form.value.webhookSecret.length > 0
);
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

                <!-- 轉發設定 -->
                <div class="section-heading">{{ t('behaviors.addModal.forwardLabel') }}</div>
                <div class="trigger-type-cards">
                    <button
                        type="button"
                        :class="['trigger-card', { selected: form.forwardMode === 'webhook' }]"
                        @click="form.forwardMode = 'webhook'"
                    >
                        <Icon icon="material-symbols:webhook-outline" width="20" height="20" />
                        {{ t('behaviors.addModal.forwardWebhook') }}
                    </button>
                    <button
                        type="button"
                        :class="['trigger-card', { selected: form.forwardMode === 'plugin' }]"
                        @click="form.forwardMode = 'plugin'"
                    >
                        <Icon icon="material-symbols:extension-outline" width="20" height="20" />
                        {{ t('behaviors.addModal.forwardPlugin') }}
                    </button>
                </div>

                <template v-if="form.forwardMode === 'webhook'">
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
                </template>
                <template v-else>
                    <div v-if="pluginsLoading" class="muted loading-hint">{{ t('common.loading') }}</div>
                    <template v-else>
                        <div class="field">
                            <span class="label">{{ t('behaviors.card.pluginPick') }}</span>
                            <AppSelectField
                                v-model="form.pluginId"
                                :options="pluginOptions"
                                :placeholder="t('behaviors.card.pluginNoneAvailable')"
                                :disabled="pluginOptions.length === 0"
                            />
                        </div>
                        <div v-if="form.pluginId" class="field">
                            <span class="label">{{ t('behaviors.card.pluginBehaviorKey') }}</span>
                            <AppSelectField
                                v-model="form.pluginBehaviorKey"
                                :options="pluginBehaviorOptions"
                                :placeholder="pluginBehaviorOptions.length === 0 ? '此 Plugin 無 behavior' : '選擇 behavior'"
                                :disabled="pluginBehaviorOptions.length === 0"
                            />
                        </div>
                    </template>
                </template>
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

.muted { color: var(--text-muted); }
.loading-hint { font-size: 0.85rem; text-align: center; padding: 0.5rem; }

@media (max-width: 480px) {
    .trigger-type-cards { grid-template-columns: 1fr; }
}
</style>
