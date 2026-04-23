import { ApiError, authedFetch } from './client';
import type { Message, MessageEmoji } from '../messages';

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
    lastMessagePreview: string | null;
    messageCount: number;
}

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

export async function getMessages(channelId: string, limit?: number): Promise<{ channel: DmChannelSummary; messages: Message[] }> {
    const url = `/api/dm/channels/${encodeURIComponent(channelId)}/messages${limit ? `?limit=${limit}` : ''}`;
    const response = await authedFetch(url);
    return jsonOrThrow<{ channel: DmChannelSummary; messages: Message[] }>(response);
}

export async function sendMessage(channelId: string, content: string, replyToMessageId?: string): Promise<Message> {
    const response = await authedFetch(`/api/dm/channels/${encodeURIComponent(channelId)}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, replyToMessageId })
    });
    const body = await jsonOrThrow<{ message: Message }>(response);
    return body.message;
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
