import { computed, nextTick, onMounted, onUnmounted, provide, ref } from 'vue';
import { useRouter } from 'vue-router';
import {
    addReaction,
    deleteMessage,
    editMessage,
    getMessages,
    listChannels,
    removeReaction,
    sendMessage,
    startChannel,
    subscribeEvents,
    type DmChannelSummary,
    type DmEvent
} from '../api/dm';
import { ApiError, api as botApi } from '../api/client';
import {
    MessageContextKey,
    type Message,
    type MessageContext,
    type MessageEmoji,
    type MessageReference,
    type OutgoingMessage
} from '../messages';
import type { MediaSelection } from '../messages/picker/MediaPicker.vue';

const PAGE_SIZE = 10;

function emojiMatches(a: MessageEmoji, b: MessageEmoji): boolean {
    if (a.id || b.id) return a.id === b.id;
    return a.name === b.name;
}

export function useDmInbox() {
    const router = useRouter();

    const channels = ref<DmChannelSummary[]>([]);
    const selectedChannelId = ref<string | null>(null);
    const messages = ref<Message[]>([]);
    const replyTo = ref<MessageReference | null>(null);
    const loadingChannels = ref(false);
    const loadingMessages = ref(false);
    const loadingOlder = ref(false);
    const hasMore = ref(false);
    const sending = ref(false);
    const error = ref<string | null>(null);
    const newRecipientId = ref('');
    const showStart = ref(false);
    const botUserId = ref<string | null>(null);
    const editingMessageId = ref<string | null>(null);

    let unsubscribeEvents: (() => void) | null = null;
    let messagesContainer: HTMLElement | null = null;
    let messagesEnd: HTMLElement | null = null;

    function bindContainers(refs: { messagesContainer: HTMLElement | null; messagesEnd: HTMLElement | null }) {
        messagesContainer = refs.messagesContainer;
        messagesEnd = refs.messagesEnd;
    }

    function isNearBottom(): boolean {
        const el = messagesContainer;
        if (!el) return true;
        return el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    }

    function scrollToBottom() {
        messagesEnd?.scrollIntoView({ block: 'end' });
    }

    const selectedChannel = computed(() =>
        channels.value.find(c => c.id === selectedChannelId.value) ?? null
    );

    function bailOnAuthError(err: unknown): boolean {
        if (err instanceof ApiError && err.status === 401) {
            unsubscribeEvents?.();
            unsubscribeEvents = null;
            router.replace({ name: 'auth' });
            return true;
        }
        return false;
    }

    async function refreshChannels(autoSelect = true) {
        loadingChannels.value = true;
        try {
            channels.value = await listChannels();
            if (autoSelect && !selectedChannelId.value && channels.value.length > 0) {
                selectChannel(channels.value[0].id);
            }
            error.value = null;
        } catch (err) {
            if (bailOnAuthError(err)) return;
            error.value = err instanceof Error ? err.message : 'Failed to load channels';
        } finally {
            loadingChannels.value = false;
        }
    }

    async function fillIfNoScrollbar() {
        await nextTick();
        const el = messagesContainer;
        if (!el) return;
        if (el.scrollHeight <= el.clientHeight && hasMore.value && !loadingOlder.value) {
            await loadOlder();
        }
    }

    async function loadInitialMessages() {
        if (!selectedChannelId.value) return;
        loadingMessages.value = true;
        try {
            const result = await getMessages(selectedChannelId.value, { limit: PAGE_SIZE });
            messages.value = result.messages;
            hasMore.value = result.hasMore;
            error.value = null;
            await nextTick();
            scrollToBottom();
            await fillIfNoScrollbar();
        } catch (err) {
            if (bailOnAuthError(err)) return;
            error.value = err instanceof Error ? err.message : 'Failed to load messages';
        } finally {
            loadingMessages.value = false;
        }
    }

    async function loadOlder() {
        if (!selectedChannelId.value || loadingOlder.value || !hasMore.value || messages.value.length === 0) return;
        loadingOlder.value = true;
        const container = messagesContainer;
        const scrollHeightBefore = container?.scrollHeight ?? 0;
        const scrollTopBefore = container?.scrollTop ?? 0;
        try {
            const result = await getMessages(selectedChannelId.value, {
                limit: PAGE_SIZE,
                before: messages.value[0].id
            });
            if (result.messages.length === 0) {
                hasMore.value = false;
                return;
            }
            messages.value = [...result.messages, ...messages.value];
            hasMore.value = result.hasMore;
            await nextTick();
            if (container) {
                container.scrollTop = scrollTopBefore + (container.scrollHeight - scrollHeightBefore);
            }
        } catch (err) {
            if (bailOnAuthError(err)) return;
            error.value = err instanceof Error ? err.message : 'Failed to load older messages';
        } finally {
            loadingOlder.value = false;
        }
        await fillIfNoScrollbar();
    }

    function applyEvent(event: DmEvent) {
        if (event.type === 'channel-touched') {
            const idx = channels.value.findIndex(c => c.id === event.channel.id);
            if (idx === -1) channels.value = [event.channel, ...channels.value];
            else channels.value = channels.value.map(c => (c.id === event.channel.id ? event.channel : c));
            channels.value = [...channels.value].sort((a, b) =>
                (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? ''));
            return;
        }
        if (event.channelId !== selectedChannelId.value) return;
        if (event.type === 'message-created') {
            if (messages.value.some(m => m.id === event.message.id)) return;
            const wasNearBottom = isNearBottom();
            messages.value = [...messages.value, event.message];
            if (wasNearBottom) requestAnimationFrame(scrollToBottom);
        } else if (event.type === 'message-updated') {
            messages.value = messages.value.map(m => (m.id === event.message.id ? event.message : m));
        } else if (event.type === 'message-deleted') {
            messages.value = messages.value.filter(m => m.id !== event.messageId);
        }
    }

    function selectChannel(id: string) {
        selectedChannelId.value = id;
        replyTo.value = null;
        messages.value = [];
        hasMore.value = false;
        loadInitialMessages();
    }

    function applyReactionDelta(messageId: string, emoji: MessageEmoji, delta: 1 | -1) {
        messages.value = messages.value.map(m => {
            if (m.id !== messageId) return m;
            const existing = m.reactions ?? [];
            let found = false;
            const updated = existing.map(r => {
                if (!emojiMatches(r.emoji, emoji)) return r;
                found = true;
                return { ...r, count: Math.max(0, r.count + delta), me: delta > 0 };
            }).filter(r => r.count > 0);
            if (!found && delta > 0) updated.push({ emoji, count: 1, me: true });
            return { ...m, reactions: updated };
        });
    }

    async function send(payload: OutgoingMessage) {
        if (!selectedChannelId.value) return;
        sending.value = true;
        try {
            const sent = await sendMessage(
                selectedChannelId.value,
                payload.content,
                payload.attachments ?? [],
                payload.stickerIds ?? [],
                payload.reference?.messageId ?? undefined
            );
            replyTo.value = null;
            applyEvent({ type: 'message-created', channelId: sent.channelId, message: sent });
            const summary = channels.value.find(c => c.id === sent.channelId);
            if (summary) {
                applyEvent({
                    type: 'channel-touched',
                    channel: {
                        ...summary,
                        lastMessageAt: sent.createdAt,
                        lastMessagePreview: sent.content || (sent.attachments?.length ? `📎 ${sent.attachments[0].filename}` : '')
                    }
                });
            }
        } catch (err) {
            if (bailOnAuthError(err)) return;
            error.value = err instanceof Error ? err.message : 'Failed to send';
        } finally {
            sending.value = false;
        }
    }

    async function reactWithSelection(messageId: string, selection: MediaSelection) {
        if (!selectedChannelId.value) return;
        if (selection.type === 'sticker') return;
        const emoji: MessageEmoji = selection.type === 'unicode'
            ? { id: null, name: selection.value }
            : { id: selection.id, name: selection.name, animated: selection.animated };
        applyReactionDelta(messageId, emoji, 1);
        try {
            await addReaction(selectedChannelId.value, messageId, emoji);
        } catch (err) {
            applyReactionDelta(messageId, emoji, -1);
            if (bailOnAuthError(err)) return;
            error.value = err instanceof Error ? err.message : 'Failed to react';
        }
    }

    async function reactionAdd(messageId: string, emoji: MessageEmoji) {
        if (!selectedChannelId.value) return;
        applyReactionDelta(messageId, emoji, 1);
        try {
            await addReaction(selectedChannelId.value, messageId, emoji);
        } catch (err) {
            applyReactionDelta(messageId, emoji, -1);
            if (bailOnAuthError(err)) return;
            error.value = err instanceof Error ? err.message : 'Failed to react';
        }
    }

    async function reactionRemove(messageId: string, emoji: MessageEmoji) {
        if (!selectedChannelId.value) return;
        applyReactionDelta(messageId, emoji, -1);
        try {
            await removeReaction(selectedChannelId.value, messageId, emoji);
        } catch (err) {
            applyReactionDelta(messageId, emoji, 1);
            if (bailOnAuthError(err)) return;
            error.value = err instanceof Error ? err.message : 'Failed to remove reaction';
        }
    }

    function reply(message: Message) {
        replyTo.value = { messageId: message.id, channelId: message.channelId };
    }

    function cancelReply() { replyTo.value = null; }

    function onReplyClick(messageId: string) {
        document.querySelector(`[data-message-id="${messageId}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    function startEdit(message: Message) {
        if (botUserId.value !== message.author.id) return;
        editingMessageId.value = message.id;
    }

    function cancelEdit() { editingMessageId.value = null; }

    async function submitEdit(message: Message, content: string) {
        if (!selectedChannelId.value) return;
        const trimmed = content.trim();
        if (!trimmed) { editingMessageId.value = null; return; }
        try {
            await editMessage(selectedChannelId.value, message.id, trimmed);
            editingMessageId.value = null;
        } catch (err) {
            if (bailOnAuthError(err)) return;
            error.value = err instanceof Error ? err.message : 'Failed to edit';
        }
    }

    async function confirmDelete(message: Message, event?: MouseEvent) {
        if (!selectedChannelId.value || message.author.id !== botUserId.value) return;
        const skipPrompt = event?.shiftKey === true;
        if (!skipPrompt && !window.confirm('Delete this message?')) return;
        try {
            await deleteMessage(selectedChannelId.value, message.id);
        } catch (err) {
            if (bailOnAuthError(err)) return;
            error.value = err instanceof Error ? err.message : 'Failed to delete';
        }
    }

    async function startNewDm() {
        const id = newRecipientId.value.trim();
        if (!id) return;
        try {
            const channel = await startChannel(id);
            await refreshChannels(false);
            selectChannel(channel.id);
            showStart.value = false;
            newRecipientId.value = '';
        } catch (err) {
            if (bailOnAuthError(err)) return;
            error.value = err instanceof Error ? err.message : 'Failed to start DM';
        }
    }

    const ctx: MessageContext = {
        onReactionAdd: reactionAdd,
        onReactionRemove: reactionRemove,
        onReplyClick,
        get currentUserId() { return botUserId.value; }
    } as MessageContext;
    provide(MessageContextKey, ctx);

    onMounted(() => {
        refreshChannels();
        botApi.getBotStatus().then(status => { botUserId.value = status.userId; }).catch(() => {});
        unsubscribeEvents = subscribeEvents({
            onEvent: applyEvent,
            onError: () => { /* EventSource auto-reconnects */ }
        });
    });

    onUnmounted(() => {
        unsubscribeEvents?.();
        unsubscribeEvents = null;
    });

    return {
        // state
        channels,
        selectedChannel,
        selectedChannelId,
        messages,
        replyTo,
        loadingChannels,
        loadingMessages,
        loadingOlder,
        hasMore,
        sending,
        error,
        newRecipientId,
        showStart,
        botUserId,
        editingMessageId,
        // bindings
        bindContainers,
        // actions
        selectChannel,
        send,
        reply,
        cancelReply,
        startEdit,
        cancelEdit,
        submitEdit,
        confirmDelete,
        loadOlder,
        reactWithSelection,
        startNewDm,
        toggleStartForm() { showStart.value = !showStart.value; }
    };
}
