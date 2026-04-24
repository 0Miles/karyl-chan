<script setup lang="ts">
import { ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import DmSidebar from './DmSidebar.vue';
import { DiscordConversation, useDiscordDm } from '../../../modules/discord-chat';
import type { GuildSummary } from '../../../api/guilds';
import { useAppShell } from '../../../composables/use-app-shell';
import { SidebarLayout } from '../../../layouts';

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
    startNewDm
} = useDiscordDm({
    onAuthError: () => router.replace({ name: 'auth' })
});

function handleSelect(id: string) {
    selectedChannelId.value = id;
    if (props.isMobile) closeOverlay();
}

// Allow deep links like /admin/messages?channel=<id>. Set synchronously
// so useDiscordDm's own onMounted pick-the-first-channel guard skips
// the default; also watch for future navigations (e.g., the user card
// "Send DM" button pushes a new query after creating the channel).
function applyChannelQuery(value: unknown) {
    if (typeof value !== 'string' || value.length === 0) return;
    if (selectedChannelId.value === value) return;
    selectedChannelId.value = value;
}
applyChannelQuery(route.query.channel);
watch(() => route.query.channel, applyChannelQuery);

// Mirror the selection back into the URL so a refresh lands on the same
// channel. Skips when the URL already matches to avoid pushing an
// identical history entry, and uses `replace` so the back button doesn't
// accumulate entries per channel switch. Only writes ids that exist in
// the DM channel list — otherwise a transient stale id (e.g. one left
// over from a guild→DM mode swap before useDiscordDm's validator
// re-picks) would briefly poison the URL. Immediate so a hot nav with
// a pre-selected channel flushes its id into the query.
watch(selectedChannelId, (id) => {
    if (!id) return;
    if (!channels.value.some(c => c.id === id)) return;
    if (route.query.channel === id) return;
    router.replace({ query: { ...route.query, channel: id } });
}, { immediate: true });

const conversationRef = ref<InstanceType<typeof DiscordConversation> | null>(null);
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
        <DiscordConversation
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
            @send="send"
            @reply="chat.reply"
            @cancel-reply="chat.cancelReply"
            @request-edit="chat.startEdit"
            @submit-edit="chat.submitEdit"
            @cancel-edit="chat.cancelEdit"
            @delete="chat.confirmDelete"
            @load-older="chat.loadOlder"
            @react="reactWithSelection"
        />
    </SidebarLayout>
</template>
