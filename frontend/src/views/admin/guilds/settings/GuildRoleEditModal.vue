<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import AppModal from '../../../../components/AppModal.vue';
import {
    createGuildRole,
    editGuildRole,
    type GuildRoleSummary,
    type RoleEditPayload
} from '../../../../api/guilds';

const props = defineProps<{
    visible: boolean;
    guildId: string | null;
    /** When set, the modal opens in edit mode pre-filled with this row.
     *  When null + visible=true, the modal opens in create mode. */
    role: GuildRoleSummary | null;
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

interface PermissionDef {
    key: string;
    bit: bigint;
    /** i18n group key — used to organise the checkbox grid into
     *  general / membership / text / voice / advanced sections so the
     *  editor isn't a wall of 50 unsorted checkboxes. */
    group: 'general' | 'membership' | 'text' | 'voice' | 'stage' | 'events' | 'advanced';
}

// Complete Discord permission catalogue (as of January 2026), mirroring
// discord.js's PermissionFlagsBits. Keeping these as bigint literals so
// the bitfield arithmetic stays precise — Number can't represent the
// high bits Discord uses for newer permissions like ViewMonetization.
const PERMISSION_FLAGS: PermissionDef[] = [
    // General server permissions
    { key: 'ViewChannel', bit: 1n << 10n, group: 'general' },
    { key: 'ManageChannels', bit: 1n << 4n, group: 'general' },
    { key: 'ManageRoles', bit: 1n << 28n, group: 'general' },
    { key: 'ManageGuildExpressions', bit: 1n << 30n, group: 'general' },
    { key: 'CreateGuildExpressions', bit: 1n << 43n, group: 'general' },
    { key: 'ViewAuditLog', bit: 1n << 7n, group: 'general' },
    { key: 'ViewGuildInsights', bit: 1n << 19n, group: 'general' },
    { key: 'ManageWebhooks', bit: 1n << 29n, group: 'general' },
    { key: 'ManageGuild', bit: 1n << 5n, group: 'general' },

    // Membership
    { key: 'CreateInstantInvite', bit: 1n << 0n, group: 'membership' },
    { key: 'ChangeNickname', bit: 1n << 26n, group: 'membership' },
    { key: 'ManageNicknames', bit: 1n << 27n, group: 'membership' },
    { key: 'KickMembers', bit: 1n << 1n, group: 'membership' },
    { key: 'BanMembers', bit: 1n << 2n, group: 'membership' },
    { key: 'ModerateMembers', bit: 1n << 40n, group: 'membership' },

    // Text channel permissions
    { key: 'SendMessages', bit: 1n << 11n, group: 'text' },
    { key: 'SendMessagesInThreads', bit: 1n << 38n, group: 'text' },
    { key: 'CreatePublicThreads', bit: 1n << 35n, group: 'text' },
    { key: 'CreatePrivateThreads', bit: 1n << 36n, group: 'text' },
    { key: 'EmbedLinks', bit: 1n << 14n, group: 'text' },
    { key: 'AttachFiles', bit: 1n << 15n, group: 'text' },
    { key: 'AddReactions', bit: 1n << 6n, group: 'text' },
    { key: 'UseExternalEmojis', bit: 1n << 18n, group: 'text' },
    { key: 'UseExternalStickers', bit: 1n << 37n, group: 'text' },
    { key: 'MentionEveryone', bit: 1n << 17n, group: 'text' },
    { key: 'ManageMessages', bit: 1n << 13n, group: 'text' },
    { key: 'ManageThreads', bit: 1n << 34n, group: 'text' },
    { key: 'ReadMessageHistory', bit: 1n << 16n, group: 'text' },
    { key: 'SendTTSMessages', bit: 1n << 12n, group: 'text' },
    { key: 'UseApplicationCommands', bit: 1n << 31n, group: 'text' },
    { key: 'SendVoiceMessages', bit: 1n << 46n, group: 'text' },
    { key: 'SendPolls', bit: 1n << 49n, group: 'text' },

    // Voice channel permissions
    { key: 'Connect', bit: 1n << 20n, group: 'voice' },
    { key: 'Speak', bit: 1n << 21n, group: 'voice' },
    { key: 'Stream', bit: 1n << 9n, group: 'voice' },
    { key: 'UseEmbeddedActivities', bit: 1n << 39n, group: 'voice' },
    { key: 'UseSoundboard', bit: 1n << 42n, group: 'voice' },
    { key: 'UseExternalSounds', bit: 1n << 45n, group: 'voice' },
    { key: 'UseVAD', bit: 1n << 25n, group: 'voice' },
    { key: 'PrioritySpeaker', bit: 1n << 8n, group: 'voice' },
    { key: 'MuteMembers', bit: 1n << 22n, group: 'voice' },
    { key: 'DeafenMembers', bit: 1n << 23n, group: 'voice' },
    { key: 'MoveMembers', bit: 1n << 24n, group: 'voice' },

    // Stage
    { key: 'RequestToSpeak', bit: 1n << 32n, group: 'stage' },

    // Events
    { key: 'ManageEvents', bit: 1n << 33n, group: 'events' },
    { key: 'CreateEvents', bit: 1n << 44n, group: 'events' },

    // Advanced (handle with care)
    { key: 'Administrator', bit: 1n << 3n, group: 'advanced' },
    { key: 'ViewCreatorMonetizationAnalytics', bit: 1n << 41n, group: 'advanced' }
];
const UNIQUE_FLAGS = PERMISSION_FLAGS;

const PERMISSION_GROUPS: Array<{ key: string; flags: PermissionDef[] }> = [
    { key: 'general', flags: UNIQUE_FLAGS.filter(f => f.group === 'general') },
    { key: 'membership', flags: UNIQUE_FLAGS.filter(f => f.group === 'membership') },
    { key: 'text', flags: UNIQUE_FLAGS.filter(f => f.group === 'text') },
    { key: 'voice', flags: UNIQUE_FLAGS.filter(f => f.group === 'voice') },
    { key: 'stage', flags: UNIQUE_FLAGS.filter(f => f.group === 'stage') },
    { key: 'events', flags: UNIQUE_FLAGS.filter(f => f.group === 'events') },
    { key: 'advanced', flags: UNIQUE_FLAGS.filter(f => f.group === 'advanced') }
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
        const raw = props.role.permissions ?? '0';
        permissionFlags.value = seedFromBits(raw);
        advancedPermissions.value = raw;
    } else {
        name.value = '';
        color.value = '#5865f2';
        hoist.value = false;
        mentionable.value = false;
        permissionFlags.value = new Set();
        advancedPermissions.value = '0';
    }
}, { immediate: true });

function seedFromBits(raw: string): Set<string> {
    let bits: bigint;
    try { bits = BigInt(raw); } catch { return new Set(); }
    const set = new Set<string>();
    for (const flag of UNIQUE_FLAGS) {
        if ((bits & flag.bit) === flag.bit) set.add(flag.key);
    }
    return set;
}

function togglePermission(key: string) {
    const next = new Set(permissionFlags.value);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    permissionFlags.value = next;
    advancedPermissions.value = computeBits(next).toString();
}

function computeBits(set: Set<string>): bigint {
    let bits = 0n;
    for (const flag of UNIQUE_FLAGS) {
        if (set.has(flag.key)) bits |= flag.bit;
    }
    return bits;
}

// Echo edits to the advanced field back into the checkbox set so the
// two stay in sync. If the user pastes garbage we silently keep the
// checkboxes — better than wiping them on a typo.
watch(advancedPermissions, (raw) => {
    let bits: bigint;
    try { bits = BigInt(raw.trim() || '0'); } catch { return; }
    const expected = computeBits(permissionFlags.value);
    if (bits === expected) return;
    permissionFlags.value = seedFromBits(bits.toString());
});

const computedBits = computed<string>(() => {
    if (advancedPermissions.value.trim()) {
        try { return BigInt(advancedPermissions.value.trim()).toString(); } catch { /* fall through */ }
    }
    return computeBits(permissionFlags.value).toString();
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

const totalSelected = computed(() => permissionFlags.value.size);
</script>

<template>
    <AppModal :visible="visible" :title="titleText" width="min(620px, 95vw)" @close="close">
        <form class="body" @submit.prevent="submit">
            <div class="row-fields">
                <label class="field grow">
                    <span>{{ $t('roleMgmt.fieldName') }}</span>
                    <input v-model="name" type="text" maxlength="100" autofocus required />
                </label>
                <label class="field">
                    <span>{{ $t('roleMgmt.fieldColor') }}</span>
                    <input v-model="color" type="color" />
                </label>
            </div>
            <div class="check-row">
                <label class="check">
                    <input type="checkbox" v-model="hoist" />
                    {{ $t('roleMgmt.fieldHoist') }}
                </label>
                <label class="check">
                    <input type="checkbox" v-model="mentionable" />
                    {{ $t('roleMgmt.fieldMentionable') }}
                </label>
            </div>

            <fieldset class="permissions">
                <legend>
                    {{ $t('roleMgmt.fieldPermissions') }}
                    <span class="muted small">· {{ $t('roleMgmt.selectedCount', { count: totalSelected }) }}</span>
                </legend>

                <div v-for="g in PERMISSION_GROUPS" :key="g.key" class="perm-group">
                    <h4 class="perm-group-title">{{ $t('roleMgmt.permGroup.' + g.key) }}</h4>
                    <ul class="perm-grid">
                        <li v-for="flag in g.flags" :key="flag.key">
                            <label class="perm-label" :title="flag.key">
                                <input
                                    type="checkbox"
                                    :checked="permissionFlags.has(flag.key)"
                                    @change="togglePermission(flag.key)"
                                />
                                {{ $t('roleMgmt.perm.' + flag.key) }}
                            </label>
                        </li>
                    </ul>
                </div>

                <label class="field advanced">
                    <span>{{ $t('roleMgmt.fieldPermissionsAdvanced') }}</span>
                    <input v-model="advancedPermissions" type="text" :placeholder="$t('roleMgmt.permissionsBitfieldPlaceholder')" />
                    <small class="muted">{{ $t('roleMgmt.advancedHint') }}</small>
                </label>
            </fieldset>

            <p v-if="error" class="error">{{ error }}</p>
            <footer class="actions">
                <button type="button" class="btn-ghost" @click="close">{{ $t('common.cancel') }}</button>
                <button type="submit" class="primary" :disabled="submitting">
                    {{ props.role ? $t('roleMgmt.save') : $t('roleMgmt.create') }}
                </button>
            </footer>
        </form>
    </AppModal>
</template>

<style scoped>
.body {
    padding: 0.85rem 0.95rem;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    max-height: 80vh;
    overflow-y: auto;
}
.row-fields {
    display: flex;
    gap: 0.6rem;
    align-items: end;
}
.field { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.85rem; }
.field.grow { flex: 1; }
.field span { color: var(--text-muted); }
.field input[type="text"],
.field input[type="number"] {
    padding: 0.4rem 0.55rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg-surface);
    color: var(--text);
    font: inherit;
    font-size: 0.9rem;
}
.field input[type="color"] {
    padding: 0;
    width: 60px;
    height: 32px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg-surface);
    cursor: pointer;
}
.check-row { display: flex; gap: 1.2rem; flex-wrap: wrap; }
.check { display: flex; align-items: center; gap: 0.4rem; font-size: 0.88rem; }
.permissions {
    border: 1px solid var(--border);
    border-radius: var(--radius-base);
    padding: 0.5rem 0.7rem 0.7rem;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
}
.permissions legend {
    padding: 0 0.3rem;
    font-size: 0.8rem;
    color: var(--text-muted);
}
.perm-group { display: flex; flex-direction: column; gap: 0.3rem; }
.perm-group-title {
    margin: 0.1rem 0 0;
    font-size: 0.78rem;
    color: var(--text-strong);
    text-transform: uppercase;
    letter-spacing: 0.04em;
}
.perm-grid {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
    gap: 0.15rem 0.6rem;
}
.perm-label {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.82rem;
    cursor: pointer;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.advanced { margin-top: 0.4rem; }
.muted { color: var(--text-muted); }
.small { font-size: 0.75rem; font-weight: normal; }
.error {
    color: var(--danger);
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.35);
    border-radius: var(--radius-sm);
    padding: 0.4rem 0.55rem;
    font-size: 0.82rem;
    margin: 0;
}
.actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    padding-top: 0.4rem;
    border-top: 1px solid var(--border);
    position: sticky;
    bottom: 0;
    background: var(--bg-surface);
}
.btn-ghost,
.primary {
    padding: 0.45rem 0.9rem;
    border-radius: var(--radius-sm);
    font-size: 0.88rem;
}
.primary {
    background: var(--accent);
    color: var(--text-on-accent);
    border: 1px solid var(--accent);
    cursor: pointer;
    font: inherit;
}
.primary:disabled { opacity: 0.55; cursor: default; }
</style>
