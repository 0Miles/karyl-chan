<script setup lang="ts">
import { ref } from 'vue';
import { addCapabilityGrant, removeCapabilityGrant, type GuildDetail } from '../../../../api/guilds';
import AppSelectField from '../../../../components/AppSelectField.vue';
import { useBotFeatureCard } from './use-bot-feature-card';
import { useRolePicker } from './use-feature-pickers';

const props = defineProps<{ detail: GuildDetail }>();
const emit = defineEmits<{ (e: 'changed'): void }>();

const { detailLocal, error, action } = useBotFeatureCard(props.detail, () => emit('changed'));
const { rolePickerOptions } = useRolePicker(detailLocal.value.guild.id);

const capabilityName = ref<string>('');
const capabilityRoleId = ref<string>('');

async function addCap() {
    if (!capabilityName.value.trim() || !capabilityRoleId.value) return;
    if (await action('add-cap', () => addCapabilityGrant(detailLocal.value.guild.id, capabilityName.value.trim(), capabilityRoleId.value)) !== undefined) {
        capabilityName.value = '';
        capabilityRoleId.value = '';
    }
}
async function rmCap(capability: string, roleId: string) {
    await action('rm-cap', () => removeCapabilityGrant(detailLocal.value.guild.id, capability, roleId));
}
</script>

<template>
    <section class="card">
        <p v-if="error" class="error">{{ error }}</p>
        <header class="card-head">
            <h3>{{ $t('guilds.feature.capabilityTitle') }}
                <span class="count-pill">{{ detailLocal.capabilityGrants.length }}</span>
            </h3>
        </header>
        <p class="hint">{{ $t('guilds.feature.capabilityHint') }}</p>
        <ul v-if="detailLocal.capabilityGrants.length" class="bare">
            <li v-for="(g, idx) in detailLocal.capabilityGrants" :key="idx" class="row">
                <div class="row-meta">
                    <span class="capability">{{ g.capability }}</span>
                    <span class="muted">·</span>
                    <span :style="g.roleColor ? { color: g.roleColor } : undefined">@{{ g.roleName ?? g.roleId }}</span>
                </div>
                <button type="button" class="ghost danger small" @click="rmCap(g.capability, g.roleId)">{{ $t('guilds.feature.removeBtn') }}</button>
            </li>
        </ul>
        <p v-else class="muted">{{ $t('guilds.feature.noEntries') }}</p>
        <div class="form-grid">
            <input v-model="capabilityName" type="text" list="cap-suggest" :placeholder="$t('guilds.feature.capabilityPlaceholder')" />
            <datalist id="cap-suggest">
                <option value="todo.manage" />
                <option value="picture-only.manage" />
                <option value="rcon.configure" />
                <option value="role-emoji.manage" />
            </datalist>
            <AppSelectField
                v-model="capabilityRoleId"
                :options="rolePickerOptions"
                :placeholder="$t('guilds.feature.rolePlaceholder')"
                :drawer-title="$t('guilds.feature.pickRole')"
            />
            <button type="button" class="primary span-2" :disabled="!capabilityName.trim() || !capabilityRoleId" @click="addCap">{{ $t('guilds.feature.addBtn') }}</button>
        </div>
    </section>
</template>

<style scoped src="./card.css"></style>
