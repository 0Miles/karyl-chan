<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import AppModal from '../../../components/AppModal.vue';
import { listPlugins, type PluginRecord } from '../../../api/plugins';

const props = defineProps<{
    visible: boolean;
}>();

const emit = defineEmits<{
    (e: 'close'): void;
    (e: 'submit', payload: { pluginId: number; pluginBehaviorKey: string; title: string }): void;
}>();

const { t } = useI18n();

const plugins = ref<PluginRecord[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);
const selectedPluginId = ref<number | null>(null);
const selectedBehaviorKey = ref<string>('');

// Only plugins that are enabled AND active actually accept dispatch.
// Inactive ones could be present but we hide them from the picker so
// the user doesn't immediately create something that doesn't fire.
const eligiblePlugins = computed(() =>
    plugins.value.filter(p => p.enabled && p.status === 'active' && (p.manifest?.dm_behaviors?.length ?? 0) > 0)
);

const selectedPlugin = computed(() =>
    eligiblePlugins.value.find(p => p.id === selectedPluginId.value) ?? null
);

const dmBehaviorsForSelected = computed(() => selectedPlugin.value?.manifest?.dm_behaviors ?? []);

const selectedBehavior = computed(() =>
    dmBehaviorsForSelected.value.find(b => b.key === selectedBehaviorKey.value) ?? null
);

const canSubmit = computed(() =>
    selectedPluginId.value != null && selectedBehaviorKey.value.length > 0
);

async function load() {
    loading.value = true;
    error.value = null;
    try {
        plugins.value = await listPlugins();
    } catch (err) {
        error.value = err instanceof Error ? err.message : String(err);
    } finally {
        loading.value = false;
    }
}

watch(() => props.visible, (v) => {
    if (v) {
        selectedPluginId.value = null;
        selectedBehaviorKey.value = '';
        void load();
    }
});

watch(selectedPluginId, () => {
    // Auto-pick the first behavior so the form lands ready to submit
    // for plugins that only expose a single dm_behavior (the common case).
    const first = dmBehaviorsForSelected.value[0];
    selectedBehaviorKey.value = first?.key ?? '';
});

function onSubmit() {
    if (!canSubmit.value || !selectedPlugin.value || !selectedBehavior.value) return;
    const title = t('behaviors.addPlugin.defaultTitle', {
        plugin: selectedPlugin.value.name,
        behavior: selectedBehavior.value.name,
    });
    emit('submit', {
        pluginId: selectedPluginId.value!,
        pluginBehaviorKey: selectedBehaviorKey.value,
        title,
    });
}
</script>

<template>
    <AppModal :visible="visible" :title="t('behaviors.addPlugin.title')" @close="emit('close')">
        <div class="body">
            <p v-if="loading" class="muted">{{ t('common.loading') }}</p>
            <p v-else-if="error" class="error">{{ error }}</p>
            <p v-else-if="eligiblePlugins.length === 0" class="muted empty">
                {{ t('behaviors.addPlugin.noEligible') }}
            </p>
            <template v-else>
                <label class="field">
                    <span class="label">{{ t('behaviors.addPlugin.pickPlugin') }}</span>
                    <select v-model.number="selectedPluginId">
                        <option :value="null" disabled>{{ t('behaviors.addPlugin.pickPluginPlaceholder') }}</option>
                        <option v-for="p in eligiblePlugins" :key="p.id" :value="p.id">
                            {{ p.name }} (v{{ p.version }})
                        </option>
                    </select>
                </label>
                <label v-if="selectedPlugin" class="field">
                    <span class="label">{{ t('behaviors.addPlugin.pickBehavior') }}</span>
                    <select v-model="selectedBehaviorKey">
                        <option v-for="b in dmBehaviorsForSelected" :key="b.key" :value="b.key">
                            {{ b.name }}<template v-if="b.description"> — {{ b.description }}</template>
                        </option>
                    </select>
                </label>
            </template>
        </div>
        <template #footer>
            <button type="button" class="ghost" @click="emit('close')">{{ t('common.cancel') }}</button>
            <button type="button" class="primary" :disabled="!canSubmit" @click="onSubmit">
                {{ t('behaviors.addPlugin.create') }}
            </button>
        </template>
    </AppModal>
</template>

<style scoped>
.body {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    min-width: 18rem;
}
.field {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
}
.label {
    font-size: 0.78rem;
    color: var(--text-muted);
    font-weight: 600;
}
.field select {
    padding: 0.45rem 0.6rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg-surface);
    color: var(--text);
    font: inherit;
}
.muted { color: var(--text-muted); margin: 0; }
.muted.empty { padding: 1rem 0; text-align: center; }
.error { color: var(--danger); margin: 0; font-size: 0.9rem; }
.ghost {
    background: none;
    border: 1px solid var(--border);
    color: var(--text);
    padding: 0.45rem 0.85rem;
    border-radius: var(--radius-sm);
    cursor: pointer;
}
.primary {
    background: var(--accent);
    color: var(--text-on-accent);
    border: 1px solid var(--accent);
    padding: 0.45rem 0.85rem;
    border-radius: var(--radius-sm);
    cursor: pointer;
}
.primary:disabled { opacity: 0.55; cursor: not-allowed; }
</style>
