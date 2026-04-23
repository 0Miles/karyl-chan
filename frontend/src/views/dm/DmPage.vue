<script setup lang="ts">
import { ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import DmSidebar from './DmSidebar.vue';
import { DiscordConversation, useDiscordDm } from '../../modules/discord-chat';

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
        messagesEnd: container.querySelector(':scope > div:last-of-type') as HTMLElement | null
    });
});
</script>

<template>
    <section class="dm-page">
        <DmSidebar
            title="DMs"
            :channels="channels"
            :selected-id="selectedChannelId"
            :loading="loadingChannels"
            :show-start-form="showStart"
            :new-recipient-id="newRecipientId"
            empty-hint="No DMs yet. Send the bot a message in Discord, or start one above."
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
    </section>
</template>

<style scoped>
.dm-page {
    display: grid;
    grid-template-columns: 280px 1fr;
    height: 100%;
    min-height: 0;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg-surface);
    color: var(--text);
    overflow: hidden;
}
</style>
