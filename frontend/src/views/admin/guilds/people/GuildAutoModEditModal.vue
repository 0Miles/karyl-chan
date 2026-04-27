<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import AppModal from '../../../../components/AppModal.vue';
import AppSelectField, { type SelectOption } from '../../../../components/AppSelectField.vue';
import type { AutoModRule, AutoModRulePayload } from '../../../../api/guilds';

const props = defineProps<{
    visible: boolean;
    rule: AutoModRule | null;
}>();

const emit = defineEmits<{
    (e: 'close'): void;
    (e: 'save', payload: AutoModRulePayload): Promise<void> | void;
}>();

const { t } = useI18n();

// Editor draft. Splits the AutoModRule shape into form-friendly bits
// (comma-joined strings instead of arrays) so the inputs stay simple
// and we serialise back to arrays at save time.
const draft = reactive({
    name: '',
    enabled: true,
    triggerType: 1,
    keywords: '',
    regex: '',
    allowList: '',
    presets: [] as number[],
    mentionLimit: '' as string,
    mentionRaid: false,
    actions: [] as Array<{ type: number; channelId?: string; durationSeconds?: string; customMessage?: string }>,
    exemptRoles: '',
    exemptChannels: ''
});

const submitting = ref(false);
const error = ref<string | null>(null);

watch(() => props.visible, (v) => {
    if (!v) return;
    error.value = null;
    submitting.value = false;
    if (props.rule) {
        const r = props.rule;
        draft.name = r.name;
        draft.enabled = r.enabled;
        draft.triggerType = r.triggerType;
        draft.keywords = (r.triggerMetadata.keywordFilter ?? []).join(', ');
        draft.regex = (r.triggerMetadata.regexPatterns ?? []).join('\n');
        draft.allowList = (r.triggerMetadata.allowList ?? []).join(', ');
        draft.presets = [...(r.triggerMetadata.presets ?? [])];
        draft.mentionLimit = r.triggerMetadata.mentionTotalLimit != null ? String(r.triggerMetadata.mentionTotalLimit) : '';
        draft.mentionRaid = !!r.triggerMetadata.mentionRaidProtectionEnabled;
        draft.actions = r.actions.map(a => ({
            type: a.type,
            channelId: a.metadata?.channelId,
            durationSeconds: a.metadata?.durationSeconds != null ? String(a.metadata.durationSeconds) : undefined,
            customMessage: a.metadata?.customMessage
        }));
        draft.exemptRoles = r.exemptRoles.join(', ');
        draft.exemptChannels = r.exemptChannels.join(', ');
    } else {
        draft.name = '';
        draft.enabled = true;
        draft.triggerType = 1;
        draft.keywords = '';
        draft.regex = '';
        draft.allowList = '';
        draft.presets = [];
        draft.mentionLimit = '';
        draft.mentionRaid = false;
        draft.actions = [{ type: 1 }];
        draft.exemptRoles = '';
        draft.exemptChannels = '';
    }
});

const isCreate = computed(() => props.rule === null);
const presetOptions = [1, 2, 3] as const;

const triggerOptions = computed<SelectOption<number>[]>(() =>
    [1, 3, 4, 5, 6].map(v => ({ value: v, label: t('guilds.automod.trigger.' + v) }))
);
const actionTypeOptions = computed<SelectOption<number>[]>(() =>
    [1, 2, 3].map(v => ({ value: v, label: t('guilds.automod.action.' + v) }))
);

function splitCsv(input: string): string[] {
    return input.split(',').map(s => s.trim()).filter(Boolean);
}
function splitLines(input: string): string[] {
    return input.split('\n').map(s => s.trim()).filter(Boolean);
}

function addAction() {
    draft.actions.push({ type: 1 });
}
function removeAction(idx: number) {
    draft.actions.splice(idx, 1);
}
function togglePreset(p: number, on: boolean) {
    if (on) {
        if (!draft.presets.includes(p)) draft.presets.push(p);
    } else {
        draft.presets = draft.presets.filter(x => x !== p);
    }
}

function buildPayload(): AutoModRulePayload | { error: string } {
    if (!draft.name.trim()) return { error: t('guilds.automod.needsName') };
    if (draft.actions.length === 0) return { error: t('guilds.automod.needsAction') };

    const triggerMetadata: AutoModRulePayload['triggerMetadata'] = {};
    if (draft.triggerType === 1 || draft.triggerType === 6) {
        const kw = splitCsv(draft.keywords);
        if (kw.length) triggerMetadata.keywordFilter = kw;
        const re = splitLines(draft.regex);
        if (re.length) triggerMetadata.regexPatterns = re;
        const al = splitCsv(draft.allowList);
        if (al.length) triggerMetadata.allowList = al;
    }
    if (draft.triggerType === 4) {
        triggerMetadata.presets = [...draft.presets];
        const al = splitCsv(draft.allowList);
        if (al.length) triggerMetadata.allowList = al;
    }
    if (draft.triggerType === 5) {
        const lim = Number(draft.mentionLimit);
        if (Number.isFinite(lim) && lim > 0) triggerMetadata.mentionTotalLimit = lim;
        triggerMetadata.mentionRaidProtectionEnabled = draft.mentionRaid;
    }

    const actions = draft.actions.map(a => {
        const metadata: Record<string, unknown> = {};
        if (a.type === 1 && a.customMessage) metadata.customMessage = a.customMessage;
        if (a.type === 2 && a.channelId) metadata.channelId = a.channelId.trim();
        if (a.type === 3) {
            const d = Number(a.durationSeconds);
            if (Number.isFinite(d) && d > 0) metadata.durationSeconds = Math.min(d, 2_419_200);
        }
        return Object.keys(metadata).length ? { type: a.type, metadata } : { type: a.type };
    });

    const payload: AutoModRulePayload = {
        name: draft.name.trim(),
        enabled: draft.enabled,
        eventType: draft.triggerType === 6 ? 2 : 1,
        actions,
        exemptRoles: splitCsv(draft.exemptRoles),
        exemptChannels: splitCsv(draft.exemptChannels)
    };
    if (Object.keys(triggerMetadata).length > 0) payload.triggerMetadata = triggerMetadata;
    if (isCreate.value) payload.triggerType = draft.triggerType;
    return payload;
}

async function submit() {
    const built = buildPayload();
    if ('error' in built) {
        error.value = built.error;
        return;
    }
    submitting.value = true;
    error.value = null;
    try {
        await emit('save', built);
    } catch (err) {
        error.value = err instanceof Error ? err.message : t('guilds.automod.saveFailed');
    } finally {
        submitting.value = false;
    }
}
</script>

<template>
    <AppModal
        :visible="visible"
        :title="isCreate ? $t('guilds.automod.modalNew') : $t('guilds.automod.modalEdit')"
        width="min(560px, 95vw)"
        @close="$emit('close')"
    >
        <form class="body" @submit.prevent="submit">
            <label class="field">
                <span>{{ $t('guilds.automod.fieldName') }}</span>
                <input v-model="draft.name" type="text" maxlength="100" autofocus />
            </label>

            <label class="field">
                <span>{{ $t('guilds.automod.fieldTriggerType') }}</span>
                <AppSelectField
                    v-model="draft.triggerType"
                    :options="triggerOptions"
                    :disabled="!isCreate"
                    :drawer-title="$t('guilds.automod.fieldTriggerType')"
                />
                <small v-if="!isCreate" class="hint">{{ $t('guilds.automod.fieldTriggerImmutable') }}</small>
            </label>

            <template v-if="draft.triggerType === 1 || draft.triggerType === 6">
                <label class="field">
                    <span>{{ $t('guilds.automod.fieldKeywords') }}</span>
                    <input v-model="draft.keywords" type="text" />
                    <small class="hint">{{ $t('guilds.automod.fieldKeywordsHint') }}</small>
                </label>
                <label v-if="draft.triggerType === 1" class="field">
                    <span>{{ $t('guilds.automod.fieldRegex') }}</span>
                    <textarea v-model="draft.regex" rows="3"></textarea>
                </label>
                <label class="field">
                    <span>{{ $t('guilds.automod.fieldAllowList') }}</span>
                    <input v-model="draft.allowList" type="text" />
                </label>
            </template>

            <template v-if="draft.triggerType === 4">
                <fieldset class="checks">
                    <legend>{{ $t('guilds.automod.fieldPresets') }}</legend>
                    <label v-for="p in presetOptions" :key="p" class="check">
                        <input
                            type="checkbox"
                            :checked="draft.presets.includes(p)"
                            @change="togglePreset(p, ($event.target as HTMLInputElement).checked)"
                        />
                        {{ $t('guilds.automod.preset.' + p) }}
                    </label>
                </fieldset>
                <label class="field">
                    <span>{{ $t('guilds.automod.fieldAllowList') }}</span>
                    <input v-model="draft.allowList" type="text" />
                </label>
            </template>

            <template v-if="draft.triggerType === 5">
                <label class="field">
                    <span>{{ $t('guilds.automod.fieldMentionLimit') }}</span>
                    <input v-model="draft.mentionLimit" type="number" min="1" max="50" />
                </label>
                <label class="check">
                    <input type="checkbox" v-model="draft.mentionRaid" />
                    {{ $t('guilds.automod.fieldMentionRaid') }}
                </label>
            </template>

            <fieldset class="actions-fs">
                <legend>{{ $t('guilds.automod.fieldActions') }}</legend>
                <div v-for="(a, idx) in draft.actions" :key="idx" class="action-row">
                    <label class="field action-type">
                        <span>{{ $t('guilds.automod.actionType') }}</span>
                        <AppSelectField
                            v-model="a.type"
                            :options="actionTypeOptions"
                            :drawer-title="$t('guilds.automod.actionType')"
                        />
                    </label>
                    <label v-if="a.type === 1" class="field">
                        <span>{{ $t('guilds.automod.actionCustomMsg') }}</span>
                        <input v-model="a.customMessage" type="text" maxlength="150" />
                    </label>
                    <label v-if="a.type === 2" class="field">
                        <span>{{ $t('guilds.automod.actionChannel') }}</span>
                        <input v-model="a.channelId" type="text" inputmode="numeric" />
                    </label>
                    <label v-if="a.type === 3" class="field">
                        <span>{{ $t('guilds.automod.actionDuration') }}</span>
                        <input v-model="a.durationSeconds" type="number" min="1" max="2419200" />
                    </label>
                    <button type="button" class="ghost danger remove" @click="removeAction(idx)">×</button>
                </div>
                <button type="button" class="ghost add" @click="addAction">+ {{ $t('guilds.automod.actionAdd') }}</button>
            </fieldset>

            <label class="field">
                <span>{{ $t('guilds.automod.fieldExemptRoles') }}</span>
                <input v-model="draft.exemptRoles" type="text" />
            </label>
            <label class="field">
                <span>{{ $t('guilds.automod.fieldExemptChannels') }}</span>
                <input v-model="draft.exemptChannels" type="text" />
            </label>

            <label class="check">
                <input type="checkbox" v-model="draft.enabled" />
                {{ $t('guilds.automod.enabled') }}
            </label>

            <p v-if="error" class="error">{{ error }}</p>

            <footer class="footer">
                <button type="button" class="ghost" @click="$emit('close')">{{ $t('guilds.automod.cancel') }}</button>
                <button type="submit" class="primary" :disabled="submitting">
                    {{ submitting ? $t('guilds.automod.saving') : $t('guilds.automod.save') }}
                </button>
            </footer>
        </form>
    </AppModal>
</template>

<style scoped>
.body {
    padding: 0.85rem 0.95rem;
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
    max-height: 80vh;
    overflow-y: auto;
}
.field { display: flex; flex-direction: column; gap: 0.2rem; font-size: 0.84rem; }
.field span { color: var(--text-muted); }
.field input,
.field select,
.field textarea {
    padding: 0.4rem 0.55rem;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg-surface);
    color: var(--text);
    font: inherit;
    font-size: 0.88rem;
}
.field textarea { resize: vertical; min-height: 3rem; }
.field select:disabled { opacity: 0.6; }
.hint { color: var(--text-muted); font-size: 0.74rem; }
.check { display: flex; align-items: center; gap: 0.4rem; font-size: 0.86rem; }
.checks {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 0.4rem 0.7rem;
    margin: 0;
}
.checks legend { color: var(--text-muted); font-size: 0.78rem; padding: 0 0.3rem; }
.actions-fs {
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 0.5rem 0.7rem;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
}
.actions-fs legend { color: var(--text-muted); font-size: 0.78rem; padding: 0 0.3rem; }
.action-row {
    display: grid;
    grid-template-columns: minmax(140px, 0.6fr) 1fr auto;
    gap: 0.4rem;
    align-items: end;
}
.action-row .action-type { min-width: 120px; }
.remove {
    align-self: end;
    padding: 0.2rem 0.45rem;
    line-height: 1;
}
.add { align-self: flex-start; }
.ghost,
.primary {
    border-radius: 4px;
    padding: 0.4rem 0.85rem;
    font: inherit;
    font-size: 0.85rem;
    cursor: pointer;
    border: 1px solid var(--border);
}
.ghost { background: none; color: var(--text); }
.ghost:hover { background: var(--bg-surface-hover); }
.ghost.danger { color: var(--danger); border-color: rgba(239, 68, 68, 0.45); }
.primary {
    background: var(--accent);
    color: var(--text-on-accent);
    border-color: var(--accent);
}
.primary:disabled { opacity: 0.55; cursor: default; }
.footer {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    padding-top: 0.4rem;
    border-top: 1px solid var(--border);
    position: sticky;
    bottom: 0;
    background: var(--bg-surface);
}
.error {
    color: var(--danger);
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.35);
    border-radius: 4px;
    padding: 0.4rem 0.55rem;
    font-size: 0.82rem;
    margin: 0;
}
@media (max-width: 640px) {
    .action-row { grid-template-columns: 1fr; }
}
</style>
