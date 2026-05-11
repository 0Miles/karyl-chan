<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { Icon } from '@iconify/vue';
import AppModal from '../../../components/AppModal.vue';
import AppButton from '../../../components/AppButton.vue';
import { generatePluginSetupSecret } from '../../../api/plugins';

const { t } = useI18n();

const props = defineProps<{
    visible: boolean;
}>();

const emit = defineEmits<{
    (e: 'close'): void;
    (e: 'created', pluginKey: string): void;
}>();

// ── Step 1 state ────────────────────────────────────────────────────
const pluginKey = ref('');
const submitting = ref(false);
const submitError = ref<string | null>(null);

const PLUGIN_KEY_RE = /^[a-z0-9][a-z0-9-]*$/;

const keyTouched = ref(false);

const inlineKeyError = computed(() => {
    if (!keyTouched.value) return null;
    const v = pluginKey.value.trim();
    if (!v) return t('admin.plugins.addPlugin.keyInvalid');
    if (!PLUGIN_KEY_RE.test(v)) return t('admin.plugins.addPlugin.keyInvalid');
    return null;
});

const canSubmit = computed(() => {
    const v = pluginKey.value.trim();
    return v.length > 0 && PLUGIN_KEY_RE.test(v) && !submitting.value;
});

// ── Step 2 state ────────────────────────────────────────────────────
const step = ref<1 | 2>(1);
const secretValue = ref('');
const secretCopied = ref(false);
const secretAcknowledged = ref(false);
const wasCreated = ref(true); // created === true means brand-new placeholder

// ── Reset on open/close ─────────────────────────────────────────────
watch(() => props.visible, (open) => {
    if (open) {
        pluginKey.value = '';
        keyTouched.value = false;
        submitError.value = null;
        step.value = 1;
        secretValue.value = '';
        secretCopied.value = false;
        secretAcknowledged.value = false;
        wasCreated.value = true;
    }
});

// ── Submit (step 1 → step 2) ─────────────────────────────────────────
async function onSubmit() {
    keyTouched.value = true;
    if (!canSubmit.value) return;
    submitting.value = true;
    submitError.value = null;
    try {
        const result = await generatePluginSetupSecret(pluginKey.value.trim());
        secretValue.value = result.setupSecret;
        wasCreated.value = result.created;
        secretCopied.value = false;
        secretAcknowledged.value = false;
        step.value = 2;
        emit('created', result.pluginKey);
    } catch (err) {
        submitError.value = err instanceof Error ? err.message : String(err);
    } finally {
        submitting.value = false;
    }
}

// ── Copy ─────────────────────────────────────────────────────────────
async function copySecret() {
    try {
        await navigator.clipboard.writeText(secretValue.value);
        secretCopied.value = true;
        setTimeout(() => { secretCopied.value = false; }, 2000);
    } catch {
        const el = document.getElementById('add-plugin-secret-input') as HTMLInputElement | null;
        if (el) {
            el.select();
            el.setSelectionRange(0, el.value.length);
        }
    }
}

// ── Close (step 2 acknowledge) ────────────────────────────────────────
function onClose() {
    // Don't leave the one-time secret sitting in memory (mirrors PluginCard).
    secretValue.value = '';
    secretCopied.value = false;
    secretAcknowledged.value = false;
    emit('close');
}
</script>

<template>
    <AppModal
        :visible="visible"
        :title="step === 1 ? t('admin.plugins.addPlugin.title') : t('admin.plugins.setupSecret.resultTitle')"
        :close-on-backdrop="step === 1"
        :close-on-escape="step === 1"
        width="min(500px, 94vw)"
        @close="onClose"
    >
        <!-- ── Step 1: Enter plugin key ───────────────────────────── -->
        <div v-if="step === 1" class="modal-body">
            <p class="body-text">{{ t('admin.plugins.addPlugin.body') }}</p>

            <div class="form-section">
                <label class="field">
                    <span class="label">{{ t('admin.plugins.addPlugin.keyLabel') }}</span>
                    <input
                        v-model="pluginKey"
                        type="text"
                        :placeholder="t('admin.plugins.addPlugin.keyPlaceholder')"
                        :class="['key-input', { 'key-input--error': inlineKeyError }]"
                        spellcheck="false"
                        autocomplete="off"
                        autofocus
                        @blur="keyTouched = true"
                        @keydown.enter="onSubmit"
                    />
                    <span v-if="inlineKeyError" class="field-error" role="alert">
                        {{ inlineKeyError }}
                    </span>
                </label>
            </div>

            <p v-if="submitError" class="error" role="alert">{{ submitError }}</p>

            <footer class="actions">
                <AppButton variant="ghost" :disabled="submitting" @click="onClose">
                    {{ t('common.cancel') }}
                </AppButton>
                <AppButton
                    variant="primary"
                    :loading="submitting"
                    :disabled="!canSubmit"
                    @click="onSubmit"
                >
                    {{ t('admin.plugins.addPlugin.submit') }}
                </AppButton>
            </footer>
        </div>

        <!-- ── Step 2: Show one-time secret ─────────────────────── -->
        <div v-else class="secret-result-body">
            <!-- "already existed" notice when created === false -->
            <div v-if="!wasCreated" class="already-exists-notice" role="status">
                <Icon icon="material-symbols:info-outline-rounded" width="15" height="15" class="notice-icon" />
                <span>{{ t('admin.plugins.addPlugin.alreadyExists') }}</span>
            </div>

            <p class="secret-result-label">{{ t('admin.plugins.setupSecret.secretLabel') }}</p>
            <div class="secret-input-row">
                <input
                    id="add-plugin-secret-input"
                    type="text"
                    class="secret-input"
                    :value="secretValue"
                    readonly
                    spellcheck="false"
                    autocomplete="off"
                    @click="($event.target as HTMLInputElement).select()"
                />
                <AppButton
                    :variant="secretCopied ? 'secondary' : 'ghost'"
                    size="sm"
                    :icon="secretCopied ? 'material-symbols:check-rounded' : 'material-symbols:content-copy-outline-rounded'"
                    :style="secretCopied ? 'color: var(--success, #16a34a); border-color: color-mix(in srgb, var(--success, #16a34a) 35%, transparent);' : ''"
                    @click="copySecret"
                >
                    {{ secretCopied ? t('admin.plugins.setupSecret.copiedButton') : t('admin.plugins.setupSecret.copyButton') }}
                </AppButton>
            </div>
            <p class="secret-instruction">{{ t('admin.plugins.setupSecret.instruction') }}</p>
            <div class="secret-env-hint">
                <code>{{ t('admin.plugins.setupSecret.envHint', { secret: secretValue }) }}</code>
            </div>
            <div class="secret-warning" role="alert">
                <Icon icon="material-symbols:warning-outline-rounded" width="15" height="15" class="secret-warning-icon" />
                <span>{{ t('admin.plugins.setupSecret.warning') }}</span>
            </div>
            <label class="secret-ack-label">
                <input
                    type="checkbox"
                    v-model="secretAcknowledged"
                    class="secret-ack-checkbox"
                />
                <span>{{ t('admin.plugins.setupSecret.checkboxLabel') }}</span>
            </label>
            <div class="secret-result-actions">
                <AppButton variant="primary" :disabled="!secretAcknowledged" @click="onClose">
                    {{ t('admin.plugins.setupSecret.closeButton') }}
                </AppButton>
            </div>
        </div>
    </AppModal>
</template>

<style scoped>
/* ── Step 1 ─────────────────────────────────────────────────────── */
.modal-body {
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
}

.body-text {
    margin: 0;
    font-size: 0.88rem;
    color: var(--text-muted);
    line-height: 1.55;
}

.form-section {
    display: flex;
    flex-direction: column;
    gap: 0.65rem;
}

.field {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
}

.label {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--text-muted);
}

.key-input {
    padding: 0.45rem 0.6rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg-surface);
    color: var(--text);
    font: inherit;
    font-family: var(--font-mono, monospace);
    font-size: 0.88rem;
    width: 100%;
    box-sizing: border-box;
}
.key-input:focus {
    outline: none;
    border-color: var(--accent);
}
.key-input--error {
    border-color: var(--danger, #dc2626);
}
.key-input--error:focus {
    border-color: var(--danger, #dc2626);
    outline: 2px solid color-mix(in srgb, var(--danger, #dc2626) 30%, transparent);
    outline-offset: -1px;
}

.field-error {
    font-size: 0.78rem;
    color: var(--danger, #dc2626);
}

.error {
    color: var(--danger);
    margin: 0;
    font-size: 0.85rem;
}

.actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    padding-top: 0.25rem;
}

/* ── Step 2 (mirrors PluginCard secret result) ───────────────────── */
.secret-result-body {
    padding: 0.9rem 1rem 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.7rem;
}

.already-exists-notice {
    display: flex;
    align-items: flex-start;
    gap: 0.35rem;
    padding: 0.45rem 0.65rem;
    background: color-mix(in srgb, var(--accent, #5865f2) 10%, var(--bg-surface));
    border: 1px solid color-mix(in srgb, var(--accent, #5865f2) 30%, transparent);
    border-radius: var(--radius-sm);
    font-size: 0.82rem;
    color: var(--accent, #5865f2);
    line-height: 1.45;
}
.notice-icon {
    flex-shrink: 0;
    margin-top: 0.1rem;
}

.secret-result-label {
    margin: 0;
    font-size: 0.82rem;
    font-weight: 600;
    color: var(--text-strong);
}

.secret-input-row {
    display: flex;
    gap: 0.4rem;
    align-items: stretch;
}

.secret-input {
    flex: 1;
    min-width: 0;
    padding: 0.4rem 0.6rem;
    font-family: var(--font-mono, monospace);
    font-size: 0.82rem;
    letter-spacing: 0.02em;
    background: var(--bg-page);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text-strong);
    cursor: text;
    user-select: all;
}
.secret-input:focus {
    outline: 2px solid var(--accent);
    outline-offset: -1px;
}

.secret-instruction {
    margin: 0;
    font-size: 0.82rem;
    color: var(--text-muted);
}

.secret-env-hint {
    background: var(--bg-page);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 0.5rem 0.7rem;
    overflow-x: auto;
}
.secret-env-hint code {
    font-family: var(--font-mono, monospace);
    font-size: 0.82rem;
    color: var(--text-strong);
    white-space: nowrap;
}

.secret-warning {
    display: flex;
    align-items: flex-start;
    gap: 0.35rem;
    padding: 0.5rem 0.65rem;
    background: color-mix(in srgb, var(--warning, #d97706) 11%, var(--bg-surface));
    border: 1px solid color-mix(in srgb, var(--warning, #d97706) 35%, transparent);
    border-radius: var(--radius-sm);
    font-size: 0.82rem;
    color: var(--warning, #d97706);
    line-height: 1.45;
}
.secret-warning-icon {
    flex-shrink: 0;
    margin-top: 0.1rem;
}

.secret-ack-label {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    font-size: 0.85rem;
    color: var(--text);
    cursor: pointer;
    user-select: none;
}
.secret-ack-checkbox {
    width: 15px;
    height: 15px;
    flex-shrink: 0;
    cursor: pointer;
    accent-color: var(--accent);
}

.secret-result-actions {
    display: flex;
    justify-content: flex-end;
    padding-top: 0.25rem;
    border-top: 1px solid var(--border);
}
</style>
