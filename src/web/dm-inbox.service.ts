import { Op } from 'sequelize';
import { DmChannel } from '../models/dm-channel.model.js';
import { DmMessage } from '../models/dm-message.model.js';
import type { Message as ApiMessage } from './message-types.js';

const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 50;

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

export interface GetMessagesOptions {
    limit?: number;
    before?: string;
}

export interface DmInboxStore {
    upsertChannel(channelId: string, recipient: DmRecipient): Promise<DmChannelSummary>;
    recordMessage(channelId: string, recipient: DmRecipient, message: ApiMessage): Promise<void>;
    updateMessage(channelId: string, message: ApiMessage): Promise<boolean>;
    removeMessage(channelId: string, messageId: string): Promise<boolean>;
    listChannels(): Promise<DmChannelSummary[]>;
    getChannel(channelId: string): Promise<DmChannelSummary | null>;
    getMessages(channelId: string, opts?: GetMessagesOptions): Promise<ApiMessage[]>;
}

function previewFor(message: ApiMessage): string {
    if (message.content) return message.content.slice(0, 120);
    if (message.attachments?.length) return `📎 ${message.attachments[0].filename}`;
    if (message.stickers?.length) return `🏷 ${message.stickers[0].name}`;
    if (message.embeds?.length) return `📰 ${message.embeds[0].title ?? 'embed'}`;
    return '';
}

function clampLimit(limit?: number): number {
    if (!limit || limit <= 0) return DEFAULT_PAGE_SIZE;
    return Math.min(limit, MAX_PAGE_SIZE);
}

export class InMemoryDmInbox implements DmInboxStore {
    private channels = new Map<string, { record: DmChannelSummary; messages: Map<string, ApiMessage> }>();

    async upsertChannel(channelId: string, recipient: DmRecipient): Promise<DmChannelSummary> {
        const entry = this.channels.get(channelId);
        if (!entry) {
            const summary: DmChannelSummary = { id: channelId, recipient, lastMessageAt: null, lastMessagePreview: null, messageCount: 0 };
            this.channels.set(channelId, { record: summary, messages: new Map() });
            return summary;
        }
        entry.record.recipient = recipient;
        return entry.record;
    }

    async recordMessage(channelId: string, recipient: DmRecipient, message: ApiMessage): Promise<void> {
        await this.upsertChannel(channelId, recipient);
        const entry = this.channels.get(channelId)!;
        entry.messages.set(message.id, message);
        if (!entry.record.lastMessageAt || message.createdAt >= entry.record.lastMessageAt) {
            entry.record.lastMessageAt = message.createdAt;
            entry.record.lastMessagePreview = previewFor(message);
        }
        entry.record.messageCount = entry.messages.size;
    }

    async updateMessage(channelId: string, message: ApiMessage): Promise<boolean> {
        const entry = this.channels.get(channelId);
        if (!entry || !entry.messages.has(message.id)) return false;
        entry.messages.set(message.id, message);
        if (entry.record.lastMessageAt === message.createdAt) {
            entry.record.lastMessagePreview = previewFor(message);
        }
        return true;
    }

    async removeMessage(channelId: string, messageId: string): Promise<boolean> {
        const entry = this.channels.get(channelId);
        if (!entry) return false;
        const removed = entry.messages.delete(messageId);
        if (removed) entry.record.messageCount = entry.messages.size;
        return removed;
    }

    async listChannels(): Promise<DmChannelSummary[]> {
        return [...this.channels.values()]
            .map(e => ({ ...e.record }))
            .sort((a, b) => (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? ''));
    }

    async getChannel(channelId: string): Promise<DmChannelSummary | null> {
        const entry = this.channels.get(channelId);
        return entry ? { ...entry.record } : null;
    }

    async getMessages(channelId: string, opts: GetMessagesOptions = {}): Promise<ApiMessage[]> {
        const entry = this.channels.get(channelId);
        if (!entry) return [];
        const sorted = [...entry.messages.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        const limit = clampLimit(opts.limit);
        if (opts.before) {
            const beforeMsg = entry.messages.get(opts.before);
            if (!beforeMsg) return [];
            const older = sorted.filter(m => m.createdAt < beforeMsg.createdAt);
            return older.slice(-limit);
        }
        return sorted.slice(-limit);
    }
}

export class SqliteDmInbox implements DmInboxStore {
    async upsertChannel(channelId: string, recipient: DmRecipient): Promise<DmChannelSummary> {
        const [row] = await DmChannel.upsert({
            id: channelId,
            recipientId: recipient.id,
            recipientUsername: recipient.username,
            recipientGlobalName: recipient.globalName,
            recipientAvatarUrl: recipient.avatarUrl
        });
        return this.rowToSummary(row, await this.countMessages(channelId));
    }

    async recordMessage(channelId: string, recipient: DmRecipient, message: ApiMessage): Promise<void> {
        const existing = await DmChannel.findByPk(channelId);
        const previousLast = existing ? (existing.getDataValue('lastMessageAt') as string | null) : null;
        const isNewer = !previousLast || message.createdAt >= previousLast;
        await DmChannel.upsert({
            id: channelId,
            recipientId: recipient.id,
            recipientUsername: recipient.username,
            recipientGlobalName: recipient.globalName,
            recipientAvatarUrl: recipient.avatarUrl,
            lastMessageAt: isNewer ? message.createdAt : previousLast,
            lastMessagePreview: isNewer ? previewFor(message) : (existing?.getDataValue('lastMessagePreview') as string | null)
        });
        await DmMessage.upsert({
            id: message.id,
            channelId,
            createdAt: message.createdAt,
            data: JSON.stringify(message)
        });
    }

    async updateMessage(channelId: string, message: ApiMessage): Promise<boolean> {
        const existing = await DmMessage.findByPk(message.id);
        if (!existing || existing.getDataValue('channelId') !== channelId) return false;
        await existing.update({ data: JSON.stringify(message), createdAt: message.createdAt });
        const channel = await DmChannel.findByPk(channelId);
        if (channel && channel.getDataValue('lastMessageAt') === message.createdAt) {
            await channel.update({ lastMessagePreview: previewFor(message) });
        }
        return true;
    }

    async removeMessage(channelId: string, messageId: string): Promise<boolean> {
        const removed = await DmMessage.destroy({ where: { id: messageId, channelId } });
        return removed > 0;
    }

    async listChannels(): Promise<DmChannelSummary[]> {
        const rows = await DmChannel.findAll({ order: [['lastMessageAt', 'DESC']] });
        const summaries = await Promise.all(rows.map(async r => this.rowToSummary(r, await this.countMessages(r.getDataValue('id') as string))));
        return summaries;
    }

    async getChannel(channelId: string): Promise<DmChannelSummary | null> {
        const row = await DmChannel.findByPk(channelId);
        if (!row) return null;
        return this.rowToSummary(row, await this.countMessages(channelId));
    }

    async getMessages(channelId: string, opts: GetMessagesOptions = {}): Promise<ApiMessage[]> {
        const limit = clampLimit(opts.limit);
        const where: Record<string, unknown> = { channelId };
        if (opts.before) {
            const beforeRow = await DmMessage.findByPk(opts.before);
            if (!beforeRow || beforeRow.getDataValue('channelId') !== channelId) return [];
            where.createdAt = { [Op.lt]: beforeRow.getDataValue('createdAt') as string };
        }
        const rows = await DmMessage.findAll({ where, order: [['createdAt', 'DESC']], limit });
        return rows
            .reverse()
            .map(row => JSON.parse(row.getDataValue('data') as string) as ApiMessage);
    }

    private async countMessages(channelId: string): Promise<number> {
        return DmMessage.count({ where: { channelId } });
    }

    private rowToSummary(row: { getDataValue: (key: string) => unknown }, messageCount: number): DmChannelSummary {
        return {
            id: row.getDataValue('id') as string,
            recipient: {
                id: row.getDataValue('recipientId') as string,
                username: row.getDataValue('recipientUsername') as string,
                globalName: (row.getDataValue('recipientGlobalName') as string | null) ?? null,
                avatarUrl: (row.getDataValue('recipientAvatarUrl') as string | null) ?? null
            },
            lastMessageAt: (row.getDataValue('lastMessageAt') as string | null) ?? null,
            lastMessagePreview: (row.getDataValue('lastMessagePreview') as string | null) ?? null,
            messageCount
        };
    }
}

export const dmInboxService: DmInboxStore = new SqliteDmInbox();
