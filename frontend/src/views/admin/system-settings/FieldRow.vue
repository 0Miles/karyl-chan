<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { isSensitiveField, type SettingsField } from '../../../api/systemSettings';

const props = defineProps<{
    field: SettingsField;
}>();

const { t } = useI18n();

const isSensitive = computed(() => isSensitiveField(props.field));

/** Extract the last dotted segment for the description key lookup. */
const descLabel = computed(() => {
    try {
        return t(props.field.descriptionKey);
    } catch {
        // fallback: last path segment
        const parts = props.field.path.split('.');
        return parts[parts.length - 1] ?? props.field.path;
    }
});

/** Human-readable value for non-sensitive fields. */
const displayValue = computed(() => {
    if (isSensitiveField(props.field)) return null;
    const v = props.field.value;
    if (v === null || v === undefined) return '';
    if (typeof v === 'boolean') return String(v);
    return String(v);
});

const SENSITIVITY_KEYS: Record<string, string> = {
    'sensitive': 'sensitive',
    'semi-sensitive': 'semisensitive',
    'public': 'public',
};

const EDITABILITY_KEYS: Record<string, string> = {
    'env-only': 'envonly',
    'runtime-capable': 'runtimeCapable',
    'runtime-editable': 'runtimeEditable',
};

function sensitivityKey(s: string): string {
    return SENSITIVITY_KEYS[s] ?? s;
}

function editabilityKey(e: string): string {
    return EDITABILITY_KEYS[e] ?? e;
}

const sensitivityClass = computed((): string => {
    switch (props.field.sensitivity) {
        case 'sensitive': return 'badge--sensitive';
        case 'semi-sensitive': return 'badge--semi';
        default: return 'badge--public';
    }
});

const editabilityClass = computed((): string => {
    switch (props.field.editability) {
        case 'runtime-editable': return 'badge--editable';
        case 'runtime-capable': return 'badge--capable';
        default: return 'badge--envonly';
    }
});
</script>

<template>
    <div class="field-row">
        <div class="field-main">
            <span class="field-label">{{ descLabel }}</span>
            <div class="field-value-area">
                <!-- Sensitive: show configured/unset status badge only, never a value -->
                <template v-if="isSensitive">
                    <span
                        :class="['status-badge', (field as any).status === 'configured' ? 'status-badge--ok' : 'status-badge--unset']"
                    >
                        {{ (field as any).status === 'configured'
                            ? t('admin.systemSettings.status.configured')
                            : t('admin.systemSettings.status.unset') }}
                    </span>
                </template>
                <!-- Non-sensitive: readonly input showing value -->
                <template v-else>
                    <input
                        class="field-input"
                        type="text"
                        :value="displayValue ?? ''"
                        readonly
                        tabindex="-1"
                        spellcheck="false"
                        :placeholder="displayValue === '' ? '(empty)' : undefined"
                    />
                </template>
            </div>
        </div>
        <div class="field-meta">
            <div class="badge-group">
                <span :class="['badge', sensitivityClass]">
                    {{ t(`admin.systemSettings.badge.${sensitivityKey(field.sensitivity)}`) }}
                </span>
                <span :class="['badge', editabilityClass]">
                    {{ t(`admin.systemSettings.badge.${editabilityKey(field.editability)}`) }}
                </span>
                <span v-if="field.productionRequired" class="badge badge--prod">
                    {{ t('admin.systemSettings.badge.prodRequired') }}
                </span>
            </div>
            <code class="env-var">{{ field.envVar }}</code>
        </div>
    </div>
</template>

<style scoped>
.field-row {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 0.4rem 0.75rem;
    align-items: start;
    padding: 0.45rem 0.75rem;
    border-bottom: 1px solid var(--border);
    min-width: 0;
}
.field-row:last-child {
    border-bottom: none;
}
.field-row:hover {
    background: var(--bg-surface-hover, color-mix(in srgb, var(--bg-surface) 95%, var(--text)));
}

.field-main {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    min-width: 0;
    flex-wrap: wrap;
}

.field-label {
    font-size: 0.83rem;
    color: var(--text-strong);
    flex-shrink: 0;
    min-width: 8rem;
}

.field-value-area {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
}

.field-input {
    width: 100%;
    max-width: 22rem;
    padding: 0.2rem 0.45rem;
    font-family: var(--font-mono, monospace);
    font-size: 0.78rem;
    background: var(--bg-page);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text-muted);
    cursor: default;
    user-select: text;
}
.field-input::placeholder {
    color: var(--text-faint);
    font-style: italic;
}

/* Configured / unset status for sensitive fields */
.status-badge {
    display: inline-flex;
    align-items: center;
    font-size: 0.74rem;
    font-weight: 600;
    letter-spacing: 0.03em;
    padding: 0.18rem 0.55rem;
    border-radius: 999px;
    text-transform: uppercase;
}
.status-badge--ok {
    background: color-mix(in srgb, var(--success, #16a34a) 14%, var(--bg-surface));
    color: var(--success, #16a34a);
    border: 1px solid color-mix(in srgb, var(--success, #16a34a) 30%, transparent);
}
.status-badge--unset {
    background: color-mix(in srgb, var(--text-muted) 12%, var(--bg-surface));
    color: var(--text-muted);
    border: 1px solid var(--border);
}

/* Right-side meta: badges + env var */
.field-meta {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 0.28rem;
    flex-shrink: 0;
}

.badge-group {
    display: flex;
    gap: 0.25rem;
    flex-wrap: wrap;
    justify-content: flex-end;
}

.badge {
    display: inline-flex;
    align-items: center;
    font-size: 0.67rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    padding: 0.14rem 0.42rem;
    border-radius: 999px;
    text-transform: uppercase;
    white-space: nowrap;
    border: 1px solid transparent;
}

/* sensitivity badges */
.badge--sensitive {
    background: color-mix(in srgb, var(--danger, #dc2626) 12%, var(--bg-surface));
    color: var(--danger, #dc2626);
    border-color: color-mix(in srgb, var(--danger, #dc2626) 28%, transparent);
}
.badge--semi {
    background: color-mix(in srgb, var(--warning, #d97706) 12%, var(--bg-surface));
    color: var(--warning, #d97706);
    border-color: color-mix(in srgb, var(--warning, #d97706) 28%, transparent);
}
.badge--public {
    background: color-mix(in srgb, var(--text-muted) 10%, var(--bg-surface));
    color: var(--text-muted);
    border-color: var(--border);
}

/* editability badges */
.badge--envonly {
    background: color-mix(in srgb, var(--text-muted) 10%, var(--bg-surface));
    color: var(--text-muted);
    border-color: var(--border);
}
.badge--capable {
    background: color-mix(in srgb, #3b82f6 11%, var(--bg-surface));
    color: #3b82f6;
    border-color: color-mix(in srgb, #3b82f6 25%, transparent);
}
.badge--editable {
    background: color-mix(in srgb, var(--success, #16a34a) 11%, var(--bg-surface));
    color: var(--success, #16a34a);
    border-color: color-mix(in srgb, var(--success, #16a34a) 25%, transparent);
}

/* prod required */
.badge--prod {
    background: color-mix(in srgb, #f97316 12%, var(--bg-surface));
    color: #f97316;
    border-color: color-mix(in srgb, #f97316 28%, transparent);
}

/* env var name */
.env-var {
    font-family: var(--font-mono, monospace);
    font-size: 0.72rem;
    color: var(--text-faint);
    letter-spacing: 0.02em;
    white-space: nowrap;
}

/* Mobile: stack layout */
@media (max-width: 640px) {
    .field-row {
        grid-template-columns: 1fr;
    }
    .field-meta {
        align-items: flex-start;
    }
    .badge-group {
        justify-content: flex-start;
    }
}
</style>
