<script setup lang="ts">
import { ref, toRef, watch } from 'vue';
import { useRouter } from 'vue-router';
import GuildChannelSidebar from './GuildChannelSidebar.vue';
import { DiscordConversation, useDiscordGuildChannel } from '../../../modules/discord-chat';
import type { GuildSummary } from '../../../api/guilds';
import { useAppShell } from '../../../composables/use-app-shell';
import { SidebarLayout } from '../../../layouts';

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
const guildIdRef = toRef(props, 'guildId');
const { closeOverlay } = useAppShell();

const {
    categories,
    selectedChannelId,
    selectedChannel,
    loadingChannels,
    channelsError,
    botUserId,
    chat,
    send,
    reactWithSelection
} = useDiscordGuildChannel(guildIdRef, {
    onAuthError: () => router.replace({ name: 'auth' })
});

function handleSelect(id: string) {
    selectedChannelId.value = id;
    if (props.isMobile) closeOverlay();
}

const selectedGuild = ref(props.guilds.find(g => g.id === props.guildId) ?? null);
watch(() => props.guildId, id => {
    selectedGuild.value = props.guilds.find(g => g.id === id) ?? null;
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
    <SidebarLayout>
        <template #sidebar>
            <GuildChannelSidebar
                :guilds="props.guilds"
                :mode="props.mode"
                :categories="categories"
                :selected-id="selectedChannelId"
                :loading="loadingChannels"
                @mode-change="emit('mode-change', $event)"
                @select="handleSelect"
            />
        </template>
        <DiscordConversation
            ref="conversationRef"
            :channel-id="selectedChannelId"
            :header-title="selectedChannel ? `#${selectedChannel.name}` : null"
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
