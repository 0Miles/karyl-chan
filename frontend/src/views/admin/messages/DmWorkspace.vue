<script setup lang="ts">
import { ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import DmSidebar from './DmSidebar.vue';
import UserContextMenu from '../../../modules/discord-chat/UserContextMenu.vue';
import GuildForwardPicker from './GuildForwardPicker.vue';
import { DiscordConversation, useDiscordDm } from '../../../modules/discord-chat';
import { forwardMessage, type GuildSummary } from '../../../api/guilds';
import { getPins } from '../../../api/dm';
import type { Message } from '../../../libs/messages/types';
import { useAppShell } from '../../../composables/use-app-shell';
import { SidebarLayout } from '../../../layouts';
import AccessDeniedView from '../../../components/AccessDeniedView.vue';

const props = defineProps<{
    guilds: GuildSummary[];
    mode: string;
    isMobile?: boolean;
}>();

const emit = defineEmits<{
    (e: 'mode-change', mode: string): void;
}>();

const router = useRouter();
const route = useRoute();
const { closeOverlay } = useAppShell();

// `onScrollFinished` fires from the workspace machine once a pending
// scroll either landed on its target or gave up — we use that as the
// trigger to drop the `?scrollTo=` query, which otherwise would keep
// re-triggering the same jump on refresh.
function clearScrollToQuery() {
    if (typeof route.query.scrollTo !== 'string' || !route.query.scrollTo) return;
    const next = { ...route.query };
    delete next.scrollTo;
    router.replace({ query: next });
}

const conversationRef = ref<InstanceType<typeof DiscordConversation> | null>(null);
const accessDenied = ref(false);

const {
    channels,
    selectedChannelId,
    selectedChannel,
    loadingChannels,
    channelsError,
    showStart,
    newRecipientId,
    botUserId,
    chat,
    send,
    reactWithSelection,
    startNewDm,
    selectChannel,
    requestScroll
} = useDiscordDm({
    onAuthError: () => router.replace({ name: 'auth' }),
    onForbidden: () => { accessDenied.value = true; },
    onScrollFinished: () => clearScrollToQuery(),
    attemptScroll: (id) => conversationRef.value?.scrollToMessage(id) ?? false
});

function handleSelect(id: string) {
    selectChannel(id);
    if (props.isMobile) closeOverlay();
}

// Forward picker — same component as the guild flow; the picker offers
// guild channels + DMs as destinations and the backend dispatches via
// channel resolution, so a single handler covers both surfaces.
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
        await forwardMessage(src.channelId, src.messageId, targetChannelId);
    } catch {
        /* surfaced as a silent error today; toast hooks pending */
    }
}

// Pin/jump → seed `?scrollTo=` so the workspace machine performs the
// scroll once the message lands in the rendered window. Equivalent to
// clicking a message link from outside the page.
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
// once it lands in the live channel list — guarantees we never write a
// stale id that the machine hasn't validated.
watch(selectedChannelId, (id) => {
    if (!id) return;
    if (!channels.value.some(c => c.id === id)) return;
    if (route.query.channel === id) return;
    router.replace({ query: { ...route.query, channel: id } });
}, { immediate: true });

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
            <DmSidebar
                :guilds="props.guilds"
                :mode="props.mode"
                :channels="channels"
                :selected-id="selectedChannelId"
                :loading="loadingChannels"
                :show-start-form="showStart"
                :new-recipient-id="newRecipientId"
                @mode-change="emit('mode-change', $event)"
                @select="handleSelect"
                @toggle-start="showStart = !showStart"
                @submit-start="startNewDm"
                @update:newRecipientId="(v) => (newRecipientId = v)"
            />
        </template>
        <AccessDeniedView v-if="accessDenied" />
        <DiscordConversation
            v-else
            ref="conversationRef"
            :channel-id="selectedChannelId"
            :header-title="selectedChannel ? (selectedChannel.recipient.globalName ?? selectedChannel.recipient.username) : null"
            :header-subtitle="selectedChannel?.recipient.id ?? null"
            :messages="chat.messages.value"
            :bot-user-id="botUserId"
            :has-more="chat.hasMore.value"
            :loading-messages="chat.loadingMessages.value"
            :loading-older="chat.loadingOlder.value"
            :sending="chat.sending.value"
            :error="chat.error.value ?? channelsError"
            :editing-message-id="chat.editingMessageId.value"
            :reply-to="chat.replyTo.value"
            :pin-fetcher="getPins"
            :can-forward="true"
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
        />
        <GuildForwardPicker
            :visible="forwardSource !== null"
            :guilds="props.guilds"
            :current-guild-id="null"
            @pick="onForwardPick"
            @close="forwardSource = null"
        />
        <UserContextMenu />
    </SidebarLayout>
</template>
