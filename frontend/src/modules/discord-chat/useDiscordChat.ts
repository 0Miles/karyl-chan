import { nextTick, ref, watch, type Ref } from 'vue';
import type { Message, MessageEmoji, MessageReference, OutgoingMessage } from '../../libs/messages';

export interface DiscordChatApi {
    listMessages(channelId: string, opts: { limit?: number; before?: string }): Promise<{ messages: Message[]; hasMore: boolean }>;
    sendMessage(channelId: string, content: string, files: File[], stickerIds: string[], replyToMessageId?: string): Promise<Message>;
    editMessage(channelId: string, messageId: string, content: string): Promise<Message>;
    deleteMessage(channelId: string, messageId: string): Promise<void>;
    addReaction(channelId: string, messageId: string, emoji: MessageEmoji): Promise<void>;
    removeReaction(channelId: string, messageId: string, emoji: MessageEmoji): Promise<void>;
}

export type ChannelMessageEvent =
    | { type: 'message-created'; channelId: string; message: Message }
    | { type: 'message-updated'; channelId: string; message: Message }
    | { type: 'message-deleted'; channelId: string; messageId: string };

export interface UseDiscordChatOptions {
    channelId: Ref<string | null>;
    api: DiscordChatApi;
    /** Called for any error; return true if you handled it (skip surfacing). */
    onError?: (err: unknown) => boolean;
    /** Bot user id ref; lets isOwn/edit-permission checks work without prop drilling. */
    botUserId?: Ref<string | null>;
    pageSize?: number;
}

function emojiMatches(a: MessageEmoji, b: MessageEmoji): boolean {
    if (a.id || b.id) return a.id === b.id;
    return a.name === b.name;
}

/**
 * Channel-scoped Discord chat state + actions. Re-bind it to a new channel
 * by changing the channelId ref. Emits no SSE itself — the parent surface
 * subscribes once and feeds applyEvent for every channel-scoped event.
 */
export function useDiscordChat(opts: UseDiscordChatOptions) {
    const PAGE_SIZE = opts.pageSize ?? 10;

    const messages = ref<Message[]>([]);
    const replyTo = ref<MessageReference | null>(null);
    const editingMessageId = ref<string | null>(null);
    const loadingMessages = ref(false);
    const loadingOlder = ref(false);
    const hasMore = ref(false);
    const sending = ref(false);
    const error = ref<string | null>(null);

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

    function bail(err: unknown): boolean {
        if (opts.onError?.(err)) return true;
        error.value = err instanceof Error ? err.message : 'Unknown error';
        return false;
    }

    async function loadInitialMessages() {
        const channelId = opts.channelId.value;
        if (!channelId) return;
        loadingMessages.value = true;
        try {
            const result = await opts.api.listMessages(channelId, { limit: PAGE_SIZE });
            if (channelId !== opts.channelId.value) return;
            messages.value = result.messages;
            hasMore.value = result.hasMore;
            error.value = null;
            await nextTick();
            scrollToBottom();
            await fillIfNoScrollbar();
        } catch (err) {
            bail(err);
        } finally {
            loadingMessages.value = false;
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

    async function loadOlder() {
        const channelId = opts.channelId.value;
        if (!channelId || loadingOlder.value || !hasMore.value || messages.value.length === 0) return;
        loadingOlder.value = true;
        const container = messagesContainer;
        const scrollHeightBefore = container?.scrollHeight ?? 0;
        const scrollTopBefore = container?.scrollTop ?? 0;
        try {
            const result = await opts.api.listMessages(channelId, {
                limit: PAGE_SIZE,
                before: messages.value[0].id
            });
            if (channelId !== opts.channelId.value) return;
            if (result.messages.length === 0) { hasMore.value = false; return; }
            messages.value = [...result.messages, ...messages.value];
            hasMore.value = result.hasMore;
            await nextTick();
            if (container) container.scrollTop = scrollTopBefore + (container.scrollHeight - scrollHeightBefore);
        } catch (err) {
            bail(err);
        } finally {
            loadingOlder.value = false;
        }
        await fillIfNoScrollbar();
    }

    function applyEvent(event: ChannelMessageEvent) {
        if (event.channelId !== opts.channelId.value) return;
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
            applyEvent({ type: 'message-created', channelId: sent.channelId, message: sent });
            return sent;
        } catch (err) {
            bail(err);
            return null;
        } finally {
            sending.value = false;
        }
    }

    async function reactAdd(messageId: string, emoji: MessageEmoji) {
        const channelId = opts.channelId.value;
        if (!channelId) return;
        applyReactionDelta(messageId, emoji, 1);
        try {
            await opts.api.addReaction(channelId, messageId, emoji);
        } catch (err) {
            applyReactionDelta(messageId, emoji, -1);
            bail(err);
        }
    }

    async function reactRemove(messageId: string, emoji: MessageEmoji) {
        const channelId = opts.channelId.value;
        if (!channelId) return;
        applyReactionDelta(messageId, emoji, -1);
        try {
            await opts.api.removeReaction(channelId, messageId, emoji);
        } catch (err) {
            applyReactionDelta(messageId, emoji, 1);
            bail(err);
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

    watch(opts.channelId, (id) => {
        replyTo.value = null;
        editingMessageId.value = null;
        messages.value = [];
        hasMore.value = false;
        if (id) loadInitialMessages();
    });

    return {
        // state
        messages,
        replyTo,
        editingMessageId,
        loadingMessages,
        loadingOlder,
        hasMore,
        sending,
        error,
        // wiring
        bindContainers,
        applyEvent,
        // actions
        send,
        reactAdd,
        reactRemove,
        reply,
        cancelReply,
        startEdit,
        cancelEdit,
        submitEdit,
        confirmDelete,
        loadInitialMessages,
        loadOlder
    };
}
