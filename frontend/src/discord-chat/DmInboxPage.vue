<script setup lang="ts">
import { ref, watch } from 'vue';
import ChatSidebar from '../messages/ChatSidebar.vue';
import ChatConversation from '../messages/ChatConversation.vue';
import { useDmInbox } from './useDmInbox';

const inbox = useDmInbox();
const conversationRef = ref<InstanceType<typeof ChatConversation> | null>(null);

watch(() => conversationRef.value?.messagesContainer, (container) => {
    if (!container) return;
    inbox.bindContainers({
        messagesContainer: container,
        messagesEnd: container.querySelector(':scope > div:last-of-type') as HTMLElement | null
    });
});
</script>

<template>
    <section class="dm-page">
        <ChatSidebar
            title="DMs"
            :channels="inbox.channels.value"
            :selected-id="inbox.selectedChannelId.value"
            :loading="inbox.loadingChannels.value"
            :show-start-form="inbox.showStart.value"
            :new-recipient-id="inbox.newRecipientId.value"
            empty-hint="No DMs yet. Send the bot a message in Discord, or start one above."
            @select="inbox.selectChannel"
            @toggle-start="inbox.toggleStartForm"
            @submit-start="inbox.startNewDm"
            @update:newRecipientId="(v: string) => (inbox.newRecipientId.value = v)"
        />
        <ChatConversation
            ref="conversationRef"
            :channel="inbox.selectedChannel.value"
            :messages="inbox.messages.value"
            :bot-user-id="inbox.botUserId.value"
            :has-more="inbox.hasMore.value"
            :loading-messages="inbox.loadingMessages.value"
            :loading-older="inbox.loadingOlder.value"
            :sending="inbox.sending.value"
            :error="inbox.error.value"
            :editing-message-id="inbox.editingMessageId.value"
            :reply-to="inbox.replyTo.value"
            @send="inbox.send"
            @reply="inbox.reply"
            @cancel-reply="inbox.cancelReply"
            @request-edit="inbox.startEdit"
            @submit-edit="inbox.submitEdit"
            @cancel-edit="inbox.cancelEdit"
            @delete="inbox.confirmDelete"
            @load-older="inbox.loadOlder"
            @react="inbox.reactWithSelection"
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
