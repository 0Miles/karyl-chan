<script setup lang="ts">
import { computed, ref, toRef, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import GuildChannelSidebar from './GuildChannelSidebar.vue';
import GuildForumPanel from './GuildForumPanel.vue';
import { DiscordConversation, useDiscordGuildChannel } from '../../../modules/discord-chat';
import { getGuildPins, type GuildSummary } from '../../../api/guilds';
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

function headerTitle() {
    if (!selectedChannel.value) return null;
    const ch = selectedChannel.value;
    if (ch.kind === 'voice' || ch.kind === 'stage') return ch.name;
    return `#${ch.name}`;
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
        />
    </SidebarLayout>
</template>
