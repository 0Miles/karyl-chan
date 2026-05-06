<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { Icon } from '@iconify/vue';
import AppModal from '../../../components/AppModal.vue';
import AppSelectField from '../../../components/AppSelectField.vue';
import {
    createBehaviorV2,
    type BehaviorRow,
    type BehaviorSource,
    type BehaviorTriggerType,
    type BehaviorScope,
    type BehaviorAudienceKind,
    type BehaviorWebhookAuthMode,
} from '../../../api/behavior';
import { listPlugins, type PluginRecord } from '../../../api/plugins';

/**
 * AddBehaviorModal — M1-D1
 *
 * 兩步驟 wizard（D-ui §3 + §6 拒絕 AI slop 規則）：
 * - Step 1：選 source（custom / plugin；system 不可建）
 * - Step 2a (custom)：設 trigger → 三軸 → webhookUrl/secret/mode
 * - Step 2b (plugin)：選 plugin → 選 behavior key → 三軸預覽（唯讀）→ 命名
 *
 * 設計重點（§6）：
 * 1. 兩步驟 wizard 不縮減為單一長 form
 * 2. plugin 路徑三軸標示「由 manifest 鎖定」+ ℹ️ 圖示說明
 */

const { t } = useI18n();

const props = defineProps<{
    visible: boolean;
    /** 預設 audienceKind（從 sidebar 選中的 target 帶入）*/
    defaultAudienceKind?: BehaviorAudienceKind;
    defaultAudienceUserId?: string;
    defaultAudienceGroupName?: string;
}>();

const emit = defineEmits<{
    (e: 'close'): void;
    (e: 'created', row: BehaviorRow): void;
}>();

// ── step 狀態 ─────────────────────────────────────────────────────────────────

type Step = 'step1' | 'step2-custom' | 'step2-plugin';
const step = ref<Step>('step1');
const selectedSource = ref<BehaviorSource | null>(null);

// ── plugins 預載 ──────────────────────────────────────────────────────────────

const plugins = ref<PluginRecord[]>([]);
const pluginsLoading = ref(false);

async function loadPlugins() {
    pluginsLoading.value = true;
    try {
        plugins.value = await listPlugins();
    } catch {
        plugins.value = [];
    } finally {
        pluginsLoading.value = false;
    }
}

// ── reset on open ─────────────────────────────────────────────────────────────

watch(() => props.visible, (open) => {
    if (open) {
        step.value = 'step1';
        selectedSource.value = null;
        resetCustomForm();
        resetPluginForm();
        void loadPlugins();
    }
});

// ── Step 2a：custom form ──────────────────────────────────────────────────────

const customForm = ref({
    title: '',
    description: '',
    triggerType: 'message_pattern' as BehaviorTriggerType,
    messagePatternKind: 'startswith',
    messagePatternValue: '',
    slashCommandName: '',
    slashCommandDescription: '',
    scope: 'global' as BehaviorScope,
    integrationTypes: 'user_install',
    contexts: 'BotDM,PrivateChannel',
    audienceKind: (props.defaultAudienceKind ?? 'all') as BehaviorAudienceKind,
    audienceUserId: props.defaultAudienceUserId ?? '',
    audienceGroupName: props.defaultAudienceGroupName ?? '',
    forwardMode: 'webhook' as 'webhook' | 'plugin',
    webhookUrl: '',
    webhookSecret: '',
    webhookAuthMode: '' as BehaviorWebhookAuthMode | '',
    pluginId: null as number | null,
    pluginBehaviorKey: '',
});

function resetCustomForm() {
    customForm.value = {
        title: '',
        description: '',
        triggerType: 'message_pattern',
        messagePatternKind: 'startswith',
        messagePatternValue: '',
        slashCommandName: '',
        slashCommandDescription: '',
        scope: 'global',
        integrationTypes: 'user_install',
        contexts: 'BotDM,PrivateChannel',
        audienceKind: props.defaultAudienceKind ?? 'all',
        audienceUserId: props.defaultAudienceUserId ?? '',
        audienceGroupName: props.defaultAudienceGroupName ?? '',
        forwardMode: 'webhook',
        webhookUrl: '',
        webhookSecret: '',
        webhookAuthMode: '',
        pluginId: null,
        pluginBehaviorKey: '',
    };
}

// ── Step 2b：plugin form ──────────────────────────────────────────────────────

const pluginForm = ref({
    pluginId: null as number | null,
    pluginBehaviorKey: '',
    displayName: '',
    audienceKind: (props.defaultAudienceKind ?? 'all') as BehaviorAudienceKind,
    audienceUserId: props.defaultAudienceUserId ?? '',
    audienceGroupName: props.defaultAudienceGroupName ?? '',
});

function resetPluginForm() {
    pluginForm.value = {
        pluginId: null,
        pluginBehaviorKey: '',
        displayName: '',
        audienceKind: props.defaultAudienceKind ?? 'all',
        audienceUserId: props.defaultAudienceUserId ?? '',
        audienceGroupName: props.defaultAudienceGroupName ?? '',
    };
}

// ── plugin select options ─────────────────────────────────────────────────────

const eligiblePlugins = computed(() =>
    plugins.value.filter(p =>
        p.enabled && p.status === 'active' && (p.manifest?.dm_behaviors?.length ?? 0) > 0
    )
);

const pluginOptions = computed(() =>
    eligiblePlugins.value.map(p => ({ value: p.id, label: `${p.name} (v${p.version})` }))
);

const selectedPlugin = computed(() =>
    eligiblePlugins.value.find(p => p.id === pluginForm.value.pluginId) ?? null
);

const behaviorKeyOptions = computed(() =>
    (selectedPlugin.value?.manifest?.dm_behaviors ?? []).map(b => ({
        value: b.key,
        label: b.description ? `${b.name} — ${b.description}` : b.name,
    }))
);

const selectedBehavior = computed(() =>
    (selectedPlugin.value?.manifest?.dm_behaviors ?? []).find(
        b => b.key === pluginForm.value.pluginBehaviorKey
    ) ?? null
);

// 自動填 displayName
watch(() => [pluginForm.value.pluginId, pluginForm.value.pluginBehaviorKey], () => {
    if (selectedBehavior.value && !pluginForm.value.displayName) {
        pluginForm.value.displayName = selectedBehavior.value.name;
    }
});

// 切換 plugin 時重設 key
watch(() => pluginForm.value.pluginId, () => {
    pluginForm.value.pluginBehaviorKey = '';
    pluginForm.value.displayName = '';
});

// ── step 切換 ─────────────────────────────────────────────────────────────────

function onSelectSource(src: BehaviorSource) {
    selectedSource.value = src;
}

function onNext() {
    if (!selectedSource.value) return;
    if (selectedSource.value === 'custom') {
        step.value = 'step2-custom';
    } else {
        step.value = 'step2-plugin';
    }
}

function onBack() {
    step.value = 'step1';
    selectedSource.value = null;
}

// ── select options（step 2） ──────────────────────────────────────────────────

const triggerTypeOptions = [
    { value: 'slash_command' as BehaviorTriggerType, label: t('behaviors.addModal.triggerSlash') },
    { value: 'message_pattern' as BehaviorTriggerType, label: t('behaviors.addModal.triggerPattern') },
];

const messagePatternKindOptions = [
    { value: 'startswith', label: t('behaviors.card.triggerStartsWith') },
    { value: 'endswith', label: t('behaviors.card.triggerEndsWith') },
    { value: 'regex', label: t('behaviors.card.triggerRegex') },
];

const scopeOptions = [
    { value: 'global' as BehaviorScope, label: 'global' },
    { value: 'guild' as BehaviorScope, label: 'guild' },
];

const webhookAuthModeOptions = [
    { value: 'token' as BehaviorWebhookAuthMode, label: 'Token' },
    { value: 'hmac' as BehaviorWebhookAuthMode, label: 'HMAC' },
];

// ── 提交 ──────────────────────────────────────────────────────────────────────

const submitting = ref(false);
const error = ref<string | null>(null);

async function onSubmitCustom() {
    if (submitting.value) return;
    error.value = null;

    const f = customForm.value;
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
            scope: f.scope,
            integrationTypes: f.integrationTypes,
            contexts: f.contexts,
            audienceKind: f.audienceKind,
            ...(f.audienceKind === 'user' ? { audienceUserId: f.audienceUserId.trim() } : {}),
            ...(f.audienceKind === 'group' ? { audienceGroupName: f.audienceGroupName.trim() } : {}),
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

async function onSubmitPlugin() {
    if (submitting.value) return;
    error.value = null;

    const f = pluginForm.value;
    if (!f.pluginId) { error.value = t('behaviors.card.pluginRequired'); return; }
    if (!f.pluginBehaviorKey) { error.value = t('behaviors.card.pluginBehaviorKeyRequired'); return; }
    if (!f.displayName.trim()) { error.value = t('behaviors.card.titleRequired'); return; }

    const sel = selectedBehavior.value;
    submitting.value = true;
    try {
        const created = await createBehaviorV2({
            title: f.displayName.trim(),
            source: 'plugin' as BehaviorSource,
            triggerType: 'message_pattern',  // plugin behavior 預設 pattern，manifest 決定
            messagePatternKind: 'startswith',
            messagePatternValue: '',
            audienceKind: f.audienceKind,
            ...(f.audienceKind === 'user' ? { audienceUserId: f.audienceUserId.trim() } : {}),
            ...(f.audienceKind === 'group' ? { audienceGroupName: f.audienceGroupName.trim() } : {}),
            pluginId: f.pluginId,
            pluginBehaviorKey: f.pluginBehaviorKey,
            // 三軸預設值（plugin 建立後可在卡片內修改）
            scope: 'global',
            integrationTypes: 'user_install',
            contexts: 'BotDM,PrivateChannel',
        });
        emit('created', created);
        emit('close');
    } catch (err) {
        error.value = err instanceof Error ? err.message : String(err);
    } finally {
        submitting.value = false;
    }
}

const showAuthMode = computed(() =>
    customForm.value.forwardMode === 'webhook' && customForm.value.webhookSecret.length > 0
);
</script>

<template>
    <AppModal :visible="visible" :title="t('behaviors.addModal.title')" width="min(560px, 94vw)" @close="emit('close')">
        <div class="modal-body">

            <!-- ── Step 1：選擇來源 ──────────────────────────────────── -->
            <template v-if="step === 'step1'">
                <p class="step-hint">{{ t('behaviors.addModal.step1Title') }}</p>

                <div class="source-cards">
                    <!-- 自訂 -->
                    <button
                        type="button"
                        :class="['source-card', { selected: selectedSource === 'custom' }]"
                        @click="onSelectSource('custom')"
                    >
                        <Icon icon="material-symbols:bolt-outline-rounded" width="28" height="28" class="source-card-icon" aria-hidden="true" />
                        <strong>{{ t('behaviors.addModal.sourceCustomTitle') }}</strong>
                        <span class="source-card-desc">{{ t('behaviors.addModal.sourceCustomDesc') }}</span>
                    </button>

                    <!-- Plugin 提供 -->
                    <button
                        type="button"
                        :class="['source-card', { selected: selectedSource === 'plugin' }]"
                        @click="onSelectSource('plugin')"
                    >
                        <Icon icon="material-symbols:extension-outline" width="28" height="28" class="source-card-icon" aria-hidden="true" />
                        <strong>{{ t('behaviors.addModal.sourcePluginTitle') }}</strong>
                        <span class="source-card-desc">{{ t('behaviors.addModal.sourcePluginDesc') }}</span>
                    </button>
                </div>

                <p class="system-note muted">{{ t('behaviors.addModal.sourceSystemNote') }}</p>

                <footer class="actions">
                    <button type="button" class="ghost" @click="emit('close')">{{ t('common.cancel') }}</button>
                    <button type="button" class="primary" :disabled="!selectedSource" @click="onNext">
                        {{ t('behaviors.addModal.next') }} →
                    </button>
                </footer>
            </template>

            <!-- ── Step 2a：custom ──────────────────────────────────────── -->
            <template v-else-if="step === 'step2-custom'">
                <button type="button" class="back-btn" @click="onBack">
                    <Icon icon="material-symbols:arrow-back-rounded" width="16" height="16" />
                    {{ t('behaviors.addModal.back') }}
                </button>

                <div class="form-section">
                    <label class="field">
                        <span class="label">{{ t('behaviors.addModal.nameLabel') }} *</span>
                        <input v-model="customForm.title" type="text" maxlength="200" :placeholder="t('behaviors.addModal.namePlaceholder')" autofocus />
                    </label>

                    <!-- 觸發方式 -->
                    <div class="section-heading">{{ t('behaviors.card.triggerType') }}</div>
                    <div class="trigger-type-cards">
                        <button
                            type="button"
                            :class="['trigger-card', { selected: customForm.triggerType === 'slash_command' }]"
                            @click="customForm.triggerType = 'slash_command'"
                        >
                            <Icon icon="material-symbols:bolt-outline-rounded" width="20" height="20" />
                            {{ t('behaviors.addModal.triggerSlash') }}
                        </button>
                        <button
                            type="button"
                            :class="['trigger-card', { selected: customForm.triggerType === 'message_pattern' }]"
                            @click="customForm.triggerType = 'message_pattern'"
                        >
                            <Icon icon="material-symbols:article-outline" width="20" height="20" />
                            {{ t('behaviors.addModal.triggerPattern') }}
                        </button>
                    </div>

                    <template v-if="customForm.triggerType === 'slash_command'">
                        <label class="field">
                            <span class="label">{{ t('behaviors.card.slashCommandName') }} *</span>
                            <input v-model="customForm.slashCommandName" type="text" maxlength="100" placeholder="指令名稱（不含 /）" />
                        </label>
                    </template>
                    <template v-else>
                        <div class="field">
                            <span class="label">{{ t('behaviors.card.messagePatternKind') }}</span>
                            <AppSelectField v-model="customForm.messagePatternKind" :options="messagePatternKindOptions" />
                        </div>
                        <label class="field">
                            <span class="label">{{ t('behaviors.card.messagePatternValue') }} *</span>
                            <input v-model="customForm.messagePatternValue" type="text" maxlength="2000" placeholder="觸發詞" />
                        </label>
                    </template>

                    <!-- 三軸設定 -->
                    <div class="section-heading">{{ t('behaviors.addModal.axesLabel') }}</div>
                    <div class="two-col">
                        <div class="field">
                            <span class="label">Scope</span>
                            <AppSelectField v-model="customForm.scope" :options="scopeOptions" />
                        </div>
                        <label class="field">
                            <span class="label">Integration Types</span>
                            <input v-model="customForm.integrationTypes" type="text" placeholder="user_install" />
                        </label>
                        <label class="field">
                            <span class="label">Contexts</span>
                            <input v-model="customForm.contexts" type="text" placeholder="BotDM,PrivateChannel" />
                        </label>
                    </div>

                    <!-- 轉發設定 -->
                    <div class="section-heading">{{ t('behaviors.addModal.forwardLabel') }}</div>
                    <div class="trigger-type-cards">
                        <button
                            type="button"
                            :class="['trigger-card', { selected: customForm.forwardMode === 'webhook' }]"
                            @click="customForm.forwardMode = 'webhook'"
                        >
                            <Icon icon="material-symbols:webhook-outline" width="20" height="20" />
                            {{ t('behaviors.addModal.forwardWebhook') }}
                        </button>
                        <button
                            type="button"
                            :class="['trigger-card', { selected: customForm.forwardMode === 'plugin' }]"
                            @click="customForm.forwardMode = 'plugin'"
                        >
                            <Icon icon="material-symbols:extension-outline" width="20" height="20" />
                            {{ t('behaviors.addModal.forwardPlugin') }}
                        </button>
                    </div>

                    <template v-if="customForm.forwardMode === 'webhook'">
                        <label class="field">
                            <span class="label">Webhook URL *</span>
                            <input v-model="customForm.webhookUrl" type="text" maxlength="1000" placeholder="https://…" />
                        </label>
                        <label class="field">
                            <span class="label">
                                {{ t('behaviors.card.webhookSecret') }}
                                <span class="hint">{{ t('behaviors.card.webhookSecretHint') }}</span>
                            </span>
                            <input v-model="customForm.webhookSecret" type="text" maxlength="200" :placeholder="t('behaviors.card.webhookSecretPlaceholder')" autocomplete="off" />
                        </label>
                        <div v-if="showAuthMode" class="field">
                            <span class="label">{{ t('behaviors.card.webhookAuthMode') }}</span>
                            <AppSelectField v-model="customForm.webhookAuthMode" :options="webhookAuthModeOptions" />
                        </div>
                    </template>
                    <template v-else>
                        <div class="field">
                            <span class="label">{{ t('behaviors.card.pluginPick') }}</span>
                            <AppSelectField
                                v-model="customForm.pluginId"
                                :options="pluginOptions"
                                :placeholder="t('behaviors.card.pluginNoneAvailable')"
                                :disabled="pluginOptions.length === 0"
                            />
                        </div>
                        <div v-if="customForm.pluginId" class="field">
                            <span class="label">{{ t('behaviors.card.pluginBehaviorKey') }}</span>
                            <AppSelectField
                                v-model="customForm.pluginBehaviorKey"
                                :options="(eligiblePlugins.find(p => p.id === customForm.pluginId)?.manifest?.dm_behaviors ?? []).map(b => ({ value: b.key, label: b.name }))"
                            />
                        </div>
                    </template>
                </div>

                <p v-if="error" class="error" role="alert">{{ error }}</p>

                <footer class="actions">
                    <button type="button" class="ghost" @click="emit('close')" :disabled="submitting">{{ t('common.cancel') }}</button>
                    <button type="button" class="primary" :disabled="submitting" @click="onSubmitCustom">
                        {{ submitting ? t('common.saving') : t('behaviors.addModal.create') }}
                    </button>
                </footer>
            </template>

            <!-- ── Step 2b：plugin ──────────────────────────────────────── -->
            <template v-else-if="step === 'step2-plugin'">
                <button type="button" class="back-btn" @click="onBack">
                    <Icon icon="material-symbols:arrow-back-rounded" width="16" height="16" />
                    {{ t('behaviors.addModal.back') }}
                </button>

                <div class="form-section">
                    <div v-if="pluginsLoading" class="muted loading-hint">{{ t('common.loading') }}</div>
                    <template v-else>
                        <div class="field">
                            <span class="label">{{ t('behaviors.card.pluginPick') }}</span>
                            <AppSelectField
                                v-model="pluginForm.pluginId"
                                :options="pluginOptions"
                                :placeholder="t('behaviors.card.pluginNoneAvailable')"
                                :disabled="pluginOptions.length === 0"
                            />
                        </div>

                        <div v-if="pluginForm.pluginId" class="field">
                            <span class="label">{{ t('behaviors.card.pluginBehaviorKey') }}</span>
                            <AppSelectField
                                v-model="pluginForm.pluginBehaviorKey"
                                :options="behaviorKeyOptions"
                                :placeholder="behaviorKeyOptions.length === 0 ? '此 Plugin 無 behavior' : '選擇 behavior'"
                                :disabled="behaviorKeyOptions.length === 0"
                            />
                        </div>

                        <!-- 三軸預覽（唯讀，manifest 決定）-->
                        <div v-if="selectedBehavior" class="axes-preview">
                            <div class="axes-preview-header">
                                <Icon icon="material-symbols:info-outline-rounded" width="14" height="14" aria-hidden="true" />
                                {{ t('behaviors.addModal.axesNote') }}
                            </div>
                            <div class="axes-preview-content muted">
                                <span>Scope: global</span>
                                <span>IntegType: user_install</span>
                                <span>Ctx: BotDM,PrivateChannel</span>
                            </div>
                        </div>

                        <label class="field">
                            <span class="label">{{ t('behaviors.addModal.nameLabel') }}</span>
                            <input
                                v-model="pluginForm.displayName"
                                type="text"
                                maxlength="200"
                                :placeholder="selectedBehavior?.name ?? t('behaviors.addModal.namePlaceholder')"
                            />
                        </label>
                    </template>
                </div>

                <p v-if="error" class="error" role="alert">{{ error }}</p>

                <footer class="actions">
                    <button type="button" class="ghost" @click="emit('close')" :disabled="submitting">{{ t('common.cancel') }}</button>
                    <button type="button" class="primary" :disabled="submitting || !pluginForm.pluginId || !pluginForm.pluginBehaviorKey" @click="onSubmitPlugin">
                        {{ submitting ? t('common.saving') : t('behaviors.addModal.create') }}
                    </button>
                </footer>
            </template>

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

/* ── source cards（step 1）────────────────────────────────────── */
.source-cards {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.6rem;
}
.source-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.4rem;
    padding: 1rem 0.75rem;
    border-radius: var(--radius-base);
    border: 1px solid var(--border);
    background: var(--bg-page);
    cursor: pointer;
    font: inherit;
    text-align: center;
    color: var(--text-muted);
    transition: background 0.12s, border-color 0.12s, color 0.12s;
}
.source-card:hover { background: var(--bg-surface-hover); color: var(--text); }
.source-card.selected {
    background: var(--accent-bg);
    border-color: var(--accent);
    color: var(--accent-text-strong);
    font-weight: 600;
}
.source-card-icon { opacity: 0.8; }
.source-card-desc {
    font-size: 0.78rem;
    font-weight: 400;
    color: inherit;
    opacity: 0.8;
}

.system-note {
    font-size: 0.8rem;
    text-align: center;
    margin: 0;
}

/* ── back button ─────────────────────────────────────────────── */
.back-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    font: inherit;
    font-size: 0.85rem;
    padding: 0.1rem 0;
}
.back-btn:hover { color: var(--text); }

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

.two-col {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.5rem;
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

/* 三軸預覽 */
.axes-preview {
    background: var(--bg-page);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 0.6rem 0.75rem;
    font-size: 0.8rem;
}
.axes-preview-header {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    color: var(--text-muted);
    font-weight: 600;
    margin-bottom: 0.35rem;
}
.axes-preview-content {
    display: flex;
    gap: 0.75rem;
    flex-wrap: wrap;
}
.axes-preview-content span {
    font-family: monospace;
    font-size: 0.78rem;
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 0.1rem 0.4rem;
}

/* ── footer actions ──────────────────────────────────────────── */
.error { color: var(--danger); font-size: 0.85rem; margin: 0; }
.actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    padding-top: 0.25rem;
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
.actions .primary:disabled { opacity: 0.6; cursor: not-allowed; }
.actions .ghost {
    background: transparent;
    color: var(--text);
    border: 1px solid var(--border);
}

.muted { color: var(--text-muted); }
.loading-hint { font-size: 0.85rem; text-align: center; padding: 0.5rem; }

@media (max-width: 480px) {
    .source-cards, .trigger-type-cards, .two-col { grid-template-columns: 1fr; }
}
</style>
