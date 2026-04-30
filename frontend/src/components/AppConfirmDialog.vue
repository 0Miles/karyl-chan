<script setup lang="ts">
/**
 * AppConfirmDialog — App-level generic confirmation dialog.
 *
 * Wraps AppModal and provides a consistent confirm/cancel UI pattern:
 *   - Desktop: centered card modal with `AppModal`'s default body padding
 *     (0.9rem 1rem 0.75rem). Content layout (flex-column, gap) is handled
 *     internally so callers only need to pass props.
 *   - Mobile: AppModal's bottom-drawer branch with the same default body
 *     padding. No separate logic needed — AppModal handles the breakpoint.
 *
 * `closeOnBackdrop` and `closeOnEscape` are automatically disabled when
 * `loading` is true to prevent accidental dismissal during async operations.
 *
 * Emits:
 *   - `close`   — user pressed Cancel or the backdrop/Escape
 *   - `confirm` — user pressed the primary action button
 */
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { Icon } from '@iconify/vue';
import AppModal from './AppModal.vue';

const props = withDefaults(defineProps<{
    visible: boolean;
    title: string;
    message: string;
    confirmLabel: string;
    /** Button colour: 'danger' = red, 'primary' = accent (default). */
    confirmVariant?: 'primary' | 'danger';
    loading?: boolean;
    /** Error message shown in a red box below the message. */
    error?: string;
    /** Extra status line, e.g. "Progress: 3 / 10" for batch operations. */
    progress?: string;
    /** Override the cancel button label (defaults to common.cancel). */
    cancelLabel?: string;
}>(), {
    confirmVariant: 'primary',
    loading: false,
    error: undefined,
    progress: undefined,
    cancelLabel: undefined,
});

const emit = defineEmits<{
    (e: 'close'): void;
    (e: 'confirm'): void;
}>();

const { t } = useI18n();

const resolvedCancelLabel = computed(() =>
    props.cancelLabel ?? t('common.cancel')
);
</script>

<template>
    <AppModal
        :visible="visible"
        :title="title"
        :close-on-backdrop="!loading"
        :close-on-escape="!loading"
        @close="emit('close')"
    >
        <div class="acd-body">
            <p class="acd-message">{{ message }}</p>
            <p v-if="progress" class="acd-progress">{{ progress }}</p>
            <pre v-if="error" class="acd-error" role="alert">{{ error }}</pre>
            <div class="acd-actions">
                <button
                    type="button"
                    class="acd-btn acd-btn--ghost"
                    :disabled="loading"
                    @click="emit('close')"
                >
                    {{ resolvedCancelLabel }}
                </button>
                <button
                    type="button"
                    :class="['acd-btn', confirmVariant === 'danger' ? 'acd-btn--danger' : 'acd-btn--primary']"
                    :disabled="loading"
                    @click="emit('confirm')"
                >
                    <Icon
                        v-if="loading"
                        icon="material-symbols:progress-activity"
                        width="14"
                        height="14"
                        class="acd-spin"
                    />
                    {{ loading ? t('common.loading') : confirmLabel }}
                </button>
            </div>
        </div>
    </AppModal>
</template>

<style scoped>
/* Inner wrapper: provides padding + flex-column layout + gap.
   AppModal's .app-modal-body/.app-modal-drawer-body are structural-only
   (no padding), so each leaf component is responsible for its own spacing. */
.acd-body {
    padding: 0.9rem 1rem 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
}

.acd-message {
    margin: 0;
    color: var(--text);
    font-size: 0.9rem;
    line-height: 1.5;
}

.acd-progress {
    margin: 0;
    color: var(--text-muted);
    font-size: 0.85rem;
}

.acd-error {
    margin: 0;
    white-space: pre-wrap;
    background: color-mix(in srgb, var(--danger, #dc2626) 8%, transparent);
    border: 1px solid color-mix(in srgb, var(--danger, #dc2626) 30%, transparent);
    border-radius: var(--radius-base);
    padding: 0.5rem;
    font-size: 0.78rem;
    color: var(--danger, #dc2626);
    max-height: 12rem;
    overflow: auto;
}

/* ── Actions footer ─────────────────────────────────────────────── */
.acd-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    padding-top: 0.25rem;
    border-top: 1px solid var(--border);
}

/* ── Buttons ────────────────────────────────────────────────────── */
.acd-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.4rem 0.85rem;
    border-radius: var(--radius-sm);
    font-size: 0.85rem;
    font-weight: 500;
    cursor: pointer;
}
.acd-btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
}

.acd-btn--ghost {
    background: none;
    border: 1px solid var(--border);
    color: var(--text);
}
.acd-btn--ghost:not(:disabled):hover {
    background: var(--bg-surface-hover);
}

.acd-btn--primary {
    background: var(--accent);
    color: var(--text-on-accent);
    border: none;
}
.acd-btn--primary:not(:disabled):hover {
    filter: brightness(1.1);
}

.acd-btn--danger {
    background: var(--danger, #dc2626);
    color: #fff;
    border: none;
}
.acd-btn--danger:not(:disabled):hover {
    filter: brightness(1.1);
}

@keyframes spin { to { transform: rotate(360deg); } }
.acd-spin { animation: spin 0.8s linear infinite; }
</style>
