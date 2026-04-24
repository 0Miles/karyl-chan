import { ApiError, authedFetch } from './client';
import { getAccessToken } from '../auth';
import type { Message, MessageEmoji } from '../libs/messages';

export interface DmRecipient {
    id: string;
    username: string;
    globalName: string | null;
    avatarUrl: string | null;
}

export interface DmChannelSummary {
    id: string;
    recipient: DmRecipient;
    lastMessageAt: string | null;
    lastMessageId: string | null;
    lastMessagePreview: string | null;
}

export interface DmUnreadCount {
    count: number;
    hasMore: boolean;
}

export interface MessagesPage {
    channel: DmChannelSummary;
    messages: Message[];
    hasMore: boolean;
}

export type DmEvent =
    | { type: 'message-created'; channelId: string; message: Message }
    | { type: 'message-updated'; channelId: string; message: Message }
    | { type: 'message-deleted'; channelId: string; messageId: string }
    | { type: 'channel-touched'; channel: DmChannelSummary };

async function jsonOrThrow<T>(response: Response): Promise<T> {
    if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new ApiError(response.status, (body as { error?: string }).error ?? `${response.status} ${response.statusText}`);
    }
    return (await response.json()) as T;
}

export async function listChannels(): Promise<DmChannelSummary[]> {
    const response = await authedFetch('/api/dm/channels');
    const body = await jsonOrThrow<{ channels: DmChannelSummary[] }>(response);
    return body.channels;
}

export async function fetchUnreadCounts(
    lastSeen: Record<string, string | null>,
): Promise<Record<string, DmUnreadCount>> {
    const response = await authedFetch('/api/dm/unread', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lastSeen }),
    });
    const body = await jsonOrThrow<{ channels: Record<string, DmUnreadCount> }>(response);
    return body.channels;
}

export async function getMessages(channelId: string, opts: { limit?: number; before?: string; around?: string } = {}): Promise<MessagesPage> {
    const params = new URLSearchParams();
    if (opts.limit) params.set('limit', String(opts.limit));
    if (opts.before) params.set('before', opts.before);
    if (opts.around) params.set('around', opts.around);
    const query = params.toString();
    const url = `/api/dm/channels/${encodeURIComponent(channelId)}/messages${query ? `?${query}` : ''}`;
    const response = await authedFetch(url);
    return jsonOrThrow<MessagesPage>(response);
}

export async function sendMessage(
    channelId: string,
    content: string,
    files: File[] = [],
    stickerIds: string[] = [],
    replyToMessageId?: string
): Promise<Message> {
    let response: Response;
    const url = `/api/dm/channels/${encodeURIComponent(channelId)}/messages`;
    if (files.length > 0) {
        const form = new FormData();
        if (content) form.set('content', content);
        if (replyToMessageId) form.set('replyToMessageId', replyToMessageId);
        stickerIds.forEach(id => form.append('stickerIds', id));
        files.forEach(file => form.append('files', file, file.name));
        response = await authedFetch(url, { method: 'POST', body: form });
    } else {
        response = await authedFetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content, replyToMessageId, stickerIds: stickerIds.length ? stickerIds : undefined })
        });
    }
    const body = await jsonOrThrow<{ message: Message }>(response);
    return body.message;
}

export async function editMessage(channelId: string, messageId: string, content: string): Promise<Message> {
    const response = await authedFetch(
        `/api/dm/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}`,
        {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content })
        }
    );
    const body = await jsonOrThrow<{ message: Message }>(response);
    return body.message;
}

export async function deleteMessage(channelId: string, messageId: string): Promise<void> {
    const response = await authedFetch(
        `/api/dm/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}`,
        { method: 'DELETE' }
    );
    if (!response.ok && response.status !== 204) {
        throw new ApiError(response.status, 'Failed to delete message');
    }
}

export async function startChannel(recipientUserId: string): Promise<DmChannelSummary> {
    const response = await authedFetch('/api/dm/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipientUserId })
    });
    const body = await jsonOrThrow<{ channel: DmChannelSummary }>(response);
    return body.channel;
}

export async function addReaction(channelId: string, messageId: string, emoji: MessageEmoji): Promise<void> {
    const response = await authedFetch(`/api/dm/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}/reactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emoji })
    });
    if (!response.ok) throw new ApiError(response.status, 'Failed to add reaction');
}

export async function removeReaction(channelId: string, messageId: string, emoji: MessageEmoji): Promise<void> {
    const response = await authedFetch(`/api/dm/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}/reactions`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emoji })
    });
    if (!response.ok) throw new ApiError(response.status, 'Failed to remove reaction');
}

export interface EventStreamHandlers {
    onEvent: (event: DmEvent) => void;
    onError?: (event: Event) => void;
    onOpen?: () => void;
}

export function subscribeEvents(handlers: EventStreamHandlers): () => void {
    const token = getAccessToken();
    const params = token ? `?access_token=${encodeURIComponent(token)}` : '';
    const source = new EventSource(`/api/dm/events${params}`);
    if (handlers.onOpen) source.onopen = handlers.onOpen;
    if (handlers.onError) source.onerror = handlers.onError;
    const dispatch = (raw: MessageEvent) => {
        try {
            const data = JSON.parse(raw.data) as DmEvent;
            handlers.onEvent(data);
        } catch {
            // ignore malformed events
        }
    };
    source.addEventListener('message-created', dispatch as EventListener);
    source.addEventListener('message-updated', dispatch as EventListener);
    source.addEventListener('message-deleted', dispatch as EventListener);
    source.addEventListener('channel-touched', dispatch as EventListener);
    return () => source.close();
}
