<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import AppModal from '../../components/AppModal.vue';
import AppSelectField, { type SelectOption } from '../../components/AppSelectField.vue';
import {
    addGuildMemberRole,
    banGuildMember,
    listGuildRoles,
    removeGuildMemberRole,
    setGuildMemberNickname,
    timeoutGuildMember,
    type GuildRoleSummary
} from '../../api/guilds';
import { useMemberMgmtStore } from './stores/memberMgmtStore';
import { useUserProfileStore } from './stores/userProfileStore';

const { t: $t } = useI18n();
const store = useMemberMgmtStore();
const profile = useUserProfileStore();

const target = computed(() => store.target);
const visible = computed(() => target.value !== null);

const reason = ref('');
const banDeleteSeconds = ref(0);
const timeoutPreset = ref(60); // seconds
const nickname = ref('');
const memberRoleIds = ref<Set<string>>(new Set());
const guildRoles = ref<GuildRoleSummary[]>([]);
const loadingRoles = ref(false);
const submitting = ref(false);
const error = ref<string | null>(null);

const TIMEOUT_PRESETS: Array<{ seconds: number; key: string }> = [
    { seconds: 60, key: 'memberMgmt.timeout60s' },
    { seconds: 5 * 60, key: 'memberMgmt.timeout5m' },
    { seconds: 10 * 60, key: 'memberMgmt.timeout10m' },
    { seconds: 60 * 60, key: 'memberMgmt.timeout1h' },
    { seconds: 24 * 60 * 60, key: 'memberMgmt.timeout1d' },
    { seconds: 7 * 24 * 60 * 60, key: 'memberMgmt.timeout1w' }
];
const BAN_DELETE_PRESETS: Array<{ seconds: number; key: string }> = [
    { seconds: 0, key: 'memberMgmt.banDeleteNone' },
    { seconds: 60 * 60, key: 'memberMgmt.banDeleteHour' },
    { seconds: 6 * 60 * 60, key: 'memberMgmt.banDeleteSixHours' },
    { seconds: 24 * 60 * 60, key: 'memberMgmt.banDeleteDay' },
    { seconds: 3 * 24 * 60 * 60, key: 'memberMgmt.banDeleteThreeDays' },
    { seconds: 7 * 24 * 60 * 60, key: 'memberMgmt.banDeleteWeek' }
];

const banDeleteOptions = computed<SelectOption<number>[]>(() =>
    BAN_DELETE_PRESETS.map(o => ({ value: o.seconds, label: $t(o.key) }))
);
const timeoutOptions = computed<SelectOption<number>[]>(() =>
    TIMEOUT_PRESETS.map(o => ({ value: o.seconds, label: $t(o.key) }))
);

// Each open() call resets form state — and for the roles editor we also
// kick off the role-list fetch + member-snapshot fetch so the checkboxes
// land hydrated.
watch(target, async (t) => {
    error.value = null;
    submitting.value = false;
    if (!t) return;
    reason.value = '';
    banDeleteSeconds.value = 0;
    timeoutPreset.value = 60;
    nickname.value = t.currentNickname ?? '';
    if (t.mode === 'roles') {
        memberRoleIds.value = new Set();
        guildRoles.value = [];
        loadingRoles.value = true;
        try {
            const [roles, member] = await Promise.all([
                listGuildRoles(t.guildId),
                profile.fetchUser(t.userId, t.guildId)
            ]);
            if (store.target?.userId !== t.userId) return;
            guildRoles.value = roles;
            memberRoleIds.value = new Set(member.member?.roles.map(r => r.id) ?? []);
        } catch (err) {
            error.value = err instanceof Error ? err.message : 'Failed to load roles';
        } finally {
            if (store.target?.userId === t.userId) loadingRoles.value = false;
        }
    }
}, { immediate: true });

function close() { store.close(); }

async function submit() {
    const t = target.value;
    if (!t || submitting.value) return;
    submitting.value = true;
    error.value = null;
    try {
        if (t.mode === 'ban') {
            await banGuildMember(t.guildId, t.userId, {
                reason: reason.value || undefined,
                deleteMessageSeconds: banDeleteSeconds.value
            });
        } else if (t.mode === 'timeout') {
            const until = new Date(Date.now() + timeoutPreset.value * 1000).toISOString();
            await timeoutGuildMember(t.guildId, t.userId, until, reason.value || undefined);
        } else if (t.mode === 'nickname') {
            const value = nickname.value.trim();
            await setGuildMemberNickname(t.guildId, t.userId, value === '' ? null : value, reason.value || undefined);
        } else if (t.mode === 'roles') {
            // Diff against the snapshot taken at open time; only the
            // changed rows hit the API. Each toggle is a single REST
            // call — Discord doesn't expose a bulk role replace.
            const original = new Set(memberRoleIds.value);
            const desired = new Set(memberRoleIds.value); // memberRoleIds is mutated below; copy first
            void desired; // unused but kept for clarity vs the toggle local state
            const toAdd: string[] = [];
            const toRemove: string[] = [];
            for (const id of pendingRoleIds.value) if (!original.has(id)) toAdd.push(id);
            for (const id of original) if (!pendingRoleIds.value.has(id)) toRemove.push(id);
            await Promise.all([
                ...toAdd.map(rid => addGuildMemberRole(t.guildId, t.userId, rid)),
                ...toRemove.map(rid => removeGuildMemberRole(t.guildId, t.userId, rid))
            ]);
        }
        close();
    } catch (err) {
        error.value = err instanceof Error ? err.message : 'Operation failed';
    } finally {
        submitting.value = false;
    }
}

// `pendingRoleIds` is the user-editable selection (the source of truth
// while the modal is open). `memberRoleIds` is the snapshot taken at
// open — kept around so submit() can compute the add/remove diff.
const pendingRoleIds = ref<Set<string>>(new Set());
watch(memberRoleIds, (set) => {
    pendingRoleIds.value = new Set(set);
});
function toggleRole(id: string) {
    const next = new Set(pendingRoleIds.value);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    pendingRoleIds.value = next;
}

const titleText = computed(() => {
    const t = target.value;
    if (!t) return '';
    switch (t.mode) {
        case 'ban': return $t('memberMgmt.banTitle', { name: t.displayName });
        case 'timeout': return $t('memberMgmt.timeoutTitle', { name: t.displayName });
        case 'nickname': return $t('memberMgmt.nicknameTitle', { name: t.displayName });
        case 'roles': return $t('memberMgmt.rolesTitle', { name: t.displayName });
    }
});
</script>

<template>
    <AppModal :visible="visible" :title="titleText" width="min(420px, 92vw)" @close="close">
        <form class="body" @submit.prevent="submit">
            <template v-if="target?.mode === 'ban'">
                        <label class="field">
                            <span>{{ $t('memberMgmt.banDeleteLabel') }}</span>
                            <AppSelectField
                                v-model="banDeleteSeconds"
                                :options="banDeleteOptions"
                                :drawer-title="$t('memberMgmt.banDeleteLabel')"
                            />
                        </label>
                        <label class="field">
                            <span>{{ $t('memberMgmt.reasonLabel') }}</span>
                            <input v-model="reason" type="text" :placeholder="$t('memberMgmt.reasonPlaceholder')" maxlength="512" />
                        </label>
                    </template>
                    <template v-else-if="target?.mode === 'timeout'">
                        <label class="field">
                            <span>{{ $t('memberMgmt.timeoutDuration') }}</span>
                            <AppSelectField
                                v-model="timeoutPreset"
                                :options="timeoutOptions"
                                :drawer-title="$t('memberMgmt.timeoutDuration')"
                            />
                        </label>
                        <label class="field">
                            <span>{{ $t('memberMgmt.reasonLabel') }}</span>
                            <input v-model="reason" type="text" :placeholder="$t('memberMgmt.reasonPlaceholder')" maxlength="512" />
                        </label>
                    </template>
                    <template v-else-if="target?.mode === 'nickname'">
                        <label class="field">
                            <input v-model="nickname" type="text" :placeholder="$t('memberMgmt.nicknamePlaceholder')" maxlength="32" autofocus />
                        </label>
                        <label class="field">
                            <span>{{ $t('memberMgmt.reasonLabel') }}</span>
                            <input v-model="reason" type="text" :placeholder="$t('memberMgmt.reasonPlaceholder')" maxlength="512" />
                        </label>
                    </template>
                    <template v-else-if="target?.mode === 'roles'">
                        <p v-if="loadingRoles" class="muted">{{ $t('common.loading') }}</p>
                        <p v-else-if="guildRoles.length === 0" class="muted">{{ $t('memberMgmt.rolesEmpty') }}</p>
                        <ul v-else class="roles">
                            <li v-for="role in guildRoles" :key="role.id">
                                <label>
                                    <input
                                        type="checkbox"
                                        :checked="pendingRoleIds.has(role.id)"
                                        @change="toggleRole(role.id)"
                                    />
                                    <span class="role-dot" :style="role.color ? { backgroundColor: role.color } : undefined"></span>
                                    <span class="role-name">{{ role.name }}</span>
                                </label>
                            </li>
                        </ul>
                    </template>
            <p v-if="error" class="error">{{ error }}</p>
            <footer class="actions">
                <button type="button" class="btn-ghost" @click="close">{{ $t('common.cancel') }}</button>
                <button
                    type="submit"
                    class="primary"
                    :class="{ danger: target?.mode === 'ban' }"
                    :disabled="submitting"
                >
                    <template v-if="target?.mode === 'ban'">{{ $t('memberMgmt.banAction') }}</template>
                    <template v-else>{{ $t('memberMgmt.save') }}</template>
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
.field input,
.field select {
    padding: 0.4rem 0.55rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg-surface);
    color: var(--text);
    font: inherit;
    font-size: 0.9rem;
}
.roles {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    max-height: 320px;
    overflow-y: auto;
}
.roles label {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.3rem 0.4rem;
    border-radius: var(--radius-sm);
    cursor: pointer;
}
.roles label:hover { background: var(--bg-surface-hover); }
.role-dot {
    display: inline-block;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--text-muted);
    flex-shrink: 0;
}
.role-name { font-size: 0.88rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.error { color: var(--danger); font-size: 0.85rem; }
.actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    margin-top: 0.4rem;
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
    font-family: inherit;
    line-height: inherit;
    cursor: pointer;
}
.primary:disabled { opacity: 0.55; cursor: default; }
.primary.danger {
    background: var(--danger);
    border-color: var(--danger);
}
.muted { color: var(--text-muted); font-size: 0.88rem; }
</style>
