<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import AppModal from '../../../components/AppModal.vue';
import AppButton from '../../../components/AppButton.vue';
import AppSelectField from '../../../components/AppSelectField.vue';
import { createScopeTab, type ScopeTabRow, type ScopeTabType } from '../../../api/behavior';

const { t } = useI18n();

const props = defineProps<{
    visible: boolean;
}>();

const emit = defineEmits<{
    (e: 'close'): void;
    (e: 'created', tab: ScopeTabRow): void;
}>();

type DynamicTabType = 'specific_guild' | 'specific_channel' | 'specific_user' | 'specific_group';

const tabTypeOptions: { value: DynamicTabType; label: string }[] = [
    { value: 'specific_guild', label: '' },
    { value: 'specific_channel', label: '' },
    { value: 'specific_user', label: '' },
    { value: 'specific_group', label: '' },
];

const selectedType = ref<DynamicTabType>('specific_guild');
const label = ref('');
const guildId = ref('');
const channelId = ref('');
const userId = ref('');
const groupName = ref('');
const saving = ref(false);
const error = ref<string | null>(null);

const typeLabels = computed(() => tabTypeOptions.map(o => ({
    ...o,
    label: t(`behaviors.addTab.type_${o.value}`),
})));

watch(() => props.visible, (v) => {
    if (v) {
        selectedType.value = 'specific_guild';
        label.value = '';
        guildId.value = '';
        channelId.value = '';
        userId.value = '';
        groupName.value = '';
        error.value = null;
    }
});

const canSubmit = computed(() => {
    if (saving.value) return false;
    switch (selectedType.value) {
        case 'specific_guild': return !!guildId.value.trim();
        case 'specific_channel': return !!guildId.value.trim() && !!channelId.value.trim();
        case 'specific_user': return !!userId.value.trim();
        case 'specific_group': return !!groupName.value.trim();
    }
});

async function onSubmit() {
    if (!canSubmit.value) return;
    saving.value = true;
    error.value = null;
    try {
        const tab = await createScopeTab({
            tabType: selectedType.value as ScopeTabType,
            label: label.value.trim() || undefined,
            guildId: ['specific_guild', 'specific_channel'].includes(selectedType.value)
                ? guildId.value.trim()
                : undefined,
            channelId: selectedType.value === 'specific_channel'
                ? channelId.value.trim()
                : undefined,
            userId: selectedType.value === 'specific_user'
                ? userId.value.trim()
                : undefined,
            groupName: selectedType.value === 'specific_group'
                ? groupName.value.trim()
                : undefined,
        });
        emit('created', tab);
    } catch (err) {
        error.value = err instanceof Error ? err.message : String(err);
    } finally {
        saving.value = false;
    }
}
</script>

<template>
    <AppModal :visible="visible" :title="t('behaviors.addTab.title')" @close="emit('close')">
        <form class="tab-form" @submit.prevent="onSubmit">
            <div class="field">
                <label class="field-label">{{ t('behaviors.addTab.typeLabel') }}</label>
                <AppSelectField
                    :model-value="selectedType"
                    :options="typeLabels"
                    @update:model-value="selectedType = $event as DynamicTabType"
                />
            </div>

            <div class="field">
                <label class="field-label">{{ t('behaviors.addTab.labelField') }}</label>
                <input
                    v-model="label"
                    type="text"
                    class="input"
                    :placeholder="t('behaviors.addTab.labelPlaceholder')"
                />
            </div>

            <!-- Guild ID -->
            <div v-if="selectedType === 'specific_guild' || selectedType === 'specific_channel'" class="field">
                <label class="field-label">Guild ID <span class="required">*</span></label>
                <input v-model="guildId" type="text" class="input" placeholder="e.g. 123456789012345678" />
            </div>

            <!-- Channel ID -->
            <div v-if="selectedType === 'specific_channel'" class="field">
                <label class="field-label">Channel ID <span class="required">*</span></label>
                <input v-model="channelId" type="text" class="input" placeholder="e.g. 123456789012345678" />
            </div>

            <!-- User ID -->
            <div v-if="selectedType === 'specific_user'" class="field">
                <label class="field-label">User ID <span class="required">*</span></label>
                <input v-model="userId" type="text" class="input" placeholder="e.g. 123456789012345678" />
            </div>

            <!-- Group Name -->
            <div v-if="selectedType === 'specific_group'" class="field">
                <label class="field-label">{{ t('behaviors.addTab.groupNameLabel') }} <span class="required">*</span></label>
                <input v-model="groupName" type="text" class="input" :placeholder="t('behaviors.addTab.groupNamePlaceholder')" />
            </div>

            <p v-if="error" class="error" role="alert">{{ error }}</p>

            <div class="actions">
                <AppButton variant="ghost" size="sm" @click="emit('close')">
                    {{ t('common.cancel') }}
                </AppButton>
                <AppButton variant="primary" size="sm" type="submit" :disabled="!canSubmit" :loading="saving">
                    {{ t('behaviors.addTab.submit') }}
                </AppButton>
            </div>
        </form>
    </AppModal>
</template>

<style scoped>
.tab-form {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding: 0.75rem;
}
.field {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
}
.field-label {
    font-size: 0.82rem;
    font-weight: 500;
    color: var(--text-strong);
}
.required { color: var(--danger); }
.input {
    padding: 0.45rem 0.6rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-base);
    background: var(--bg-input);
    color: var(--text);
    font-size: 0.9rem;
}
.input:focus {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 2px var(--accent-bg);
}
.error {
    color: var(--danger);
    font-size: 0.85rem;
    margin: 0;
}
.actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    padding-top: 0.25rem;
}
</style>
