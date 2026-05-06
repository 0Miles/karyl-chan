<script setup lang="ts">
import { ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { Icon } from '@iconify/vue';
import AppModal from '../../../components/AppModal.vue';
import { approvePluginScopes, type PluginDetailRecord } from '../../../api/plugins';

const props = defineProps<{
    plugin: PluginDetailRecord;
}>();

const emit = defineEmits<{
    (e: 'reload'): void;
}>();

const { t } = useI18n();

const approvedScopes = ref<string[]>(props.plugin.approvedScopes ?? []);
const pendingScopes = ref<string[]>(props.plugin.pendingScopes ?? []);

watch(() => props.plugin.approvedScopes, (v) => { approvedScopes.value = v ?? []; });
watch(() => props.plugin.pendingScopes, (v) => { pendingScopes.value = v ?? []; });

const approveModalOpen = ref(false);
const approving = ref(false);
const approveError = ref<string | null>(null);

async function confirmApproveScopes() {
    if (approving.value) return;
    approving.value = true;
    approveError.value = null;
    try {
        const result = await approvePluginScopes(props.plugin.id);
        approvedScopes.value = result.approved;
        pendingScopes.value = result.pending;
        approveModalOpen.value = false;
        emit('reload');
    } catch (err) {
        approveError.value = err instanceof Error ? err.message : String(err);
    } finally {
        approving.value = false;
    }
}
</script>

<template>
    <div class="tab-panel">
        <!-- Pending scopes -->
        <section v-if="pendingScopes.length > 0" class="scope-section pending-section">
            <div class="section-head">
                <h3 class="section-title">{{ t('admin.plugins.detail.scopes.pending') }}</h3>
                <span class="pending-count-badge">
                    <Icon icon="material-symbols:security-rounded" width="13" height="13" />
                    {{ t('admin.plugins.detail.scopes.pendingCount', { n: pendingScopes.length }) }}
                </span>
            </div>
            <div class="scope-chips">
                <code v-for="s in pendingScopes" :key="s" class="scope-chip scope-chip--pending">{{ s }}</code>
            </div>
            <div class="section-actions">
                <button type="button" class="approve-btn" :disabled="approving" @click="approveModalOpen = true">
                    <Icon icon="material-symbols:check-circle-outline-rounded" width="14" height="14" />
                    {{ t('admin.plugins.detail.scopes.approveButton') }}
                </button>
            </div>
        </section>

        <!-- Approved scopes -->
        <section class="scope-section">
            <h3 class="section-title">{{ t('admin.plugins.detail.scopes.approved') }}</h3>
            <div v-if="approvedScopes.length === 0" class="empty-scopes">
                <Icon icon="material-symbols:check-circle-outline-rounded" width="20" height="20" class="empty-icon" />
                <span>尚無已授權的 RPC Scope</span>
            </div>
            <div v-else class="scope-chips">
                <code v-for="s in approvedScopes" :key="s" class="scope-chip scope-chip--approved">{{ s }}</code>
            </div>
        </section>
    </div>

    <!-- Approve modal -->
    <AppModal
        :visible="approveModalOpen"
        :title="t('admin.plugins.detail.scopes.approveModalTitle')"
        :close-on-backdrop="!approving"
        :close-on-escape="!approving"
        @close="approveModalOpen = false"
    >
        <div class="modal-body">
            <p class="modal-desc">{{ t('admin.plugins.detail.scopes.approveConfirm', { name: plugin.name }) }}</p>
            <div class="approve-scope-list" role="list">
                <code v-for="s in pendingScopes" :key="s" role="listitem" class="scope-chip scope-chip--pending">{{ s }}</code>
            </div>
            <p v-if="approveError" class="error" role="alert">{{ approveError }}</p>
            <div class="modal-actions">
                <button type="button" class="btn-ghost" :disabled="approving" @click="approveModalOpen = false">
                    {{ t('common.cancel') }}
                </button>
                <button type="button" class="btn-primary" :disabled="approving" @click="confirmApproveScopes">
                    <Icon v-if="approving" icon="material-symbols:progress-activity" width="14" height="14" class="spin" />
                    {{ approving ? t('common.loading') : t('admin.plugins.detail.scopes.approveButton') }}
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
.scope-section {
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-base);
    padding: 0.75rem 0.9rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
}
.pending-section {
    border-color: color-mix(in srgb, var(--warning, #d97706) 40%, transparent);
    background: color-mix(in srgb, var(--warning, #d97706) 5%, var(--bg-surface));
}
.section-head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
}
.section-title {
    margin: 0;
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--text-strong);
    flex: 1;
}
.pending-count-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
    font-size: 0.72rem;
    font-weight: 500;
    background: color-mix(in srgb, var(--warning, #d97706) 15%, var(--bg-surface));
    color: var(--warning, #d97706);
    border: 1px solid color-mix(in srgb, var(--warning, #d97706) 35%, transparent);
    border-radius: 999px;
    padding: 0.12rem 0.45rem;
}
.scope-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
}
.scope-chip {
    font-family: var(--font-mono, monospace);
    font-size: 0.78rem;
    padding: 0.15rem 0.45rem;
    border-radius: var(--radius-sm);
    background: var(--bg-page);
    border: 1px solid var(--border);
    color: var(--text);
}
.scope-chip--approved {
    background: color-mix(in srgb, var(--success, #16a34a) 14%, var(--bg-page));
    color: var(--success, #16a34a);
    border-color: color-mix(in srgb, var(--success, #16a34a) 30%, transparent);
}
.scope-chip--pending {
    background: color-mix(in srgb, var(--warning, #d97706) 14%, var(--bg-page));
    color: var(--warning, #d97706);
    border-color: color-mix(in srgb, var(--warning, #d97706) 30%, transparent);
}
.section-actions { display: flex; justify-content: flex-end; }
.approve-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.35rem 0.75rem;
    font-size: 0.82rem;
    font-weight: 500;
    border-radius: var(--radius-sm);
    background: var(--accent);
    color: var(--text-on-accent);
    border: none;
    cursor: pointer;
}
.approve-btn:hover:not(:disabled) { filter: brightness(1.1); }
.approve-btn:disabled { opacity: 0.55; cursor: not-allowed; }
.empty-scopes {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    color: var(--text-muted);
    font-size: 0.85rem;
}
.empty-icon { opacity: 0.5; }

/* Modal */
.modal-body {
    padding: 0.9rem 1rem 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
}
.modal-desc { margin: 0; color: var(--text); font-size: 0.9rem; line-height: 1.5; }
.approve-scope-list {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
}
.error { color: var(--danger); margin: 0; font-size: 0.85rem; }
.modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    padding-top: 0.25rem;
    border-top: 1px solid var(--border);
}
.btn-ghost {
    display: inline-flex;
    align-items: center;
    padding: 0.4rem 0.85rem;
    border-radius: var(--radius-sm);
    font-size: 0.85rem;
    font-weight: 500;
    cursor: pointer;
    background: none;
    border: 1px solid var(--border);
    color: var(--text);
}
.btn-ghost:disabled { opacity: 0.55; cursor: not-allowed; }
.btn-primary {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.4rem 0.85rem;
    border-radius: var(--radius-sm);
    font-size: 0.85rem;
    font-weight: 500;
    cursor: pointer;
    background: var(--accent);
    color: var(--text-on-accent);
    border: none;
}
.btn-primary:disabled { opacity: 0.55; cursor: not-allowed; }
@keyframes spin { to { transform: rotate(360deg); } }
.spin { animation: spin 0.8s linear infinite; }
</style>
