<script setup lang="ts">
import { ref, toRef, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
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
const route = useRoute();
const guildIdRef = toRef(props, 'guildId');
const { closeOverlay } = useAppShell();

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
    reactWithSelection
} = useDiscordGuildChannel(guildIdRef, {
    onAuthError: () => router.replace({ name: 'auth' })
});

function handleSelect(id: string) {
    selectedChannelId.value = id;
    if (props.isMobile) closeOverlay();
}

// Deep link + refresh survival: URL is the source of truth on load, then
// we mirror user-driven channel switches back into `?channel=` with
// `router.replace` so history doesn't bloat.
function applyChannelQuery(value: unknown) {
    if (typeof value !== 'string' || value.length === 0) return;
    if (selectedChannelId.value === value) return;
    selectedChannelId.value = value;
}
applyChannelQuery(route.query.channel);
watch(() => route.query.channel, applyChannelQuery);

// Same policy as DmWorkspace: only reflect ids that actually exist in
// the loaded channel list, so a stale URL param or a mid-navigation
// seed doesn't briefly land in the history/query before the composable
// validator corrects it.
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
