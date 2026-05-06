<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { Icon } from '@iconify/vue';
import AppModal from '../../../components/AppModal.vue';
import AppConfirmDialog from '../../../components/AppConfirmDialog.vue';
import { generatePluginSetupSecret, type PluginDetailRecord } from '../../../api/plugins';

const props = defineProps<{
    plugin: PluginDetailRecord;
}>();

const { t } = useI18n();

const setupSecretConfirmOpen = ref(false);
const setupSecretResultOpen = ref(false);
const setupSecretGenerating = ref(false);
const setupSecretError = ref<string | null>(null);
const setupSecretValue = ref('');
const setupSecretCopied = ref(false);
const setupSecretAcknowledged = ref(false);

async function confirmGenerateSetupSecret() {
    if (setupSecretGenerating.value) return;
    setupSecretGenerating.value = true;
    setupSecretError.value = null;
    try {
        const result = await generatePluginSetupSecret(props.plugin.pluginKey);
        setupSecretValue.value = result.setupSecret;
        setupSecretAcknowledged.value = false;
        setupSecretCopied.value = false;
        setupSecretConfirmOpen.value = false;
        setupSecretResultOpen.value = true;
    } catch (err) {
        setupSecretError.value = err instanceof Error ? err.message : String(err);
    } finally {
        setupSecretGenerating.value = false;
    }
}

async function copySetupSecret() {
    try {
        await navigator.clipboard.writeText(setupSecretValue.value);
        setupSecretCopied.value = true;
        setTimeout(() => { setupSecretCopied.value = false; }, 2000);
    } catch {
        const el = document.getElementById(`setup-secret-detail-${props.plugin.id}`) as HTMLInputElement | null;
        if (el) {
            el.select();
            el.setSelectionRange(0, el.value.length);
        }
    }
}

function closeSecretResult() {
    setupSecretResultOpen.value = false;
    setupSecretValue.value = '';
    setupSecretAcknowledged.value = false;
    setupSecretCopied.value = false;
}
</script>

<template>
    <div class="tab-panel">
        <section class="section">
            <h3 class="section-title">Setup Secret</h3>
            <p class="section-desc">
                重新產生 Setup Secret 後，舊的 secret 立即失效。Plugin 必須使用新 secret 重新向 bot 登記。
            </p>
            <div class="section-action">
                <button
                    type="button"
                    class="danger-btn"
                    @click="setupSecretConfirmOpen = true"
                >
                    <Icon icon="material-symbols:key-outline-rounded" width="14" height="14" />
                    {{ t('admin.plugins.setupSecret.button') }}
                </button>
            </div>
        </section>
    </div>

    <!-- Setup secret: confirm modal -->
    <AppConfirmDialog
        :visible="setupSecretConfirmOpen"
        :title="t('admin.plugins.setupSecret.confirmTitle')"
        :message="t('admin.plugins.setupSecret.confirmBody', { name: plugin.name })"
        :confirm-label="t('admin.plugins.setupSecret.button')"
        confirm-variant="danger"
        :loading="setupSecretGenerating"
        :error="setupSecretError ?? undefined"
        @close="setupSecretConfirmOpen = false"
        @confirm="confirmGenerateSetupSecret"
    />

    <!-- Setup secret: result modal (cleartext, shown once) -->
    <AppModal
        :visible="setupSecretResultOpen"
        :title="t('admin.plugins.setupSecret.resultTitle')"
        :close-on-backdrop="false"
        :close-on-escape="false"
        width="min(540px, 94vw)"
        @close="closeSecretResult"
    >
        <div class="secret-result-body">
            <p class="secret-result-label">{{ t('admin.plugins.setupSecret.secretLabel') }}</p>
            <div class="secret-input-row">
                <input
                    :id="`setup-secret-detail-${plugin.id}`"
                    type="text"
                    class="secret-input"
                    :value="setupSecretValue"
                    readonly
                    spellcheck="false"
                    autocomplete="off"
                    @click="($event.target as HTMLInputElement).select()"
                />
                <button type="button" class="copy-btn" :class="{ copied: setupSecretCopied }" @click="copySetupSecret">
                    <Icon
                        :icon="setupSecretCopied ? 'material-symbols:check-rounded' : 'material-symbols:content-copy-outline-rounded'"
                        width="15"
                        height="15"
                    />
                    {{ setupSecretCopied ? t('admin.plugins.setupSecret.copiedButton') : t('admin.plugins.setupSecret.copyButton') }}
                </button>
            </div>
            <p class="secret-instruction">{{ t('admin.plugins.setupSecret.instruction') }}</p>
            <div class="secret-env-hint">
                <code>{{ t('admin.plugins.setupSecret.envHint', { secret: setupSecretValue }) }}</code>
            </div>
            <div class="secret-warning" role="alert">
                <Icon icon="material-symbols:warning-outline-rounded" width="15" height="15" class="secret-warning-icon" />
                <span>{{ t('admin.plugins.setupSecret.warning') }}</span>
            </div>
            <label class="secret-ack-label">
                <input type="checkbox" v-model="setupSecretAcknowledged" class="secret-ack-checkbox" />
                <span>{{ t('admin.plugins.setupSecret.checkboxLabel') }}</span>
            </label>
            <div class="secret-result-actions">
                <button type="button" class="primary" :disabled="!setupSecretAcknowledged" @click="closeSecretResult">
                    {{ t('admin.plugins.setupSecret.closeButton') }}
                </button>
            </div>
        </div>
    </AppModal>
</template>

<style scoped>
.tab-panel {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding: 0.5rem 0;
}
.section {
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-base);
    padding: 0.8rem 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
}
.section-title {
    margin: 0;
    font-size: 0.92rem;
    font-weight: 600;
    color: var(--text-strong);
}
.section-desc {
    margin: 0;
    font-size: 0.85rem;
    color: var(--text-muted);
    line-height: 1.5;
}
.section-action { display: flex; }
.danger-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.35rem 0.75rem;
    font-size: 0.82rem;
    font-weight: 500;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--danger, #dc2626);
    border: 1px solid color-mix(in srgb, var(--danger, #dc2626) 45%, transparent);
    cursor: pointer;
    transition: background 0.12s, border-color 0.12s;
}
.danger-btn:hover {
    background: color-mix(in srgb, var(--danger, #dc2626) 9%, var(--bg-surface));
    border-color: color-mix(in srgb, var(--danger, #dc2626) 65%, transparent);
}

/* Secret result modal */
.secret-result-body {
    padding: 0.9rem 1rem 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.7rem;
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
.copy-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.22rem;
    flex-shrink: 0;
    padding: 0.35rem 0.7rem;
    font-size: 0.8rem;
    font-weight: 500;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
    background: var(--bg-surface);
    color: var(--text);
    cursor: pointer;
    transition: background 0.12s, color 0.12s, border-color 0.12s;
}
.copy-btn:hover { background: var(--bg-surface-hover, var(--bg-page)); }
.copy-btn.copied {
    background: color-mix(in srgb, var(--success, #16a34a) 14%, var(--bg-surface));
    color: var(--success, #16a34a);
    border-color: color-mix(in srgb, var(--success, #16a34a) 35%, transparent);
}
.secret-instruction { margin: 0; font-size: 0.82rem; color: var(--text-muted); }
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
.secret-warning-icon { flex-shrink: 0; margin-top: 0.1rem; }
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
.secret-result-actions .primary {
    padding: 0.4rem 0.85rem;
    background: var(--accent);
    color: var(--text-on-accent);
    border: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
    font-size: 0.85rem;
    font-weight: 500;
}
.secret-result-actions .primary:disabled {
    opacity: 0.45;
    cursor: not-allowed;
}
</style>
