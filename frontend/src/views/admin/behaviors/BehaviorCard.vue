<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { Icon } from '@iconify/vue';
import {
    type BehaviorForwardType,
    type BehaviorPatch,
    type BehaviorRow,
    type BehaviorTargetSummary,
    type BehaviorTriggerType,
    deleteBehavior,
    updateBehavior
} from '../../../api/behavior';

const { t } = useI18n();

const props = defineProps<{
    behavior: BehaviorRow;
    targets: BehaviorTargetSummary[];
    /** Initial expanded state — true for newly added cards. */
    initiallyOpen?: boolean;
}>();

const emit = defineEmits<{
    (e: 'updated', row: BehaviorRow): void;
    (e: 'deleted', id: number): void;
    (e: 'toggle', open: boolean): void;
    (e: 'moved', behaviorId: number, newTargetId: number): void;
}>();

const open = ref(!!props.initiallyOpen);

// Local editable copy. We never mutate `props.behavior` directly so the
// parent stays in control of the canonical list — `updated` emit hands
// the saved row back up.
interface Draft {
    title: string;
    description: string;
    triggerType: BehaviorTriggerType;
    triggerValue: string;
    forwardType: BehaviorForwardType;
    stopOnMatch: boolean;
    enabled: boolean;
    targetId: number;
    webhookUrl: string;
    /** Empty = no signing (clear). Server stores AES-encrypted; UI shows plaintext. */
    webhookSecret: string;
}

function draftFrom(row: BehaviorRow): Draft {
    return {
        title: row.title,
        description: row.description,
        triggerType: row.triggerType,
        triggerValue: row.triggerValue,
        forwardType: row.forwardType,
        stopOnMatch: row.stopOnMatch,
        enabled: row.enabled,
        targetId: row.targetId,
        webhookUrl: row.webhookUrl,
        webhookSecret: row.webhookSecret ?? ''
    };
}

const draft = reactive<Draft>(draftFrom(props.behavior));
const saving = ref(false);
const error = ref<string | null>(null);

watch(() => props.behavior, (next) => {
    Object.assign(draft, draftFrom(next));
});

const dirty = computed(() => {
    const b = props.behavior;
    return draft.title !== b.title
        || draft.description !== b.description
        || draft.triggerType !== b.triggerType
        || draft.triggerValue !== b.triggerValue
        || draft.forwardType !== b.forwardType
        || draft.stopOnMatch !== b.stopOnMatch
        || draft.enabled !== b.enabled
        || draft.targetId !== b.targetId
        || draft.webhookUrl !== b.webhookUrl
        || draft.webhookSecret !== (b.webhookSecret ?? '');
});

const triggerSummary = computed(() => {
    const v = props.behavior.triggerValue;
    const truncated = v.length > 40 ? `${v.slice(0, 37)}…` : v;
    if (props.behavior.triggerType === 'startswith') return t('behaviors.card.previewStartsWith', { value: truncated });
    if (props.behavior.triggerType === 'endswith') return t('behaviors.card.previewEndsWith', { value: truncated });
    return t('behaviors.card.previewRegex', { value: truncated });
});

function toggleOpen() {
    open.value = !open.value;
    emit('toggle', open.value);
}

async function onToggleEnabled() {
    saving.value = true;
    error.value = null;
    try {
        const updated = await updateBehavior(props.behavior.id, { enabled: !props.behavior.enabled });
        emit('updated', updated);
    } catch (err) {
        error.value = err instanceof Error ? err.message : String(err);
    } finally {
        saving.value = false;
    }
}

async function onSave() {
    if (saving.value) return;
    error.value = null;
    if (!draft.title.trim()) {
        error.value = t('behaviors.card.titleRequired');
        return;
    }
    if (!draft.triggerValue.trim()) {
        error.value = t('behaviors.card.triggerValueRequired');
        return;
    }
    if (draft.triggerType === 'regex') {
        try { new RegExp(draft.triggerValue); } catch {
            error.value = t('behaviors.card.regexInvalid');
            return;
        }
    }
    if (!draft.webhookUrl.trim()) {
        error.value = t('behaviors.card.webhookUrlRequired');
        return;
    }
    saving.value = true;
    try {
        const movedTarget = draft.targetId !== props.behavior.targetId ? draft.targetId : null;
        const patch: BehaviorPatch = {
            title: draft.title.trim(),
            description: draft.description,
            triggerType: draft.triggerType,
            triggerValue: draft.triggerValue,
            forwardType: draft.forwardType,
            stopOnMatch: draft.stopOnMatch,
            enabled: draft.enabled,
            targetId: draft.targetId,
            webhookUrl: draft.webhookUrl.trim()
        };
        // Only include webhookSecret in the patch if it actually changed
        // — sending it on every save is harmless but generates noise in
        // the audit log's `fields` list.
        const currentSecret = props.behavior.webhookSecret ?? '';
        if (draft.webhookSecret !== currentSecret) {
            patch.webhookSecret = draft.webhookSecret.length === 0 ? null : draft.webhookSecret;
        }
        const updated = await updateBehavior(props.behavior.id, patch);
        if (movedTarget !== null) {
            emit('moved', updated.id, movedTarget);
        } else {
            emit('updated', updated);
        }
    } catch (err) {
        error.value = err instanceof Error ? err.message : String(err);
    } finally {
        saving.value = false;
    }
}

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
</script>

<template>
    <article :class="['card', { 'is-disabled': !behavior.enabled }]">
        <header class="card-head">
            <button
                type="button"
                class="drag-handle"
                :title="t('behaviors.card.dragHint')"
                :aria-label="t('behaviors.card.dragHint')"
            >
                <Icon icon="material-symbols:drag-indicator" width="18" height="18" />
            </button>
            <button
                type="button"
                class="title-btn"
                @click="toggleOpen"
                :aria-expanded="open"
            >
                <Icon
                    :icon="open ? 'material-symbols:expand-less-rounded' : 'material-symbols:expand-more-rounded'"
                    width="18"
                    height="18"
                />
                <span class="title">{{ behavior.title }}</span>
                <span class="trigger-summary">{{ triggerSummary }}</span>
            </button>
            <span
                v-if="behavior.forwardType === 'continuous'"
                class="tag tag-continuous"
                :title="t('behaviors.card.tagContinuous')"
            >
                <Icon icon="material-symbols:loop-rounded" width="13" height="13" />
                {{ t('behaviors.card.tagContinuousShort') }}
            </span>
            <span
                v-if="behavior.stopOnMatch"
                class="tag tag-stop"
                :title="t('behaviors.card.tagStop')"
            >
                <Icon icon="material-symbols:stop-circle-outline-rounded" width="13" height="13" />
                {{ t('behaviors.card.tagStopShort') }}
            </span>
            <label
                class="toggle"
                :title="behavior.enabled ? t('behaviors.card.toggleEnabled') : t('behaviors.card.toggleDisabled')"
                @click.stop
            >
                <input type="checkbox" :checked="behavior.enabled" :disabled="saving" @change="onToggleEnabled" />
                <span class="slider" aria-hidden="true"></span>
            </label>
        </header>

        <div v-if="open" class="card-body">
            <div class="grid">
                <label class="field full">
                    <span class="label">{{ t('behaviors.card.title') }}</span>
                    <input v-model="draft.title" type="text" maxlength="200" />
                </label>

                <label class="field full">
                    <span class="label">{{ t('behaviors.card.description') }}</span>
                    <textarea v-model="draft.description" rows="2" maxlength="2000" />
                </label>

                <label class="field">
                    <span class="label">{{ t('behaviors.card.triggerType') }}</span>
                    <select v-model="draft.triggerType">
                        <option value="startswith">{{ t('behaviors.card.triggerStartsWith') }}</option>
                        <option value="endswith">{{ t('behaviors.card.triggerEndsWith') }}</option>
                        <option value="regex">{{ t('behaviors.card.triggerRegex') }}</option>
                    </select>
                </label>

                <label class="field">
                    <span class="label">{{ t('behaviors.card.triggerValue') }}</span>
                    <input v-model="draft.triggerValue" type="text" maxlength="2000" />
                </label>

                <label class="field">
                    <span class="label">{{ t('behaviors.card.forwardType') }}</span>
                    <select v-model="draft.forwardType">
                        <option value="one_time">{{ t('behaviors.card.forwardOneTime') }}</option>
                        <option value="continuous">{{ t('behaviors.card.forwardContinuous') }}</option>
                    </select>
                </label>

                <label class="field">
                    <span class="label">{{ t('behaviors.card.targetId') }}</span>
                    <select v-model.number="draft.targetId">
                        <option v-for="t2 in targets" :key="t2.id" :value="t2.id">
                            {{ t2.kind === 'all_dms'
                                ? t('behaviors.sidebar.allDms')
                                : t2.kind === 'user'
                                    ? (t2.profile?.globalName ?? t2.profile?.username ?? t2.userId)
                                    : t2.groupName }}
                        </option>
                    </select>
                </label>

                <label class="field full">
                    <span class="label">{{ t('behaviors.card.webhookUrl') }}</span>
                    <input
                        v-model="draft.webhookUrl"
                        type="text"
                        placeholder="https://discord.com/api/webhooks/…"
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

                <label class="field full inline">
                    <input type="checkbox" v-model="draft.stopOnMatch" />
                    <span>{{ t('behaviors.card.stopOnMatch') }}</span>
                </label>
            </div>

            <p v-if="error" class="error" role="alert">{{ error }}</p>

            <footer class="actions">
                <button type="button" class="danger" :disabled="saving" @click="onDelete">
                    <Icon icon="material-symbols:delete-outline-rounded" width="16" height="16" />
                    {{ t('common.delete') }}
                </button>
                <span class="spacer" />
                <button type="button" class="primary" :disabled="!dirty || saving" @click="onSave">
                    {{ saving ? t('common.saving') : t('common.save') }}
                </button>
            </footer>
        </div>
    </article>
</template>

<style scoped>
.card {
    border: 1px solid var(--border);
    border-radius: var(--radius-base);
    background: var(--bg-surface);
    overflow: hidden;
}
.card.is-disabled .title { color: var(--text-muted); text-decoration: line-through; }
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
}
.drag-handle:active { cursor: grabbing; }
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
.tag {
    display: inline-flex;
    align-items: center;
    gap: 0.15rem;
    font-size: 0.7rem;
    padding: 0.1rem 0.45rem;
    border-radius: 999px;
    border: 1px solid transparent;
    flex-shrink: 0;
}
.tag-continuous { background: var(--accent-bg); color: var(--accent-text-strong); }
.tag-stop { background: var(--warn-bg); color: var(--warn-text); }

.toggle {
    position: relative;
    width: 32px;
    height: 18px;
    flex-shrink: 0;
    cursor: pointer;
}
.toggle input { opacity: 0; width: 100%; height: 100%; cursor: pointer; }
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
.toggle input:checked + .slider { background: var(--accent); }
.toggle input:checked + .slider::before { transform: translateX(14px); }

.card-body {
    padding: 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
}
.grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.6rem;
}
.field { display: flex; flex-direction: column; gap: 0.25rem; min-width: 0; }
.field.full { grid-column: 1 / -1; }
.field.inline { flex-direction: row; align-items: center; gap: 0.4rem; cursor: pointer; }
.field.inline input { accent-color: var(--accent); }
.label {
    font-size: 0.75rem;
    color: var(--text-muted);
    font-weight: 600;
    display: flex;
    gap: 0.4rem;
    align-items: baseline;
}
.hint {
    font-size: 0.7rem;
    font-weight: 400;
    color: var(--text-faint);
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
.actions .danger {
    color: var(--danger);
    border-color: rgba(239, 68, 68, 0.4);
    background: var(--bg-surface);
}
.actions .danger:disabled { opacity: 0.55; }

@media (max-width: 640px) {
    .grid { grid-template-columns: 1fr; }
}
</style>
