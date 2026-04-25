<script setup lang="ts">
import { computed, ref, toRef, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import GuildChannelSidebar from './GuildChannelSidebar.vue';
import GuildForumPanel from './GuildForumPanel.vue';
import GuildForwardPicker from './GuildForwardPicker.vue';
import GuildBulkDeleteModal from './GuildBulkDeleteModal.vue';
import GuildChannelMgmtModal from './GuildChannelMgmtModal.vue';
import UserContextMenu from '../../../modules/discord-chat/UserContextMenu.vue';
import GuildMemberMgmtModal from '../../../modules/discord-chat/GuildMemberMgmtModal.vue';
import { DiscordConversation, useDiscordGuildChannel } from '../../../modules/discord-chat';
import {
    bulkDeleteGuildMessages,
    deleteGuildMessage,
    forwardGuildMessage,
    getGuildPins,
    pinGuildMessage,
    unpinGuildMessage,
    type GuildSummary
} from '../../../api/guilds';
import type { Message } from '../../../libs/messages/types';
import { useAppShell } from '../../../composables/use-app-shell';
import { SidebarLayout } from '../../../layouts';
import AccessDeniedView from '../../../components/AccessDeniedView.vue';

const props = defineProps<{
    guilds: GuildSummary[];
    mode: string;
    guildId: string;
    isMobile?: boolean;
}>();

const emit = defineEmits<{
    (e: 'mode-change', mode: string): void;
}>();

const router = useRouter();
const route = useRoute();
const guildIdRef = toRef(props, 'guildId');
const { closeOverlay } = useAppShell();

function clearScrollToQuery() {
    if (typeof route.query.scrollTo !== 'string' || !route.query.scrollTo) return;
    const next = { ...route.query };
    delete next.scrollTo;
    router.replace({ query: next });
}

const conversationRef = ref<InstanceType<typeof DiscordConversation> | null>(null);
const accessDenied = ref(false);

const {
    categories,
    channels,
    selectedChannelId,
    selectedChannel,
    loadingChannels,
    channelsError,
    botUserId,
    chat,
    send,
    reactWithSelection,
    selectChannel,
    requestScroll,
    registerAuxSelectableIds
} = useDiscordGuildChannel(guildIdRef, {
    onAuthError: () => router.replace({ name: 'auth' }),
    onForbidden: () => { accessDenied.value = true; },
    onScrollFinished: () => clearScrollToQuery(),
    attemptScroll: (id) => conversationRef.value?.scrollToMessage(id) ?? false
});

function handleSelect(id: string) {
    selectChannel(id);
    if (props.isMobile) closeOverlay();
}

const pinFetcher = (channelId: string) => getGuildPins(props.guildId, channelId);

function onJumpToMessage(messageId: string) {
    if (!selectedChannelId.value) return;
    router.replace({ query: { ...route.query, channel: selectedChannelId.value, scrollTo: messageId } });
    requestScroll(messageId);
}

// URL → machine. `?channel=` seeds the selection, `?scrollTo=` seeds
// the scroll target. The workspace machine owns the ordering so we
// can dispatch these events in any order without tripping over each
// other.
function applyChannelQuery(value: unknown) {
    if (typeof value !== 'string' || value.length === 0) return;
    selectChannel(value);
}
function applyScrollQuery(value: unknown) {
    if (typeof value !== 'string' || value.length === 0) return;
    requestScroll(value);
}
applyChannelQuery(route.query.channel);
applyScrollQuery(route.query.scrollTo);
watch(() => route.query.channel, applyChannelQuery);
watch(() => route.query.scrollTo, applyScrollQuery);

// Machine → URL. Mirror the committed selection back into `?channel=`
// once it lands in the live channel list.
watch(selectedChannelId, (id) => {
    if (!id) return;
    if (!channels.value.some(c => c.id === id)) return;
    if (route.query.channel === id) return;
    router.replace({ query: { ...route.query, channel: id } });
}, { immediate: true });

const selectedGuild = ref(props.guilds.find(g => g.id === props.guildId) ?? null);
watch(() => props.guildId, id => {
    selectedGuild.value = props.guilds.find(g => g.id === id) ?? null;
});

// Channel kind drives the main-panel switch: forum channels swap in
// the post browser instead of the chat surface. Voice + stage channels
// reuse the chat surface because Discord embeds a text chat in each one.
const isForum = computed(() => selectedChannel.value?.kind === 'forum');

// Voice/stage channels in the current guild — fed to the user context
// menu so its "Move to ..." submenu reflects this guild's voice tree.
const voiceChannels = computed(() =>
    categories.value.flatMap(c => c.channels).filter(c => c.kind === 'voice' || c.kind === 'stage')
);

function headerTitle() {
    if (!selectedChannel.value) return null;
    const ch = selectedChannel.value;
    if (ch.kind === 'voice' || ch.kind === 'stage') return ch.name;
    return `#${ch.name}`;
}

// Forward picker — DiscordConversation surfaces the request because it
// owns the right-click menu, but it doesn't know the guild's channel
// tree, so destination selection lives here.
const forwardSource = ref<{ channelId: string; messageId: string } | null>(null);
function onForwardRequested(message: Message) {
    if (!selectedChannelId.value) return;
    forwardSource.value = { channelId: selectedChannelId.value, messageId: message.id };
}
async function onForwardPick(targetChannelId: string) {
    const src = forwardSource.value;
    if (!src) return;
    forwardSource.value = null;
    try {
        await forwardGuildMessage(props.guildId, targetChannelId, src.channelId, src.messageId);
    } catch {
        /* surface via toast in a future change; for now silent */
    }
}

// Mod actions on individual messages. The conversation emits these so
// the workspace owns the network calls + any required modal flow.
async function onPinMessage(message: Message) {
    if (!selectedChannelId.value) return;
    try { await pinGuildMessage(props.guildId, selectedChannelId.value, message.id); } catch { /* ignore */ }
}
async function onUnpinMessage(message: Message) {
    if (!selectedChannelId.value) return;
    try { await unpinGuildMessage(props.guildId, selectedChannelId.value, message.id); } catch { /* ignore */ }
}
async function onModDeleteMessage(message: Message) {
    if (!selectedChannelId.value) return;
    // Confirm via native confirm() — keeps the moderation deletion path
    // a single click from the menu while still preventing accidents.
    if (!confirm('Delete this message?')) return;
    try { await deleteGuildMessage(props.guildId, selectedChannelId.value, message.id); } catch { /* ignore */ }
}

const bulkDeleteAnchor = ref<Message | null>(null);
function onBulkDeleteRequested(anchor: Message) {
    bulkDeleteAnchor.value = anchor;
}
async function onBulkDeleteConfirm(count: number) {
    const anchor = bulkDeleteAnchor.value;
    bulkDeleteAnchor.value = null;
    if (!anchor || !selectedChannelId.value) return;
    // Take the `count` newest messages at-or-before the anchor in the
    // currently-loaded list. The backend rejects messages older than
    // 14 days via filterOld; we trust that filter rather than checking
    // timestamps client-side.
    const idx = chat.messages.value.findIndex(m => m.id === anchor.id);
    if (idx < 0) return;
    const start = Math.max(0, idx - count + 1);
    const ids = chat.messages.value.slice(start, idx + 1).map(m => m.id);
    if (ids.length < 2) return;
    try {
        await bulkDeleteGuildMessages(props.guildId, selectedChannelId.value, ids);
    } catch {
        /* ignore */
    }
}

watch(() => conversationRef.value?.messagesContainer, (container) => {
    if (!container) return;
    chat.bindContainers({
        messagesContainer: container,
        messagesEnd: conversationRef.value?.messagesEnd ?? null
    });
});
</script>

<template>
    <SidebarLayout>
        <template #sidebar>
            <GuildChannelSidebar
                :guilds="props.guilds"
                :mode="props.mode"
                :categories="categories"
                :selected-id="selectedChannelId"
                :loading="loadingChannels"
                :guild-id="props.guildId"
                @mode-change="emit('mode-change', $event)"
                @select="handleSelect"
            />
        </template>
        <AccessDeniedView v-if="accessDenied" />
        <GuildForumPanel
            v-else-if="isForum && selectedChannel"
            :guild-id="props.guildId"
            :forum-id="selectedChannel.id"
            :forum-name="selectedChannel.name"
            :header-subtitle="selectedGuild?.name ?? null"
            @posts-loaded="registerAuxSelectableIds"
            @select-post="handleSelect"
        />
        <DiscordConversation
            v-else
            ref="conversationRef"
            :channel-id="selectedChannelId"
            :header-title="headerTitle()"
            :header-subtitle="selectedGuild?.name ?? null"
            :messages="chat.messages.value"
            :bot-user-id="botUserId"
            :has-more="chat.hasMore.value"
            :loading-messages="chat.loadingMessages.value"
            :loading-older="chat.loadingOlder.value"
            :sending="chat.sending.value"
            :error="chat.error.value ?? channelsError"
            :editing-message-id="chat.editingMessageId.value"
            :reply-to="chat.replyTo.value"
            :pin-fetcher="pinFetcher"
            :can-forward="true"
            :can-moderate="true"
            @send="send"
            @reply="chat.reply"
            @cancel-reply="chat.cancelReply"
            @request-edit="chat.startEdit"
            @submit-edit="chat.submitEdit"
            @cancel-edit="chat.cancelEdit"
            @delete="chat.confirmDelete"
            @load-older="chat.loadOlder"
            @react="reactWithSelection"
            @jump-to-message="onJumpToMessage"
            @forward="onForwardRequested"
            @pin="onPinMessage"
            @unpin="onUnpinMessage"
            @mod-delete="onModDeleteMessage"
            @bulk-delete="onBulkDeleteRequested"
        />
        <GuildForwardPicker
            :visible="forwardSource !== null"
            :categories="categories"
            @pick="onForwardPick"
            @close="forwardSource = null"
        />
        <GuildBulkDeleteModal
            :visible="bulkDeleteAnchor !== null"
            @confirm="onBulkDeleteConfirm"
            @close="bulkDeleteAnchor = null"
        />
        <UserContextMenu :voice-channels="voiceChannels" />
        <GuildMemberMgmtModal />
        <GuildChannelMgmtModal :categories="categories" />
    </SidebarLayout>
</template>
