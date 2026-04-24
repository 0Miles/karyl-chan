import { computed, nextTick, ref, watch, type Ref } from 'vue';
import type { Message, MessageEmoji, MessageReference, OutgoingMessage } from '../../libs/messages';
import type { MediaSelection } from '../../libs/messages/picker/MediaPicker.vue';
import { useMessageCacheStore } from './stores/messageCacheStore';

export type { ChannelMessageEvent } from './stores/messageCacheStore';

export interface DiscordChatApi {
    listMessages(channelId: string, opts: { limit?: number; before?: string }): Promise<{ messages: Message[]; hasMore: boolean }>;
    sendMessage(channelId: string, content: string, files: File[], stickerIds: string[], replyToMessageId?: string): Promise<Message>;
    editMessage(channelId: string, messageId: string, content: string): Promise<Message>;
    deleteMessage(channelId: string, messageId: string): Promise<void>;
    addReaction(channelId: string, messageId: string, emoji: MessageEmoji): Promise<void>;
    removeReaction(channelId: string, messageId: string, emoji: MessageEmoji): Promise<void>;
}

export interface UseDiscordChatOptions {
    channelId: Ref<string | null>;
    api: DiscordChatApi;
    onError?: (err: unknown) => boolean;
    botUserId?: Ref<string | null>;
    pageSize?: number;
}

export function useDiscordChat(opts: UseDiscordChatOptions) {
    const messageCache = useMessageCacheStore();

    const replyTo = ref<MessageReference | null>(null);
    const editingMessageId = ref<string | null>(null);
    const sending = ref(false);
    const error = ref<string | null>(null);

    const messages = computed(() => messageCache.get(opts.channelId.value)?.messages ?? []);
    const hasMore = computed(() => messageCache.get(opts.channelId.value)?.hasMore ?? false);
    const loadingMessages = computed(() => messageCache.get(opts.channelId.value)?.loadingInitial ?? false);
    const loadingOlder = computed(() => messageCache.get(opts.channelId.value)?.loadingOlder ?? false);

    let messagesContainer: HTMLElement | null = null;

    function bindContainers(refs: { messagesContainer: HTMLElement | null; messagesEnd?: HTMLElement | null }) {
        messagesContainer = refs.messagesContainer;
    }

    function isNearBottom(): boolean {
        const el = messagesContainer;
        if (!el) return true;
        return el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    }

    function scrollToBottom() {
        if (messagesContainer) messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    function bail(err: unknown): boolean {
        if (opts.onError?.(err)) return true;
        error.value = err instanceof Error ? err.message : 'Unknown error';
        return false;
    }

    async function fillIfNoScrollbar() {
        await nextTick();
        const el = messagesContainer;
        if (!el) return;
        if (el.scrollHeight <= el.clientHeight && hasMore.value && !loadingOlder.value) {
            await loadOlder();
        }
    }

    async function loadOlder() {
        const channelId = opts.channelId.value;
        if (!channelId) return;
        const scrollHeightBefore = messagesContainer?.scrollHeight ?? 0;
        const scrollTopBefore = messagesContainer?.scrollTop ?? 0;
        try {
            await messageCache.loadOlder(channelId, opts.api.listMessages);
        } catch (err) {
            bail(err);
            return;
        }
        if (channelId !== opts.channelId.value) return;
        await nextTick();
        if (messagesContainer) {
            messagesContainer.scrollTop = scrollTopBefore + (messagesContainer.scrollHeight - scrollHeightBefore);
        }
        await fillIfNoScrollbar();
    }

    /**
     * Fetch a window of messages centred on `messageId` (used when a
     * message-link click needs to land on an older message not already
     * in the cache). Replaces the current batch.
     */
    async function loadAround(messageId: string): Promise<void> {
        const channelId = opts.channelId.value;
        if (!channelId) return;
        try {
            await messageCache.loadAround(channelId, messageId, opts.api.listMessages);
        } catch (err) {
            bail(err);
        }
    }

    // Scroll to bottom when a new message arrives and we're near the bottom.
    const lastMessageId = computed(() => {
        const msgs = messages.value;
        return msgs.length > 0 ? msgs[msgs.length - 1].id : null;
    });
    watch(lastMessageId, (newId, oldId) => {
        if (newId && newId !== oldId) {
            if (isNearBottom()) requestAnimationFrame(scrollToBottom);
        }
    });

    async function reactAdd(messageId: string, emoji: MessageEmoji) {
        const channelId = opts.channelId.value;
        if (!channelId) return;
        messageCache.applyReactionDelta(channelId, messageId, emoji, 1);
        try {
            await opts.api.addReaction(channelId, messageId, emoji);
        } catch (err) {
            messageCache.applyReactionDelta(channelId, messageId, emoji, -1);
            bail(err);
        }
    }

    async function reactRemove(messageId: string, emoji: MessageEmoji) {
        const channelId = opts.channelId.value;
        if (!channelId) return;
        messageCache.applyReactionDelta(channelId, messageId, emoji, -1);
        try {
            await opts.api.removeReaction(channelId, messageId, emoji);
        } catch (err) {
            messageCache.applyReactionDelta(channelId, messageId, emoji, 1);
            bail(err);
        }
    }

    async function reactWithSelection(messageId: string, selection: MediaSelection) {
        if (selection.type === 'sticker') return;
        const emoji: MessageEmoji = selection.type === 'unicode'
            ? { id: null, name: selection.value }
            : { id: selection.id, name: selection.name, animated: selection.animated };
        await reactAdd(messageId, emoji);
    }

    async function send(payload: OutgoingMessage) {
        const channelId = opts.channelId.value;
        if (!channelId) return null;
        sending.value = true;
        try {
            const sent = await opts.api.sendMessage(
                channelId,
                payload.content,
                payload.attachments ?? [],
                payload.stickerIds ?? [],
                payload.reference?.messageId ?? undefined
            );
            replyTo.value = null;
            messageCache.applyEvent({ type: 'message-created', channelId: sent.channelId, message: sent });
            return sent;
        } catch (err) {
            bail(err);
            return null;
        } finally {
            sending.value = false;
        }
    }

    function reply(message: Message) {
        replyTo.value = { messageId: message.id, channelId: message.channelId };
    }
    function cancelReply() { replyTo.value = null; }

    function startEdit(message: Message) {
        if (opts.botUserId && message.author.id !== opts.botUserId.value) return;
        editingMessageId.value = message.id;
    }
    function cancelEdit() { editingMessageId.value = null; }

    async function submitEdit(message: Message, content: string) {
        const channelId = opts.channelId.value;
        if (!channelId) return;
        const trimmed = content.trim();
        if (!trimmed) { editingMessageId.value = null; return; }
        try {
            await opts.api.editMessage(channelId, message.id, trimmed);
            editingMessageId.value = null;
        } catch (err) {
            bail(err);
        }
    }

    async function confirmDelete(message: Message, event?: MouseEvent) {
        const channelId = opts.channelId.value;
        if (!channelId) return;
        if (opts.botUserId && message.author.id !== opts.botUserId.value) return;
        const skipPrompt = event?.shiftKey === true;
        if (!skipPrompt && !window.confirm('Delete this message?')) return;
        try {
            await opts.api.deleteMessage(channelId, message.id);
        } catch (err) {
            bail(err);
        }
    }

    watch(opts.channelId, async (id) => {
        replyTo.value = null;
        editingMessageId.value = null;
        error.value = null;
        if (!id) return;
        try {
            await messageCache.ensureLoaded(id, opts.api.listMessages);
        } catch (err) {
            bail(err);
            return;
        }
        if (id !== opts.channelId.value) return;
        await fillIfNoScrollbar();
    });

    return {
        messages,
        replyTo,
        editingMessageId,
        loadingMessages,
        loadingOlder,
        hasMore,
        sending,
        error,
        bindContainers,
        send,
        reactAdd,
        reactRemove,
        reactWithSelection,
        reply,
        cancelReply,
        startEdit,
        cancelEdit,
        submitEdit,
        confirmDelete,
        loadOlder,
        loadAround,
    };
}
