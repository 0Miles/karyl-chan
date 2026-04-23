<script setup lang="ts">
import { ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import DmSidebar from './DmSidebar.vue';
import { DiscordConversation, useDiscordDm } from '../../modules/discord-chat';
import type { GuildSummary } from '../../api/guilds';

const props = defineProps<{
    guilds: GuildSummary[];
    mode: string;
}>();

const emit = defineEmits<{
    (e: 'mode-change', mode: string): void;
}>();

const router = useRouter();

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
    <DmSidebar
        :guilds="props.guilds"
        :mode="props.mode"
        :channels="channels"
        :selected-id="selectedChannelId"
        :loading="loadingChannels"
        :show-start-form="showStart"
        :new-recipient-id="newRecipientId"
        empty-hint="No DMs yet. Send the bot a message in Discord, or start one above."
        @mode-change="emit('mode-change', $event)"
        @select="(id) => (selectedChannelId = id)"
        @toggle-start="showStart = !showStart"
        @submit-start="startNewDm"
        @update:newRecipientId="(v) => (newRecipientId = v)"
    />
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
</template>
