<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { Icon } from '@iconify/vue';
import { getSystemSettings, type SystemSettingsResponse } from '../../../api/systemSettings';
import GroupSection from './GroupSection.vue';

const { t } = useI18n();

const data = ref<SystemSettingsResponse | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);

async function load() {
    loading.value = true;
    error.value = null;
    try {
        data.value = await getSystemSettings();
    } catch (err) {
        error.value = err instanceof Error ? err.message : String(err);
    } finally {
        loading.value = false;
    }
}

onMounted(load);
</script>

<template>
    <div class="page">
        <!-- Page header -->
        <header class="page-head">
            <div class="page-head-text">
                <h1 class="title">{{ t('admin.systemSettings.title') }}</h1>
                <p class="subtitle">{{ t('admin.systemSettings.subtitle') }}</p>
            </div>
            <button
                type="button"
                class="ghost"
                :disabled="loading"
                :title="t('common.refresh')"
                @click="load"
            >
                <Icon
                    icon="material-symbols:refresh"
                    width="18"
                    height="18"
                    :class="{ spin: loading }"
                />
            </button>
        </header>

        <!-- Loading skeleton -->
        <div v-if="loading && !data" class="skeleton-list" aria-busy="true" aria-label="Loading">
            <div v-for="i in 6" :key="i" class="skeleton-item" />
        </div>

        <!-- Error state -->
        <div v-else-if="error" class="error-banner" role="alert">
            <Icon icon="material-symbols:error-outline-rounded" width="18" height="18" class="error-icon" />
            <span>{{ error }}</span>
            <button type="button" class="retry-btn" @click="load">
                {{ t('admin.systemSettings.retry') }}
            </button>
        </div>

        <template v-else-if="data">
            <!-- Production readiness banner -->
            <div
                :class="[
                    'readiness-banner',
                    data.productionReadiness.allSet && data.productionReadiness.currentEnv === 'production'
                        ? 'readiness-banner--ok'
                        : 'readiness-banner--warn'
                ]"
                role="status"
            >
                <Icon
                    :icon="data.productionReadiness.allSet && data.productionReadiness.currentEnv === 'production'
                        ? 'material-symbols:check-circle-outline-rounded'
                        : 'material-symbols:warning-outline-rounded'"
                    width="17"
                    height="17"
                    class="banner-icon"
                />
                <div class="banner-text">
                    <template v-if="data.productionReadiness.allSet && data.productionReadiness.currentEnv === 'production'">
                        <strong>{{ t('admin.systemSettings.readiness.allSet') }}</strong>
                    </template>
                    <template v-else>
                        <strong>{{ t('admin.systemSettings.readiness.missing', { count: data.productionReadiness.missingKeys.length }) }}</strong>
                        <span class="banner-env">({{ t('admin.systemSettings.readiness.env', { env: data.productionReadiness.currentEnv }) }})</span>
                        <div v-if="data.productionReadiness.missingKeys.length > 0" class="missing-keys">
                            <code
                                v-for="key in data.productionReadiness.missingKeys"
                                :key="key"
                                class="missing-key"
                            >{{ key }}</code>
                        </div>
                    </template>
                </div>
            </div>

            <!-- Runtime-editable section -->
            <section class="section">
                <h2 class="section-title">
                    <Icon icon="material-symbols:edit-outline-rounded" width="15" height="15" />
                    {{ t('admin.systemSettings.runtime.title') }}
                </h2>
                <!-- Empty state (current: always empty) -->
                <div
                    v-if="data.runtimeEditable.fields.length === 0"
                    class="empty-runtime"
                    role="status"
                >
                    <Icon icon="material-symbols:lock-outline-rounded" width="22" height="22" class="empty-icon" />
                    <span class="empty-msg">{{ t('admin.systemSettings.runtime.empty') }}</span>
                </div>
                <!-- Future: render editable fields here -->
            </section>

            <!-- Read-only groups -->
            <section class="section">
                <h2 class="section-title">
                    <Icon icon="material-symbols:settings-outline-rounded" width="15" height="15" />
                    {{ t('admin.systemSettings.readonly.title') }}
                </h2>
                <div class="groups-list">
                    <GroupSection
                        v-for="(group, idx) in data.groups"
                        :key="group.group"
                        :group="group"
                        :initially-open="idx === 0"
                    />
                </div>
            </section>
        </template>
    </div>
</template>

<style scoped>
.page {
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
    padding: 0.75rem;
    height: 100%;
    overflow-y: auto;
}

/* ── Page header ──────────────────────────────────────────────────── */
.page-head {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
}
.page-head-text { flex: 1; min-width: 0; }
.title {
    margin: 0;
    font-size: 1.1rem;
    color: var(--text-strong);
}
.subtitle {
    margin: 0.2rem 0 0;
    color: var(--text-muted);
    font-size: 0.83rem;
}
.ghost {
    background: none;
    border: 1px solid var(--border);
    color: var(--text);
    padding: 0.4rem;
    border-radius: var(--radius-sm);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    flex-shrink: 0;
    margin-top: 0.1rem;
}
.ghost:hover { background: var(--bg-surface-hover); }
.ghost:disabled { opacity: 0.55; cursor: not-allowed; }

/* ── Skeleton ─────────────────────────────────────────────────────── */
.skeleton-list {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
}
.skeleton-item {
    height: 2.4rem;
    border-radius: var(--radius-base);
    background: linear-gradient(
        90deg,
        var(--bg-surface) 25%,
        color-mix(in srgb, var(--bg-surface) 80%, var(--text-muted)) 50%,
        var(--bg-surface) 75%
    );
    background-size: 200% 100%;
    animation: shimmer 1.4s ease-in-out infinite;
}
@keyframes shimmer {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
}

/* ── Error banner ─────────────────────────────────────────────────── */
.error-banner {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.65rem 0.85rem;
    background: color-mix(in srgb, var(--danger, #dc2626) 10%, var(--bg-surface));
    border: 1px solid color-mix(in srgb, var(--danger, #dc2626) 28%, transparent);
    border-radius: var(--radius-base);
    color: var(--danger, #dc2626);
    font-size: 0.88rem;
}
.error-icon { flex-shrink: 0; }
.error-banner span { flex: 1; }
.retry-btn {
    background: none;
    border: 1px solid color-mix(in srgb, var(--danger, #dc2626) 45%, transparent);
    color: var(--danger, #dc2626);
    padding: 0.28rem 0.7rem;
    border-radius: var(--radius-sm);
    cursor: pointer;
    font-size: 0.82rem;
    flex-shrink: 0;
}
.retry-btn:hover {
    background: color-mix(in srgb, var(--danger, #dc2626) 9%, var(--bg-surface));
}

/* ── Readiness banner ─────────────────────────────────────────────── */
.readiness-banner {
    display: flex;
    align-items: flex-start;
    gap: 0.55rem;
    padding: 0.65rem 0.85rem;
    border-radius: var(--radius-base);
    border: 1px solid transparent;
    font-size: 0.88rem;
    line-height: 1.45;
}
.readiness-banner--ok {
    background: color-mix(in srgb, var(--success, #16a34a) 10%, var(--bg-surface));
    border-color: color-mix(in srgb, var(--success, #16a34a) 28%, transparent);
    color: var(--success, #16a34a);
}
.readiness-banner--warn {
    background: color-mix(in srgb, var(--warning, #d97706) 10%, var(--bg-surface));
    border-color: color-mix(in srgb, var(--warning, #d97706) 28%, transparent);
    color: var(--warning, #d97706);
}
.banner-icon { flex-shrink: 0; margin-top: 0.1rem; }
.banner-text {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.35rem;
    color: inherit;
}
.banner-env {
    font-size: 0.8rem;
    opacity: 0.8;
}
.missing-keys {
    width: 100%;
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
    margin-top: 0.35rem;
}
.missing-key {
    font-family: var(--font-mono, monospace);
    font-size: 0.75rem;
    padding: 0.1rem 0.4rem;
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--warning, #d97706) 15%, var(--bg-surface));
    border: 1px solid color-mix(in srgb, var(--warning, #d97706) 30%, transparent);
    color: var(--warning, #d97706);
}

/* ── Section headings ─────────────────────────────────────────────── */
.section {
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
}
.section-title {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    margin: 0;
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
}

/* ── Runtime empty ────────────────────────────────────────────────── */
.empty-runtime {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    padding: 0.75rem 1rem;
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-base);
    color: var(--text-muted);
}
.empty-icon { color: var(--text-faint); flex-shrink: 0; }
.empty-msg { font-size: 0.85rem; }

/* ── Groups list ──────────────────────────────────────────────────── */
.groups-list {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
}

/* Refresh spin animation */
@keyframes spin { to { transform: rotate(360deg); } }
.spin { animation: spin 0.75s linear infinite; }
</style>
