<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import AppModal from '../../../components/AppModal.vue';
import {
    createGuildRole,
    editGuildRole,
    type GuildRoleSummary,
    type RoleEditPayload
} from '../../../api/guilds';

const props = defineProps<{
    visible: boolean;
    guildId: string | null;
    /** When set, the modal opens in edit mode pre-filled with this row.
     *  When null + visible=true, the modal opens in create mode. */
    role: GuildRoleSummary | null;
    /** Permission bitfield for the role we're editing — server returns
     *  it as a bigint string in a future endpoint. We don't have it on
     *  the read API yet, so the field starts blank in edit mode and the
     *  user can paste a known value. */
    rolePermissions?: string | null;
}>();

const emit = defineEmits<{
    (e: 'close'): void;
    (e: 'saved'): void;
}>();

const { t: $t } = useI18n();

const name = ref('');
const color = ref('#5865f2');
const hoist = ref(false);
const mentionable = ref(false);
const permissionFlags = ref<Set<string>>(new Set());
const submitting = ref(false);
const error = ref<string | null>(null);

// Common moderation/messaging permissions surfaced as checkboxes — each
// is the discord.js bigint string for that flag. Full Discord has 50+
// permissions; the subset here covers what guild admins typically tune
// from a non-Discord client. Power users can still paste a raw bitfield
// via the "advanced" textarea below.
const PERMISSION_FLAGS: Array<{ key: string; bit: bigint }> = [
    { key: 'Administrator', bit: 0x8n },
    { key: 'ManageGuild', bit: 0x20n },
    { key: 'ManageRoles', bit: 0x10000000n },
    { key: 'ManageChannels', bit: 0x10n },
    { key: 'ManageMessages', bit: 0x2000n },
    { key: 'KickMembers', bit: 0x2n },
    { key: 'BanMembers', bit: 0x4n },
    { key: 'ModerateMembers', bit: 0x10000000000n },
    { key: 'ManageNicknames', bit: 0x8000000n },
    { key: 'MentionEveryone', bit: 0x20000n },
    { key: 'ViewChannel', bit: 0x400n },
    { key: 'SendMessages', bit: 0x800n },
    { key: 'ReadMessageHistory', bit: 0x10000n },
    { key: 'AddReactions', bit: 0x40n },
    { key: 'Connect', bit: 0x100000n },
    { key: 'Speak', bit: 0x200000n }
];
const advancedPermissions = ref('');

watch(() => props.visible, (v) => {
    if (!v) return;
    error.value = null;
    submitting.value = false;
    if (props.role) {
        name.value = props.role.name;
        color.value = props.role.color ?? '#5865f2';
        hoist.value = !!props.role.hoist;
        mentionable.value = props.role.mentionable;
        permissionFlags.value = new Set();
        if (props.rolePermissions) seedPermissionsFromBits(props.rolePermissions);
        advancedPermissions.value = props.rolePermissions ?? '';
    } else {
        name.value = '';
        color.value = '#5865f2';
        hoist.value = false;
        mentionable.value = false;
        permissionFlags.value = new Set();
        advancedPermissions.value = '';
    }
}, { immediate: true });

function seedPermissionsFromBits(raw: string) {
    let bits: bigint;
    try { bits = BigInt(raw); } catch { return; }
    for (const flag of PERMISSION_FLAGS) {
        if ((bits & flag.bit) === flag.bit) permissionFlags.value.add(flag.key);
    }
}

function togglePermission(key: string) {
    const next = new Set(permissionFlags.value);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    permissionFlags.value = next;
}

const computedBits = computed<string>(() => {
    // The advanced field wins when set — lets a power user override
    // every checkbox by pasting in a known bitfield.
    if (advancedPermissions.value.trim()) return advancedPermissions.value.trim();
    let bits = 0n;
    for (const flag of PERMISSION_FLAGS) {
        if (permissionFlags.value.has(flag.key)) bits |= flag.bit;
    }
    return bits.toString();
});

function close() { emit('close'); }

async function submit() {
    if (!props.guildId || submitting.value) return;
    if (!name.value.trim()) {
        error.value = $t('roleMgmt.fieldName');
        return;
    }
    submitting.value = true;
    error.value = null;
    const payload: RoleEditPayload = {
        name: name.value.trim(),
        color: color.value,
        hoist: hoist.value,
        mentionable: mentionable.value,
        permissions: computedBits.value
    };
    try {
        if (props.role) {
            await editGuildRole(props.guildId, props.role.id, payload);
        } else {
            await createGuildRole(props.guildId, payload);
        }
        emit('saved');
        close();
    } catch (err) {
        error.value = err instanceof Error ? err.message : 'Operation failed';
    } finally {
        submitting.value = false;
    }
}

const titleText = computed(() =>
    props.role ? $t('roleMgmt.editTitle', { name: props.role.name }) : $t('roleMgmt.createTitle')
);
</script>

<template>
    <AppModal :visible="visible" :title="titleText" width="min(480px, 92vw)" @close="close">
        <form class="body" @submit.prevent="submit">
            <label class="field">
                <span>{{ $t('roleMgmt.fieldName') }}</span>
                <input v-model="name" type="text" maxlength="100" autofocus required />
            </label>
            <label class="field">
                <span>{{ $t('roleMgmt.fieldColor') }}</span>
                <input v-model="color" type="color" />
            </label>
            <label class="check">
                <input type="checkbox" v-model="hoist" />
                {{ $t('roleMgmt.fieldHoist') }}
            </label>
            <label class="check">
                <input type="checkbox" v-model="mentionable" />
                {{ $t('roleMgmt.fieldMentionable') }}
            </label>
            <fieldset class="permissions">
                <legend>{{ $t('roleMgmt.fieldPermissions') }}</legend>
                <ul class="perm-grid">
                    <li v-for="flag in PERMISSION_FLAGS" :key="flag.key">
                        <label>
                            <input
                                type="checkbox"
                                :checked="permissionFlags.has(flag.key)"
                                @change="togglePermission(flag.key)"
                            />
                            {{ flag.key }}
                        </label>
                    </li>
                </ul>
                <label class="field">
                    <span>{{ $t('roleMgmt.fieldPermissionsAdvanced') }}</span>
                    <input v-model="advancedPermissions" type="text" :placeholder="$t('roleMgmt.permissionsBitfieldPlaceholder')" />
                </label>
            </fieldset>
            <p v-if="error" class="error">{{ error }}</p>
            <footer class="actions">
                <button type="button" class="ghost" @click="close">{{ $t('common.cancel') }}</button>
                <button type="submit" class="primary" :disabled="submitting">
                    {{ props.role ? $t('roleMgmt.save') : $t('roleMgmt.create') }}
                </button>
            </footer>
        </form>
    </AppModal>
</template>

<style scoped>
.body {
    padding: 0.8rem 0.9rem;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
}
.field { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.85rem; }
.field span { color: var(--text-muted); }
.field input[type="text"],
.field input[type="number"] {
    padding: 0.4rem 0.55rem;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg);
    color: var(--text);
    font: inherit;
    font-size: 0.9rem;
}
.field input[type="color"] {
    padding: 0;
    width: 60px;
    height: 32px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg);
    cursor: pointer;
}
.check { display: flex; align-items: center; gap: 0.4rem; font-size: 0.88rem; }
.permissions {
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 0.4rem 0.7rem 0.6rem;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
}
.permissions legend { padding: 0 0.3rem; font-size: 0.78rem; color: var(--text-muted); }
.perm-grid {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 0.2rem 0.6rem;
}
.perm-grid label { display: flex; align-items: center; gap: 0.35rem; font-size: 0.82rem; cursor: pointer; }
.error { color: var(--danger); font-size: 0.85rem; }
.actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
}
.ghost,
.primary {
    padding: 0.45rem 0.9rem;
    border-radius: 4px;
    font: inherit;
    font-size: 0.88rem;
    cursor: pointer;
}
.ghost {
    background: none;
    border: 1px solid var(--border);
    color: var(--text);
}
.ghost:hover { background: var(--bg-surface-hover); }
.primary {
    background: var(--accent);
    color: var(--text-on-accent);
    border: 1px solid var(--accent);
}
.primary:disabled { opacity: 0.55; cursor: default; }
</style>
