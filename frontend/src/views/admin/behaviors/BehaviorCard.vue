<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { Icon } from '@iconify/vue';
import AppMenu from '../../../components/AppMenu.vue';
import AppMenuItem from '../../../components/AppMenuItem.vue';
import AppSelectField from '../../../components/AppSelectField.vue';
import BehaviorSourceNotice from './BehaviorSourceNotice.vue';
import {
    type BehaviorRow,
    type BehaviorSource,
    type BehaviorTriggerType,
    type BehaviorForwardType,
    type BehaviorScope,
    type BehaviorWebhookAuthMode,
    type BehaviorPatchPayload,
    updateBehavior,
    deleteBehavior,
} from '../../../api/behavior';
import type { PluginRecord } from '../../../api/plugins';

/**
 * BehaviorCard v2 — M1-D1
 *
 * 三種 source 的條件分支（custom / plugin / system）：
 * - 左側 3px source-bar 色條（custom=accent / plugin=紫 / system=muted）
 * - trigger-badge pill（slash / pattern）
 * - source-badge（custom 不顯示 / plugin 顯示 plugin name / system 顯示鎖）
 * - drag-handle 只 custom 可用
 * - custom：完全可編輯
 * - plugin：只可編輯三軸 / audience / enabled / webhookSecret + mode
 * - system：只可編輯 trigger value + enabled
 * - webhookAuthMode UI（CR-2）：source=custom + webhookSecret 有值時顯示 mode select
 */

const { t } = useI18n();

const props = defineProps<{
    behavior: BehaviorRow;
    plugins?: PluginRecord[];
    initiallyOpen?: boolean;
}>();

const emit = defineEmits<{
    (e: 'updated', row: BehaviorRow): void;
    (e: 'deleted', id: number): void;
    (e: 'toggle', open: boolean): void;
}>();

const open = ref(!!props.initiallyOpen);

// ── source 計算屬性 ───────────────────────────────────────────────────────────

const isCustom = computed(() => props.behavior.source === 'custom');
const isPlugin = computed(() => props.behavior.source === 'plugin');
const isSystem = computed(() => props.behavior.source === 'system');

// ── 找出 plugin 資訊 ──────────────────────────────────────────────────────────

const linkedPlugin = computed(() =>
    (props.plugins ?? []).find(p => p.id === props.behavior.pluginId) ?? null
);

// ── draft（可編輯欄位）────────────────────────────────────────────────────────

interface Draft {
    // 共同
    title: string;
    description: string;
    enabled: boolean;
    forwardType: BehaviorForwardType;
    stopOnMatch: boolean;
    // trigger（custom 全可改；system 只能改 value；plugin 唯讀）
    triggerType: BehaviorTriggerType;
    messagePatternKind: string;
    messagePatternValue: string;
    slashCommandName: string;
    slashCommandDescription: string;
    // 三軸（custom + plugin 可改；system 唯讀）
    scope: BehaviorScope;
    integrationTypes: string;
    contexts: string;
    // audience（custom + plugin 可改）
    audienceKind: string;
    audienceUserId: string;
    audienceGroupName: string;
    // webhook（custom 全可改；plugin 只能改 secret/mode）
    webhookUrl: string;
    webhookSecret: string;
    webhookAuthMode: BehaviorWebhookAuthMode | '';
    // plugin routing（custom 可改）
    pluginId: number | null;
    pluginBehaviorKey: string;
}

function draftFrom(row: BehaviorRow): Draft {
    return {
        title: row.title,
        description: row.description,
        enabled: row.enabled,
        forwardType: row.forwardType,
        stopOnMatch: row.stopOnMatch,
        triggerType: row.triggerType,
        messagePatternKind: row.messagePatternKind ?? 'startswith',
        messagePatternValue: row.messagePatternValue ?? '',
        slashCommandName: row.slashCommandName ?? '',
        slashCommandDescription: row.slashCommandDescription ?? '',
        scope: row.scope,
        integrationTypes: row.integrationTypes,
        contexts: row.contexts,
        audienceKind: row.audienceKind,
        audienceUserId: row.audienceUserId ?? '',
        audienceGroupName: row.audienceGroupName ?? '',
        webhookUrl: row.webhookUrl ?? '',
        webhookSecret: row.webhookSecret ?? '',
        webhookAuthMode: row.webhookAuthMode ?? '',
        pluginId: row.pluginId,
        pluginBehaviorKey: row.pluginBehaviorKey ?? '',
    };
}

const draft = reactive<Draft>(draftFrom(props.behavior));
const saving = ref(false);
const error = ref<string | null>(null);

const enabledLocal = ref(props.behavior.enabled);

watch(() => props.behavior, (next) => {
    Object.assign(draft, draftFrom(next));
});
watch(() => props.behavior.enabled, (next) => {
    enabledLocal.value = next;
});

// ── select options ────────────────────────────────────────────────────────────

const triggerTypeOptions = computed(() => [
    { value: 'slash_command' as BehaviorTriggerType, label: t('behaviors.card.triggerSlashCommand') },
    { value: 'message_pattern' as BehaviorTriggerType, label: t('behaviors.card.triggerPattern') },
]);

const messagePatternKindOptions = [
    { value: 'startswith', label: t('behaviors.card.triggerStartsWith') },
    { value: 'endswith', label: t('behaviors.card.triggerEndsWith') },
    { value: 'regex', label: t('behaviors.card.triggerRegex') },
];

const forwardTypeOptions = computed(() => [
    { value: 'one_time' as BehaviorForwardType, label: t('behaviors.card.forwardOneTime') },
    { value: 'continuous' as BehaviorForwardType, label: t('behaviors.card.forwardContinuous') },
]);

const scopeOptions = [
    { value: 'global' as BehaviorScope, label: 'global' },
    { value: 'guild' as BehaviorScope, label: 'guild' },
];

const webhookAuthModeOptions = computed(() => [
    { value: 'token' as BehaviorWebhookAuthMode, label: 'Token' },
    { value: 'hmac' as BehaviorWebhookAuthMode, label: 'HMAC' },
]);

// plugin options（custom 路徑的 plugin routing）
const eligiblePlugins = computed(() =>
    (props.plugins ?? []).filter(p =>
        p.enabled && p.status === 'active' && (p.manifest?.dm_behaviors?.length ?? 0) > 0
    )
);
const pluginOptions = computed(() =>
    eligiblePlugins.value.map(p => ({ value: p.id, label: `${p.name} (v${p.version})` }))
);
const selectedPlugin = computed(() =>
    eligiblePlugins.value.find(p => p.id === draft.pluginId) ?? null
);
const dmBehaviorOptions = computed(() =>
    (selectedPlugin.value?.manifest?.dm_behaviors ?? []).map(b => ({
        value: b.key,
        label: b.description ? `${b.name} — ${b.description}` : b.name,
    }))
);

// webhookAuthMode 顯示條件（CR-2）：source=custom + webhookSecret 有值
const showAuthModeSelect = computed(() =>
    isCustom.value && draft.webhookSecret.length > 0
);

// ── trigger summary（卡片頭部）───────────────────────────────────────────────

const triggerSummary = computed(() => {
    const b = props.behavior;
    if (b.triggerType === 'slash_command') {
        return t('behaviors.card.previewSlashCommand', { value: b.slashCommandName ?? '' });
    }
    const v = b.messagePatternValue ?? '';
    const truncated = v.length > 40 ? `${v.slice(0, 37)}…` : v;
    if (b.messagePatternKind === 'startswith') return t('behaviors.card.previewStartsWith', { value: truncated });
    if (b.messagePatternKind === 'endswith') return t('behaviors.card.previewEndsWith', { value: truncated });
    return t('behaviors.card.previewRegex', { value: truncated });
});

// ── dirty 計算 ────────────────────────────────────────────────────────────────

const dirty = computed(() => {
    const b = props.behavior;
    if (isSystem.value) {
        if (b.triggerType === 'slash_command') {
            return draft.slashCommandName !== (b.slashCommandName ?? '');
        }
        return draft.messagePatternValue !== (b.messagePatternValue ?? '');
    }
    if (isPlugin.value) {
        return (
            draft.scope !== b.scope ||
            draft.integrationTypes !== b.integrationTypes ||
            draft.contexts !== b.contexts ||
            draft.audienceKind !== b.audienceKind ||
            draft.audienceUserId !== (b.audienceUserId ?? '') ||
            draft.audienceGroupName !== (b.audienceGroupName ?? '') ||
            draft.webhookSecret !== (b.webhookSecret ?? '') ||
            draft.webhookAuthMode !== (b.webhookAuthMode ?? '')
        );
    }
    // custom
    return (
        draft.title !== b.title ||
        draft.description !== b.description ||
        draft.triggerType !== b.triggerType ||
        draft.messagePatternKind !== (b.messagePatternKind ?? 'startswith') ||
        draft.messagePatternValue !== (b.messagePatternValue ?? '') ||
        draft.slashCommandName !== (b.slashCommandName ?? '') ||
        draft.slashCommandDescription !== (b.slashCommandDescription ?? '') ||
        draft.scope !== b.scope ||
        draft.integrationTypes !== b.integrationTypes ||
        draft.contexts !== b.contexts ||
        draft.audienceKind !== b.audienceKind ||
        draft.audienceUserId !== (b.audienceUserId ?? '') ||
        draft.audienceGroupName !== (b.audienceGroupName ?? '') ||
        draft.webhookUrl !== (b.webhookUrl ?? '') ||
        draft.webhookSecret !== (b.webhookSecret ?? '') ||
        draft.webhookAuthMode !== (b.webhookAuthMode ?? '') ||
        draft.forwardType !== b.forwardType ||
        draft.stopOnMatch !== b.stopOnMatch ||
        (draft.pluginId ?? null) !== (b.pluginId ?? null) ||
        draft.pluginBehaviorKey !== (b.pluginBehaviorKey ?? '')
    );
});

// ── toggle enabled ────────────────────────────────────────────────────────────

function toggleOpen() {
    open.value = !open.value;
    emit('toggle', open.value);
}

async function onToggleEnabled() {
    if (saving.value || isSystem.value) return;
    const next = !enabledLocal.value;
    enabledLocal.value = next;
    saving.value = true;
    error.value = null;
    try {
        const updated = await updateBehavior(props.behavior.id, { enabled: next });
        emit('updated', updated);
    } catch (err) {
        error.value = err instanceof Error ? err.message : String(err);
        enabledLocal.value = props.behavior.enabled;
    } finally {
        saving.value = false;
    }
}

// ── save ──────────────────────────────────────────────────────────────────────

async function onSave() {
    if (saving.value) return;
    error.value = null;
    saving.value = true;

    try {
        let patch: BehaviorPatchPayload = {};

        if (isSystem.value) {
            // system：只更新 trigger value
            if (props.behavior.triggerType === 'slash_command') {
                patch.slashCommandName = draft.slashCommandName.trim();
            } else {
                patch.messagePatternValue = draft.messagePatternValue.trim();
            }
        } else if (isPlugin.value) {
            // plugin：三軸 + audience + webhookSecret/webhookAuthMode
            patch = {
                scope: draft.scope,
                integrationTypes: draft.integrationTypes,
                contexts: draft.contexts,
                audienceKind: draft.audienceKind as BehaviorRow['audienceKind'],
                audienceUserId: draft.audienceKind === 'user' ? (draft.audienceUserId.trim() || null) : null,
                audienceGroupName: draft.audienceKind === 'group' ? (draft.audienceGroupName.trim() || null) : null,
            };
            if (draft.webhookSecret !== (props.behavior.webhookSecret ?? '')) {
                patch.webhookSecret = draft.webhookSecret.length === 0 ? null : draft.webhookSecret;
                if (draft.webhookSecret.length > 0) {
                    patch.webhookAuthMode = (draft.webhookAuthMode as BehaviorWebhookAuthMode) || 'token';
                }
            }
        } else {
            // custom：全欄位
            if (!draft.title.trim()) {
                error.value = t('behaviors.card.titleRequired');
                return;
            }
            patch = {
                title: draft.title.trim(),
                description: draft.description,
                triggerType: draft.triggerType,
                scope: draft.scope,
                integrationTypes: draft.integrationTypes,
                contexts: draft.contexts,
                audienceKind: draft.audienceKind as BehaviorRow['audienceKind'],
                audienceUserId: draft.audienceKind === 'user' ? (draft.audienceUserId.trim() || null) : null,
                audienceGroupName: draft.audienceKind === 'group' ? (draft.audienceGroupName.trim() || null) : null,
                forwardType: draft.forwardType,
                stopOnMatch: draft.stopOnMatch,
            };
            if (draft.triggerType === 'slash_command') {
                if (!draft.slashCommandName.trim()) {
                    error.value = t('behaviors.card.triggerValueRequired');
                    return;
                }
                patch.slashCommandName = draft.slashCommandName.trim();
                patch.slashCommandDescription = draft.slashCommandDescription;
                patch.messagePatternKind = null;
                patch.messagePatternValue = null;
            } else {
                if (!draft.messagePatternValue.trim()) {
                    error.value = t('behaviors.card.triggerValueRequired');
                    return;
                }
                if (draft.messagePatternKind === 'regex') {
                    try { new RegExp(draft.messagePatternValue); } catch {
                        error.value = t('behaviors.card.regexInvalid');
                        return;
                    }
                }
                patch.messagePatternKind = draft.messagePatternKind as BehaviorRow['messagePatternKind'];
                patch.messagePatternValue = draft.messagePatternValue.trim();
                patch.slashCommandName = null;
                patch.slashCommandDescription = null;
            }
            // webhookUrl / secret（custom 路徑用 webhookUrl 直接設定）
            if (draft.webhookUrl !== (props.behavior.webhookUrl ?? '')) {
                patch.webhookUrl = draft.webhookUrl.trim() || null;
            }
            if (draft.webhookSecret !== (props.behavior.webhookSecret ?? '')) {
                patch.webhookSecret = draft.webhookSecret.length === 0 ? null : draft.webhookSecret;
                if (draft.webhookSecret.length > 0) {
                    patch.webhookAuthMode = (draft.webhookAuthMode as BehaviorWebhookAuthMode) || 'token';
                }
            } else if (draft.webhookAuthMode !== (props.behavior.webhookAuthMode ?? '')) {
                patch.webhookAuthMode = (draft.webhookAuthMode as BehaviorWebhookAuthMode) || null;
            }
            // plugin routing
            if ((draft.pluginId ?? null) !== (props.behavior.pluginId ?? null) ||
                draft.pluginBehaviorKey !== (props.behavior.pluginBehaviorKey ?? '')) {
                patch.pluginId = draft.pluginId;
                patch.pluginBehaviorKey = draft.pluginBehaviorKey || null;
            }
        }

        const updated = await updateBehavior(props.behavior.id, patch);
        emit('updated', updated);
    } catch (err) {
        error.value = err instanceof Error ? err.message : String(err);
    } finally {
        saving.value = false;
    }
}

// ── delete ────────────────────────────────────────────────────────────────────

async function onDelete() {
    if (!window.confirm(t('behaviors.card.deleteConfirm', { title: props.behavior.title }))) return;
    saving.value = true;
    try {
        await deleteBehavior(props.behavior.id);
        emit('deleted', props.behavior.id);
    } catch (err) {
        error.value = err instanceof Error ? err.message : String(err);
        saving.value = false;
    }
}

// ── save 按鈕文字（依 source 變化）──────────────────────────────────────────

const saveLabel = computed(() => {
    if (isSystem.value) return t('behaviors.card.saveTrigger');
    if (isPlugin.value) return t('behaviors.card.saveAxes');
    return t('common.save');
});
</script>

<template>
    <article :class="['card', `card--${behavior.source}`, { 'is-disabled': !enabledLocal }]">
        <!-- source-bar 色條（左側 3px，D-ui §1.3） -->
        <div :class="['source-bar', `source-bar--${behavior.source}`]" aria-hidden="true"></div>

        <div class="card-inner">
            <!-- ─ card head ─────────────────────────────────────────────────── -->
            <header class="card-head">
                <!-- drag-handle：custom 可拖曳，其他 locked -->
                <button
                    v-if="isCustom"
                    type="button"
                    class="drag-handle"
                    :title="t('behaviors.card.dragHint')"
                    :aria-label="t('behaviors.card.dragHint')"
                >
                    <Icon icon="material-symbols:drag-indicator" width="18" height="18" />
                </button>
                <span
                    v-else
                    class="drag-handle drag-handle--locked"
                    :title="isSystem ? t('behaviors.card.systemRowLocked') : t('behaviors.card.pluginRowLocked')"
                    aria-hidden="true"
                >
                    <Icon icon="material-symbols:lock-outline" width="16" height="16" />
                </span>

                <!-- expand toggle + title -->
                <button
                    type="button"
                    class="title-btn"
                    @click="toggleOpen"
                    :aria-expanded="open"
                >
                    <Icon
                        :icon="open ? 'material-symbols:expand-less-rounded' : 'material-symbols:expand-more-rounded'"
                        width="18" height="18"
                    />
                    <span class="title">{{ behavior.title }}</span>
                    <span class="trigger-summary">{{ triggerSummary }}</span>
                </button>

                <!-- trigger-badge pill -->
                <span
                    :class="['tag', behavior.triggerType === 'slash_command' ? 'tag-slash' : 'tag-pattern']"
                    :title="behavior.triggerType === 'slash_command' ? 'Slash 指令' : 'Message Pattern'"
                >
                    <Icon
                        :icon="behavior.triggerType === 'slash_command' ? 'material-symbols:bolt-outline-rounded' : 'material-symbols:article-outline'"
                        width="13" height="13"
                    />
                    {{ behavior.triggerType === 'slash_command' ? 'slash' : 'pattern' }}
                </span>

                <!-- source-badge（custom 不顯示，plugin 顯示 name，system 顯示鎖） -->
                <span
                    v-if="isPlugin"
                    class="tag tag-plugin"
                    :title="t('behaviors.card.tagPlugin')"
                >
                    <Icon icon="material-symbols:extension-outline" width="13" height="13" />
                    {{ linkedPlugin?.name ?? t('behaviors.card.tagPluginShort') }}
                </span>
                <span
                    v-else-if="isSystem"
                    class="tag tag-system"
                    :title="t('behaviors.card.tagSystem')"
                >
                    <Icon icon="material-symbols:settings-outline" width="13" height="13" />
                    {{ t('behaviors.card.tagSystemShort') }}
                </span>

                <!-- 連續對話 tag -->
                <span
                    v-if="behavior.forwardType === 'continuous'"
                    class="tag tag-continuous"
                    :title="t('behaviors.card.tagContinuous')"
                >
                    <Icon icon="material-symbols:loop-rounded" width="13" height="13" />
                    {{ t('behaviors.card.tagContinuousShort') }}
                </span>

                <!-- stop-on-match tag -->
                <span
                    v-if="behavior.stopOnMatch"
                    class="tag tag-stop"
                    :title="t('behaviors.card.tagStop')"
                >
                    <Icon icon="material-symbols:stop-circle-outline-rounded" width="13" height="13" />
                    {{ t('behaviors.card.tagStopShort') }}
                </span>

                <!-- toggle（system 無 toggle） -->
                <button
                    v-if="!isSystem"
                    type="button"
                    role="switch"
                    :class="['toggle', { on: enabledLocal }]"
                    :title="enabledLocal ? t('behaviors.card.toggleEnabled') : t('behaviors.card.toggleDisabled')"
                    :aria-checked="enabledLocal ? 'true' : 'false'"
                    :disabled="saving"
                    @click.stop="onToggleEnabled"
                >
                    <span class="slider" aria-hidden="true"></span>
                </button>

                <!-- 三點 menu（只 custom 有刪除） -->
                <AppMenu v-if="isCustom" placement="bottom-end" :offset="[0, 6]">
                    <template #trigger>
                        <button
                            type="button"
                            class="menu-trigger"
                            :title="t('behaviors.card.moreActions')"
                            :aria-label="t('behaviors.card.moreActions')"
                        >
                            <Icon icon="material-symbols:more-vert" width="18" height="18" />
                        </button>
                    </template>
                    <AppMenuItem :disabled="saving" danger @click="onDelete">
                        <Icon icon="material-symbols:delete-outline-rounded" width="16" height="16" />
                        {{ t('common.delete') }}
                    </AppMenuItem>
                </AppMenu>
            </header>

            <!-- ─ card body ─────────────────────────────────────────────────── -->
            <div v-if="open" class="card-body">

                <!-- source notice banner（plugin/system） -->
                <BehaviorSourceNotice
                    v-if="!isCustom"
                    :source="behavior.source"
                    :plugin-name="linkedPlugin?.name"
                    :plugin-key="linkedPlugin?.pluginKey"
                />

                <!-- ═══ source=custom：完全可編輯 ════════════════════════════ -->
                <template v-if="isCustom">
                    <div class="grid">
                        <label class="field full">
                            <span class="label">{{ t('behaviors.card.title') }}</span>
                            <input v-model="draft.title" type="text" maxlength="200" />
                        </label>
                        <label class="field full">
                            <span class="label">{{ t('behaviors.card.description') }}</span>
                            <textarea v-model="draft.description" rows="2" maxlength="2000" />
                        </label>

                        <!-- trigger section -->
                        <div class="field">
                            <span class="label">{{ t('behaviors.card.triggerType') }}</span>
                            <AppSelectField v-model="draft.triggerType" :options="triggerTypeOptions" />
                        </div>

                        <template v-if="draft.triggerType === 'slash_command'">
                            <label class="field">
                                <span class="label">{{ t('behaviors.card.slashCommandName') }}</span>
                                <input v-model="draft.slashCommandName" type="text" maxlength="100" placeholder="指令名稱" />
                            </label>
                            <label class="field full">
                                <span class="label">{{ t('behaviors.card.slashCommandDescription') }}</span>
                                <input v-model="draft.slashCommandDescription" type="text" maxlength="200" />
                            </label>
                        </template>

                        <template v-else>
                            <div class="field">
                                <span class="label">{{ t('behaviors.card.messagePatternKind') }}</span>
                                <AppSelectField v-model="draft.messagePatternKind" :options="messagePatternKindOptions" />
                            </div>
                            <label class="field">
                                <span class="label">{{ t('behaviors.card.messagePatternValue') }}</span>
                                <input v-model="draft.messagePatternValue" type="text" maxlength="2000" />
                            </label>
                        </template>

                        <!-- 三軸 section -->
                        <div class="field-group-title">Discord 三軸</div>

                        <div class="field">
                            <span class="label">Scope</span>
                            <AppSelectField v-model="draft.scope" :options="scopeOptions" />
                        </div>
                        <label class="field">
                            <span class="label">Integration Types</span>
                            <input v-model="draft.integrationTypes" type="text" placeholder="guild_install,user_install" />
                        </label>
                        <label class="field">
                            <span class="label">Contexts</span>
                            <input v-model="draft.contexts" type="text" placeholder="Guild,BotDM,PrivateChannel" />
                        </label>

                        <!-- 轉發設定 -->
                        <div class="field">
                            <span class="label">{{ t('behaviors.card.forwardType') }}</span>
                            <AppSelectField v-model="draft.forwardType" :options="forwardTypeOptions" />
                        </div>

                        <!-- webhook 設定 -->
                        <label class="field full">
                            <span class="label">{{ t('behaviors.card.webhookUrl') }}</span>
                            <input
                                v-model="draft.webhookUrl"
                                type="text"
                                placeholder="https://…"
                                maxlength="1000"
                            />
                        </label>
                        <label class="field full">
                            <span class="label">
                                {{ t('behaviors.card.webhookSecret') }}
                                <span class="hint">{{ t('behaviors.card.webhookSecretHint') }}</span>
                            </span>
                            <input
                                v-model="draft.webhookSecret"
                                type="text"
                                :placeholder="t('behaviors.card.webhookSecretPlaceholder')"
                                maxlength="200"
                                autocomplete="off"
                                spellcheck="false"
                            />
                        </label>

                        <!-- webhookAuthMode（CR-2）：有 secret 時才顯示 -->
                        <div v-if="showAuthModeSelect" class="field">
                            <span class="label">{{ t('behaviors.card.webhookAuthMode') }}</span>
                            <AppSelectField v-model="draft.webhookAuthMode" :options="webhookAuthModeOptions" />
                        </div>

                        <label class="field full inline">
                            <input type="checkbox" v-model="draft.stopOnMatch" />
                            <span>{{ t('behaviors.card.stopOnMatch') }}</span>
                        </label>
                    </div>
                </template>

                <!-- ═══ source=plugin：三軸 + audience 可編輯，其餘唯讀 ══════ -->
                <template v-else-if="isPlugin">
                    <!-- 唯讀區 -->
                    <div class="grid readonly-grid">
                        <label class="field full">
                            <span class="label readonly-label">
                                {{ t('behaviors.card.title') }}
                                <Icon icon="material-symbols:lock-outline" width="12" height="12" aria-hidden="true" />
                            </span>
                            <input :value="behavior.title" type="text" readonly class="readonly-input" />
                        </label>
                        <label class="field full">
                            <span class="label readonly-label">
                                {{ t('behaviors.card.triggerValue') }}
                                <Icon icon="material-symbols:lock-outline" width="12" height="12" aria-hidden="true" />
                            </span>
                            <input
                                :value="behavior.triggerType === 'slash_command'
                                    ? `/${behavior.slashCommandName ?? ''}`
                                    : `${behavior.messagePatternKind}: ${behavior.messagePatternValue ?? ''}`"
                                type="text"
                                readonly
                                class="readonly-input"
                            />
                        </label>
                    </div>

                    <!-- 可編輯區：三軸 + audience -->
                    <div class="section-divider">{{ t('behaviors.card.axesSection') }}</div>
                    <div class="grid">
                        <div class="field">
                            <span class="label">Scope</span>
                            <AppSelectField v-model="draft.scope" :options="scopeOptions" />
                        </div>
                        <label class="field">
                            <span class="label">Integration Types</span>
                            <input v-model="draft.integrationTypes" type="text" placeholder="guild_install,user_install" />
                        </label>
                        <label class="field">
                            <span class="label">Contexts</span>
                            <input v-model="draft.contexts" type="text" placeholder="Guild,BotDM,PrivateChannel" />
                        </label>

                        <!-- webhookSecret（plugin 可選設定） -->
                        <label class="field full">
                            <span class="label">
                                {{ t('behaviors.card.webhookSecret') }}
                                <span class="hint">{{ t('behaviors.card.webhookSecretHint') }}</span>
                            </span>
                            <input
                                v-model="draft.webhookSecret"
                                type="text"
                                :placeholder="t('behaviors.card.webhookSecretPlaceholder')"
                                maxlength="200"
                                autocomplete="off"
                                spellcheck="false"
                            />
                        </label>
                        <div v-if="draft.webhookSecret.length > 0" class="field">
                            <span class="label">{{ t('behaviors.card.webhookAuthMode') }}</span>
                            <AppSelectField v-model="draft.webhookAuthMode" :options="webhookAuthModeOptions" />
                        </div>
                    </div>
                </template>

                <!-- ═══ source=system：只能改 trigger value ════════════════════ -->
                <template v-else-if="isSystem">
                    <!-- 唯讀區 -->
                    <div class="grid readonly-grid">
                        <label class="field full">
                            <span class="label readonly-label">
                                {{ t('behaviors.card.title') }}
                                <Icon icon="material-symbols:lock-outline" width="12" height="12" aria-hidden="true" />
                            </span>
                            <input :value="behavior.title" type="text" readonly class="readonly-input" />
                        </label>
                    </div>

                    <!-- 可編輯：trigger value -->
                    <div class="section-divider">{{ t('behaviors.card.triggerSection') }}</div>
                    <div class="grid">
                        <template v-if="behavior.triggerType === 'slash_command'">
                            <label class="field full">
                                <span class="label">{{ t('behaviors.card.slashCommandName') }}</span>
                                <input v-model="draft.slashCommandName" type="text" maxlength="100" />
                            </label>
                        </template>
                        <template v-else>
                            <label class="field full">
                                <span class="label">{{ t('behaviors.card.messagePatternValue') }}</span>
                                <input v-model="draft.messagePatternValue" type="text" maxlength="2000" />
                            </label>
                        </template>
                    </div>
                </template>

                <!-- error 訊息 -->
                <p v-if="error" class="error" role="alert">{{ error }}</p>

                <!-- actions footer -->
                <footer class="actions">
                    <span class="spacer" />
                    <button
                        type="button"
                        class="primary"
                        :disabled="!dirty || saving"
                        @click="onSave"
                    >
                        {{ saving ? t('common.saving') : saveLabel }}
                    </button>
                </footer>
            </div>
        </div>
    </article>
</template>

<style scoped>
/* ── 卡片外層（含色條）────────────────────────────────────────── */
.card {
    display: flex;
    flex-direction: row;
    border: 1px solid var(--border);
    border-radius: var(--radius-base);
    background: var(--bg-surface);
    overflow: hidden;
}
.card.is-disabled .title { color: var(--text-muted); text-decoration: line-through; }

/* 左側 3px source-bar（D-ui §1.3） */
.source-bar {
    width: 3px;
    flex-shrink: 0;
    border-radius: var(--radius-base) 0 0 var(--radius-base);
}
.source-bar--custom { background: var(--accent); }
.source-bar--plugin { background: var(--source-plugin, #7c3aed); }
.source-bar--system { background: var(--text-muted); }

.card-inner {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
}

/* ── card-head ───────────────────────────────────────────────── */
.card-head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.45rem 0.75rem 0.45rem 0.4rem;
    background: var(--bg-page);
    border-bottom: 1px solid transparent;
}
.card-head:has(+ .card-body) { border-bottom-color: var(--border); }

.drag-handle {
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: grab;
    padding: 0.25rem;
    display: inline-flex;
    align-items: center;
    flex-shrink: 0;
}
.drag-handle:active { cursor: grabbing; }
.drag-handle--locked {
    cursor: default;
    color: var(--text-faint, var(--text-muted));
    display: inline-flex;
    align-items: center;
    padding: 0.25rem;
    flex-shrink: 0;
}

.title-btn {
    flex: 1;
    min-width: 0;
    background: none;
    border: none;
    text-align: left;
    cursor: pointer;
    color: var(--text);
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.25rem 0.1rem;
    overflow: hidden;
}
.title-btn:hover { color: var(--text-strong); }
.title {
    font-weight: 600;
    color: var(--text-strong);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex-shrink: 0;
    max-width: 50%;
}
.trigger-summary {
    color: var(--text-muted);
    font-size: 0.8rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
}

/* ── tags ────────────────────────────────────────────────────── */
.tag {
    display: inline-flex;
    align-items: center;
    gap: 0.15rem;
    font-size: 0.7rem;
    padding: 0.1rem 0.45rem;
    border-radius: 999px;
    border: 1px solid transparent;
    flex-shrink: 0;
    white-space: nowrap;
}
.tag-slash { background: var(--accent-bg); color: var(--accent-text-strong); border-color: var(--accent-border, var(--accent)); }
.tag-pattern { background: var(--bg-page); color: var(--text-muted); border-color: var(--border); }
.tag-plugin { background: var(--source-plugin-bg, rgba(124,58,237,0.08)); color: var(--source-plugin, #7c3aed); border-color: var(--source-plugin-border, rgba(124,58,237,0.2)); }
.tag-system { background: var(--bg-page); color: var(--text-muted); border-color: var(--border); }
.tag-continuous { background: var(--accent-bg); color: var(--accent-text-strong); }
.tag-stop { background: var(--warn-bg); color: var(--warn-text); }

/* ── toggle ──────────────────────────────────────────────────── */
.toggle {
    position: relative;
    width: 32px;
    height: 18px;
    flex-shrink: 0;
    cursor: pointer;
    border: none;
    padding: 0;
    background: none;
}
.toggle:disabled { cursor: not-allowed; opacity: 0.6; }
.slider {
    position: absolute;
    inset: 0;
    background: var(--border-strong);
    border-radius: 999px;
    transition: background 0.15s;
}
.slider::before {
    content: '';
    position: absolute;
    top: 2px;
    left: 2px;
    width: 14px;
    height: 14px;
    background: var(--bg-surface);
    border-radius: 50%;
    transition: transform 0.15s;
}
.toggle.on .slider { background: var(--accent); }
.toggle.on .slider::before { transform: translateX(14px); }

/* ── menu ────────────────────────────────────────────────────── */
.menu-trigger {
    flex-shrink: 0;
    background: none;
    border: 1px solid transparent;
    color: var(--text-muted);
    width: 28px;
    height: 28px;
    border-radius: var(--radius-sm);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
}
.menu-trigger:hover { background: var(--bg-surface-hover); color: var(--text); }

/* ── card-body ───────────────────────────────────────────────── */
.card-body {
    padding: 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
}

/* ── grid ────────────────────────────────────────────────────── */
.grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.6rem;
}
.field { display: flex; flex-direction: column; gap: 0.25rem; min-width: 0; }
.field.full { grid-column: 1 / -1; }
.field.inline { flex-direction: row; align-items: center; gap: 0.5rem; cursor: pointer; padding: 0.2rem 0; }
.field.inline input[type="checkbox"] {
    width: auto;
    min-width: 0;
    flex-shrink: 0;
    padding: 0;
    margin: 0;
    accent-color: var(--accent);
}
.field.inline span { color: var(--text); font-size: 0.9rem; }
.label {
    font-size: 0.75rem;
    color: var(--text-muted);
    font-weight: 600;
    display: flex;
    gap: 0.35rem;
    align-items: center;
}
.hint {
    font-size: 0.7rem;
    font-weight: 400;
    color: var(--text-faint, var(--text-muted));
}
.field input,
.field textarea,
.field select {
    padding: 0.45rem 0.6rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg-surface);
    color: var(--text);
    font: inherit;
    width: 100%;
    box-sizing: border-box;
}
.field textarea { resize: vertical; min-height: 2.5rem; font-family: inherit; }
.field input:focus,
.field textarea:focus,
.field select:focus { outline: none; border-color: var(--accent); }

/* ── 唯讀區 ──────────────────────────────────────────────────── */
.readonly-grid {
    background: var(--bg-page);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 0.6rem;
}
.readonly-label { color: var(--text-faint, var(--text-muted)); }
.readonly-input {
    background: var(--bg-page) !important;
    color: var(--text-muted) !important;
    cursor: default;
}

/* ── section divider ─────────────────────────────────────────── */
.section-divider {
    font-size: 0.72rem;
    font-weight: 700;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 0.15rem 0;
    border-bottom: 1px solid var(--border);
}

/* field-group-title */
.field-group-title {
    grid-column: 1 / -1;
    font-size: 0.72rem;
    font-weight: 700;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding-top: 0.25rem;
    border-bottom: 1px solid var(--border);
    padding-bottom: 0.15rem;
}

/* ── actions ─────────────────────────────────────────────────── */
.error { color: var(--danger); margin: 0; font-size: 0.85rem; }
.actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
}
.spacer { flex: 1; }
.actions button {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.45rem 0.85rem;
    border-radius: var(--radius-sm);
    cursor: pointer;
    font: inherit;
    border: 1px solid var(--border);
    background: var(--bg-surface);
    color: var(--text);
}
.actions .primary {
    background: var(--accent);
    color: var(--text-on-accent);
    border-color: var(--accent);
}
.actions .primary:disabled { opacity: 0.55; cursor: not-allowed; }

@media (max-width: 640px) {
    .grid { grid-template-columns: 1fr; }
}
</style>
