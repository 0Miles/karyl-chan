import type { Message as ApiMessage } from './message-types.js';

const MAX_MESSAGES_PER_CHANNEL = 200;

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

interface ChannelRecord {
    id: string;
    recipient: DmRecipient;
    messages: Map<string, ApiMessage>;
    lastMessageAt: string | null;
    lastMessagePreview: string | null;
}

export class DmInboxService {
    private channels = new Map<string, ChannelRecord>();

    upsertChannel(channelId: string, recipient: DmRecipient): DmChannelSummary {
        let record = this.channels.get(channelId);
        if (!record) {
            record = {
                id: channelId,
                recipient,
                messages: new Map(),
                lastMessageAt: null,
                lastMessagePreview: null
            };
            this.channels.set(channelId, record);
        } else {
            record.recipient = recipient;
        }
        return this.toSummary(record);
    }

    recordMessage(channelId: string, recipient: DmRecipient, message: ApiMessage): void {
        const record = this.getOrCreate(channelId, recipient);
        record.messages.set(message.id, message);
        if (!record.lastMessageAt || message.createdAt >= record.lastMessageAt) {
            record.lastMessageAt = message.createdAt;
            record.lastMessagePreview = previewFor(message);
        }
        if (record.messages.size > MAX_MESSAGES_PER_CHANNEL) {
            const sorted = [...record.messages.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
            const drop = sorted.slice(0, record.messages.size - MAX_MESSAGES_PER_CHANNEL);
            for (const m of drop) record.messages.delete(m.id);
        }
    }

    updateMessage(channelId: string, message: ApiMessage): boolean {
        const record = this.channels.get(channelId);
        if (!record || !record.messages.has(message.id)) return false;
        record.messages.set(message.id, message);
        if (record.lastMessageAt === message.createdAt) {
            record.lastMessagePreview = previewFor(message);
        }
        return true;
    }

    removeMessage(channelId: string, messageId: string): boolean {
        const record = this.channels.get(channelId);
        if (!record) return false;
        return record.messages.delete(messageId);
    }

    listChannels(): DmChannelSummary[] {
        return [...this.channels.values()]
            .map(r => this.toSummary(r))
            .sort((a, b) => {
                const aTs = a.lastMessageAt ?? '';
                const bTs = b.lastMessageAt ?? '';
                return bTs.localeCompare(aTs);
            });
    }

    getChannel(channelId: string): DmChannelSummary | null {
        const record = this.channels.get(channelId);
        return record ? this.toSummary(record) : null;
    }

    getMessages(channelId: string, limit?: number): ApiMessage[] {
        const record = this.channels.get(channelId);
        if (!record) return [];
        const sorted = [...record.messages.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        if (limit && sorted.length > limit) return sorted.slice(-limit);
        return sorted;
    }

    clear(): void {
        this.channels.clear();
    }

    private getOrCreate(channelId: string, recipient: DmRecipient): ChannelRecord {
        let record = this.channels.get(channelId);
        if (!record) {
            record = {
                id: channelId,
                recipient,
                messages: new Map(),
                lastMessageAt: null,
                lastMessagePreview: null
            };
            this.channels.set(channelId, record);
        } else if (recipient.username) {
            record.recipient = recipient;
        }
        return record;
    }

    private toSummary(record: ChannelRecord): DmChannelSummary {
        return {
            id: record.id,
            recipient: record.recipient,
            lastMessageAt: record.lastMessageAt,
            lastMessagePreview: record.lastMessagePreview,
            messageCount: record.messages.size
        };
    }
}

function previewFor(message: ApiMessage): string {
    if (message.content) return message.content.slice(0, 120);
    if (message.attachments?.length) return `📎 ${message.attachments[0].filename}`;
    if (message.stickers?.length) return `🏷 ${message.stickers[0].name}`;
    if (message.embeds?.length) return `📰 ${message.embeds[0].title ?? 'embed'}`;
    return '';
}

export const dmInboxService = new DmInboxService();
