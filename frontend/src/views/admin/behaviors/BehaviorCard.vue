<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { Icon } from '@iconify/vue';
import AppMenu from '../../../components/AppMenu.vue';
import AppMenuItem from '../../../components/AppMenuItem.vue';
import AppSelectField from '../../../components/AppSelectField.vue';
import {
    type BehaviorForwardType,
    type BehaviorPatch,
    type BehaviorRow,
    type BehaviorTargetSummary,
    type BehaviorTriggerType,
    type BehaviorType,
    deleteBehavior,
    updateBehavior
} from '../../../api/behavior';
import type { PluginRecord } from '../../../api/plugins';

const { t } = useI18n();

const props = defineProps<{
    behavior: BehaviorRow;
    targets: BehaviorTargetSummary[];
    /** Pre-loaded plugin list from the parent so the type=plugin form
     *  has a select to populate without each card N+1-fetching. */
    plugins?: PluginRecord[];
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
    targetId: number;
    webhookUrl: string;
    /** Empty = no signing (clear). Server stores AES-encrypted; UI shows plaintext. */
    webhookSecret: string;
    type: BehaviorType;
    pluginId: number | null;
    pluginBehaviorKey: string;
}

function draftFrom(row: BehaviorRow): Draft {
    return {
        title: row.title,
        description: row.description,
        triggerType: row.triggerType,
        triggerValue: row.triggerValue,
        forwardType: row.forwardType,
        stopOnMatch: row.stopOnMatch,
        targetId: row.targetId,
        // For type='plugin' rows the URL field holds a "plugin://…"
        // placeholder. Hide it from the user when the form switches
        // back to 'webhook' by zeroing here so they can type a real URL.
        webhookUrl: row.type === 'plugin' ? '' : row.webhookUrl,
        webhookSecret: row.webhookSecret ?? '',
        type: row.type,
        pluginId: row.pluginId,
        pluginBehaviorKey: row.pluginBehaviorKey ?? '',
    };
}

const draft = reactive<Draft>(draftFrom(props.behavior));
const saving = ref(false);
const error = ref<string | null>(null);

// `enabled` is intentionally NOT part of `draft`. The toggle has its
// own immediate PATCH path and must not be coupled to the Save button's
// patch payload — otherwise flipping the toggle and pressing Save before
// the toggle's PATCH lands pushes a stale value back to the server.
// `enabledLocal` is the single source of truth for the toggle UI;
// `props.behavior.enabled` is reconciled into it via the watch below.
const enabledLocal = ref(props.behavior.enabled);

watch(() => props.behavior, (next) => {
    Object.assign(draft, draftFrom(next));
});

// Keep the toggle reconciled to server truth whenever the prop's
// `enabled` actually changes. This watches the primitive directly
// (not the prop reference) so it fires even if the parent mutates the
// row in place — and stays quiet during in-flight optimistic flips
// (the parent only re-emits AFTER the PATCH lands, by which point
// `next` matches what we already wrote).
watch(() => props.behavior.enabled, (next) => {
    enabledLocal.value = next;
});

// Plugins offering at least one dm_behavior (eligible for selection
// in this card). Inactive / disabled / no-dm-behavior plugins are
// omitted so the user can't pick a routing target that won't fire.
const eligiblePlugins = computed(() =>
    (props.plugins ?? []).filter(p =>
        p.enabled && p.status === 'active' && (p.manifest?.dm_behaviors?.length ?? 0) > 0
    )
);

const selectedPlugin = computed(() =>
    eligiblePlugins.value.find(p => p.id === draft.pluginId) ?? null
);

const dmBehaviorChoices = computed(() => selectedPlugin.value?.manifest?.dm_behaviors ?? []);

const dirty = computed(() => {
    const b = props.behavior;
    // Type / plugin fields are part of dirtiness so a freshly added
    // webhook card switched to plugin (without other changes) still
    // lights up the Save button.
    if (draft.type !== b.type) return true;
    if (draft.type === 'plugin') {
        if ((draft.pluginId ?? null) !== (b.pluginId ?? null)) return true;
        if ((draft.pluginBehaviorKey || '') !== (b.pluginBehaviorKey ?? '')) return true;
    }
    if (draft.type === 'webhook') {
        // Compare against the encrypted-then-decrypted prop value
        // exactly the same way pre-plugin code did.
        if (draft.webhookUrl !== b.webhookUrl) return true;
        if (draft.webhookSecret !== (b.webhookSecret ?? '')) return true;
    }
    return draft.title !== b.title
        || draft.description !== b.description
        || draft.triggerType !== b.triggerType
        || draft.triggerValue !== b.triggerValue
        || draft.forwardType !== b.forwardType
        || draft.stopOnMatch !== b.stopOnMatch
        || draft.targetId !== b.targetId;
});

// Auto-pick the first eligible plugin / first dm_behavior so the form
// lands ready-to-save when the user switches to Plugin type. Watching
// `eligiblePlugins` (not just `draft.type`) means the auto-pick also
// fires when the parent's plugin fetch resolves AFTER the type
// switch — without this, switching to Plugin while the list is still
// loading leaves both selects empty forever.
function autoPickPlugin() {
    if (draft.type !== 'plugin') return;
    if (draft.pluginId != null) return;
    const first = eligiblePlugins.value[0];
    if (!first) return;
    draft.pluginId = first.id;
    const behavior = first.manifest?.dm_behaviors?.[0];
    draft.pluginBehaviorKey = behavior?.key ?? '';
}
watch(() => draft.type, autoPickPlugin);
watch(eligiblePlugins, autoPickPlugin, { deep: true });

watch(() => draft.pluginId, () => {
    // After picking a different plugin, default to its first
    // dm_behavior. User can then narrow if multiple.
    const first = dmBehaviorChoices.value[0];
    if (first && !dmBehaviorChoices.value.some(b => b.key === draft.pluginBehaviorKey)) {
        draft.pluginBehaviorKey = first.key;
    }
});

// Option lists for AppSelectField (it wants {value,label}[]).
const typeOptions = computed(() => [
    { value: 'webhook' as BehaviorType, label: t('behaviors.card.behaviorTypeWebhook') },
    { value: 'plugin' as BehaviorType, label: t('behaviors.card.behaviorTypePlugin') },
]);
const triggerTypeOptions = computed(() => [
    { value: 'startswith' as BehaviorTriggerType, label: t('behaviors.card.triggerStartsWith') },
    { value: 'endswith' as BehaviorTriggerType, label: t('behaviors.card.triggerEndsWith') },
    { value: 'regex' as BehaviorTriggerType, label: t('behaviors.card.triggerRegex') },
]);
const forwardTypeOptions = computed(() => [
    { value: 'one_time' as BehaviorForwardType, label: t('behaviors.card.forwardOneTime') },
    { value: 'continuous' as BehaviorForwardType, label: t('behaviors.card.forwardContinuous') },
]);
const targetOptions = computed(() => props.targets.map(t2 => ({
    value: t2.id,
    label: t2.kind === 'all_dms'
        ? t('behaviors.sidebar.allDms')
        : t2.kind === 'user'
            ? (t2.profile?.globalName ?? t2.profile?.username ?? t2.userId ?? '?')
            : (t2.groupName ?? '?'),
})));
const pluginOptions = computed(() =>
    eligiblePlugins.value.map(p => ({
        value: p.id,
        label: `${p.name} (v${p.version})`,
    }))
);
const dmBehaviorOptions = computed(() =>
    dmBehaviorChoices.value.map(b => ({
        value: b.key,
        label: b.description ? `${b.name} — ${b.description}` : b.name,
    }))
);

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
    if (saving.value) return;
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
    // Type-specific validation. Webhook needs a real URL; plugin needs
    // both pluginId and a behavior key declared by that plugin's
    // manifest. Server re-validates so this is just for fast UX
    // feedback — invalid form doesn't issue a doomed PATCH.
    if (draft.type === 'webhook' && !draft.webhookUrl.trim()) {
        error.value = t('behaviors.card.webhookUrlRequired');
        return;
    }
    if (draft.type === 'plugin') {
        if (draft.pluginId == null) {
            error.value = t('behaviors.card.pluginRequired');
            return;
        }
        if (!draft.pluginBehaviorKey) {
            error.value = t('behaviors.card.pluginBehaviorKeyRequired');
            return;
        }
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
            targetId: draft.targetId,
        };
        // Send `type` only when it changed — saves an unnecessary
        // type-switch round trip on routine edits.
        const typeChanged = draft.type !== props.behavior.type;
        if (typeChanged) {
            patch.type = draft.type;
        }
        if (draft.type === 'webhook') {
            // Always include URL on type-change to webhook (server
            // demands it when leaving plugin); on same-type save send
            // it only if changed (legacy behavior).
            if (typeChanged || draft.webhookUrl !== props.behavior.webhookUrl) {
                patch.webhookUrl = draft.webhookUrl.trim();
            }
            // `enabled` is intentionally NOT touched by Save — the toggle
            // owns it through its own PATCH path.
            const currentSecret = props.behavior.webhookSecret ?? '';
            if (draft.webhookSecret !== currentSecret) {
                patch.webhookSecret = draft.webhookSecret.length === 0 ? null : draft.webhookSecret;
            }
        } else {
            // type === 'plugin'. Always include pluginId + key when
            // type changed (mandatory on PATCH); on same-type save
            // include only if changed.
            const pluginChanged =
                draft.pluginId !== props.behavior.pluginId ||
                draft.pluginBehaviorKey !== (props.behavior.pluginBehaviorKey ?? '');
            if (typeChanged || pluginChanged) {
                patch.pluginId = draft.pluginId;
                patch.pluginBehaviorKey = draft.pluginBehaviorKey;
            }
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
    <article :class="['card', { 'is-disabled': !enabledLocal }]">
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
            <span
                v-if="behavior.type === 'plugin'"
                class="tag tag-plugin"
                :title="t('behaviors.card.tagPlugin')"
            >
                <Icon icon="material-symbols:extension-outline" width="13" height="13" />
                {{ t('behaviors.card.tagPluginShort') }}
            </span>
            <button
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
            <AppMenu placement="bottom-end" :offset="[0, 6]">
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

                <div class="field">
                    <span class="label">{{ t('behaviors.card.triggerType') }}</span>
                    <AppSelectField v-model="draft.triggerType" :options="triggerTypeOptions" />
                </div>

                <label class="field">
                    <span class="label">{{ t('behaviors.card.triggerValue') }}</span>
                    <input v-model="draft.triggerValue" type="text" maxlength="2000" />
                </label>

                <div class="field">
                    <span class="label">{{ t('behaviors.card.forwardType') }}</span>
                    <AppSelectField v-model="draft.forwardType" :options="forwardTypeOptions" />
                </div>

                <div class="field">
                    <span class="label">{{ t('behaviors.card.targetId') }}</span>
                    <AppSelectField v-model="draft.targetId" :options="targetOptions" />
                </div>

                <div class="field">
                    <span class="label">{{ t('behaviors.card.behaviorType') }}</span>
                    <AppSelectField v-model="draft.type" :options="typeOptions" />
                </div>

                <template v-if="draft.type === 'webhook'">
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
                </template>

                <template v-else>
                    <div class="field full">
                        <span class="label">{{ t('behaviors.card.pluginPick') }}</span>
                        <AppSelectField
                            v-model="draft.pluginId"
                            :options="pluginOptions"
                            :placeholder="t('behaviors.card.pluginNoneAvailable')"
                            :disabled="pluginOptions.length === 0"
                        />
                    </div>
                    <div v-if="dmBehaviorOptions.length > 0" class="field full">
                        <span class="label">{{ t('behaviors.card.pluginBehaviorKey') }}</span>
                        <AppSelectField v-model="draft.pluginBehaviorKey" :options="dmBehaviorOptions" />
                    </div>
                </template>

                <label class="field full inline">
                    <input type="checkbox" v-model="draft.stopOnMatch" />
                    <span>{{ t('behaviors.card.stopOnMatch') }}</span>
                </label>
            </div>

            <p v-if="error" class="error" role="alert">{{ error }}</p>

            <footer class="actions">
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
.tag-plugin { background: var(--bg-page); color: var(--text-muted); border-color: var(--border); }

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
.field.inline { flex-direction: row; align-items: center; gap: 0.5rem; cursor: pointer; padding: 0.2rem 0; }
/* Checkbox inputs in inline fields must NOT inherit the .field input
   width:100% / padding rules — those are for text inputs and would
   stretch the checkbox to fill the row. */
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

@media (max-width: 640px) {
    .grid { grid-template-columns: 1fr; }
}
</style>
