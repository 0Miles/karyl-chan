<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { useUserContextMenuStore, type UserContextMenuTarget } from './stores/userContextMenuStore';
import { useUserProfileStore } from './stores/userProfileStore';
import { useMemberMgmtStore } from './stores/memberMgmtStore';
import MessageContextMenu, { type ContextMenuAction } from '../../libs/messages/MessageContextMenu.vue';
import { startChannel as startDmChannel } from '../../api/dm';
import {
    kickGuildMember,
    moveGuildVoiceMember,
    setGuildVoiceMemberDeafen,
    setGuildVoiceMemberMute,
    type GuildTextChannel
} from '../../api/guilds';
import { useI18n } from 'vue-i18n';

const { t: $t } = useI18n();

const props = defineProps<{
    /** Voice channels in the current guild — used to populate the
     *  "move to" submenu. Empty for non-voice menus. */
    voiceChannels?: GuildTextChannel[];
}>();

const router = useRouter();
const menu = useUserContextMenuStore();
const profile = useUserProfileStore();
const mgmt = useMemberMgmtStore();

const target = computed<UserContextMenuTarget | null>(() => menu.target);
const visible = computed(() => target.value !== null);

const actions = computed<ContextMenuAction[]>(() => {
    const t = target.value;
    if (!t) return [];
    const items: ContextMenuAction[] = [
        { key: 'profile', label: $t('userMenu.profile'), icon: 'material-symbols:account-circle-outline-rounded' },
        { key: 'send-dm', label: $t('userMenu.sendDm'), icon: 'material-symbols:mail-outline-rounded' },
        { key: 'copy-mention', label: $t('userMenu.copyMention'), icon: 'material-symbols:alternate-email-rounded' },
        { key: 'copy-id', label: $t('userMenu.copyId'), icon: 'material-symbols:fingerprint-rounded' }
    ];
    if (t.voice) {
        items.push({ key: 'voice-mute', label: $t(t.voice.serverMuted ? 'userMenu.unmute' : 'userMenu.mute'), icon: 'material-symbols:mic-off-outline-rounded' });
        items.push({ key: 'voice-deafen', label: $t(t.voice.serverDeafened ? 'userMenu.undeafen' : 'userMenu.deafen'), icon: 'material-symbols:headset-off-outline-rounded' });
        items.push({ key: 'voice-disconnect', label: $t('userMenu.disconnect'), icon: 'material-symbols:call-end-outline-rounded', danger: true });
        for (const ch of (props.voiceChannels ?? [])) {
            if (ch.id === t.voice.channelId) continue;
            items.push({ key: `voice-move:${ch.id}`, label: $t('userMenu.moveTo', { name: ch.name }), icon: 'material-symbols:swap-horiz-rounded' });
        }
    }
    // Moderation actions only make sense in a guild context. The bot may
    // still lack the underlying Discord permissions — those errors surface
    // from the API call when the user actually triggers an action.
    if (t.guildId) {
        items.push({ key: 'mgmt-nickname', label: $t('userMenu.nickname'), icon: 'material-symbols:edit-rounded' });
        items.push({ key: 'mgmt-roles', label: $t('userMenu.manageRoles'), icon: 'material-symbols:badge-outline-rounded' });
        items.push({ key: 'mgmt-timeout', label: $t('userMenu.timeout'), icon: 'material-symbols:timer-outline-rounded' });
        items.push({ key: 'mgmt-kick', label: $t('userMenu.kick'), icon: 'material-symbols:person-remove-outline-rounded', danger: true });
        items.push({ key: 'mgmt-ban', label: $t('userMenu.ban'), icon: 'material-symbols:gavel-rounded', danger: true });
    }
    return items;
});

async function copyToClipboard(text: string) {
    try { await navigator.clipboard.writeText(text); } catch { /* ignore */ }
}

async function pick(key: string) {
    const t = target.value;
    if (!t) return;
    if (key === 'profile') {
        profile.openFor(t.userId, t.anchor, t.guildId);
        return;
    }
    if (key === 'send-dm') {
        try {
            const channel = await startDmChannel(t.userId);
            await router.push({ name: 'messages', query: { channel: channel.id } });
        } catch { /* ignore */ }
        return;
    }
    if (key === 'copy-mention') { void copyToClipboard(`<@${t.userId}>`); return; }
    if (key === 'copy-id') { void copyToClipboard(t.userId); return; }
    if (!t.voice || !t.guildId) return;
    if (key === 'voice-mute') {
        try { await setGuildVoiceMemberMute(t.guildId, t.userId, !t.voice.serverMuted); } catch { /* ignore */ }
        return;
    }
    if (key === 'voice-deafen') {
        try { await setGuildVoiceMemberDeafen(t.guildId, t.userId, !t.voice.serverDeafened); } catch { /* ignore */ }
        return;
    }
    if (key === 'voice-disconnect') {
        try { await moveGuildVoiceMember(t.guildId, t.userId, null); } catch { /* ignore */ }
        return;
    }
    if (key.startsWith('voice-move:')) {
        const channelId = key.slice('voice-move:'.length);
        try { await moveGuildVoiceMember(t.guildId, t.userId, channelId); } catch { /* ignore */ }
        return;
    }
    if (key === 'mgmt-kick') {
        // Kick uses a native confirm() rather than a modal — no extra
        // fields needed (reason is optional and lives in the audit log).
        if (confirm(`Kick ${t.displayName ?? t.userId}?`)) {
            try { await kickGuildMember(t.guildId, t.userId); } catch { /* ignore */ }
        }
        return;
    }
    if (key === 'mgmt-ban') {
        mgmt.open({ mode: 'ban', guildId: t.guildId, userId: t.userId, displayName: t.displayName ?? t.userId });
        return;
    }
    if (key === 'mgmt-timeout') {
        // Always opens the duration picker — a future polish could detect
        // an active timeout from the cached profile and offer a distinct
        // "Remove timeout" entry, but the MVP flow is open → pick → save.
        mgmt.open({ mode: 'timeout', guildId: t.guildId, userId: t.userId, displayName: t.displayName ?? t.userId });
        return;
    }
    if (key === 'mgmt-nickname') {
        // The current nickname snapshot is in the cached profile; if not
        // yet fetched, the modal opens with an empty input which still
        // works (server treats empty as "clear").
        const cached = profile.readCached(t.userId, t.guildId);
        mgmt.open({
            mode: 'nickname',
            guildId: t.guildId,
            userId: t.userId,
            displayName: t.displayName ?? t.userId,
            currentNickname: cached?.member?.nickname ?? null
        });
        return;
    }
    if (key === 'mgmt-roles') {
        mgmt.open({ mode: 'roles', guildId: t.guildId, userId: t.userId, displayName: t.displayName ?? t.userId });
        return;
    }
}
</script>

<template>
    <MessageContextMenu
        :visible="visible"
        :x="target?.x ?? 0"
        :y="target?.y ?? 0"
        :actions="actions"
        @pick="pick"
        @close="menu.close()"
    />
</template>
