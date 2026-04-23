import { describe, expect, it, beforeEach } from 'vitest';
import { DmInboxService, type DmRecipient } from '../src/web/dm-inbox.service.js';
import type { Message as ApiMessage } from '../src/web/message-types.js';

const RECIPIENT: DmRecipient = {
    id: 'u1',
    username: 'alice',
    globalName: 'Alice',
    avatarUrl: null
};

function makeMessage(id: string, createdAt: string, content = `msg-${id}`): ApiMessage {
    return {
        id,
        channelId: 'c1',
        author: {
            id: 'u1',
            username: 'alice',
            globalName: 'Alice',
            avatarUrl: null
        },
        content,
        createdAt
    };
}

describe('DmInboxService', () => {
    let store: DmInboxService;

    beforeEach(() => {
        store = new DmInboxService();
    });

    it('upserting a channel without messages still surfaces it in the list', () => {
        store.upsertChannel('c1', RECIPIENT);
        const list = store.listChannels();
        expect(list).toHaveLength(1);
        expect(list[0].id).toBe('c1');
        expect(list[0].messageCount).toBe(0);
        expect(list[0].lastMessageAt).toBeNull();
    });

    it('recording messages updates lastMessageAt and preview', () => {
        const a = makeMessage('m1', '2026-04-23T10:00:00.000Z', 'hello');
        const b = makeMessage('m2', '2026-04-23T11:00:00.000Z', 'world');
        store.recordMessage('c1', RECIPIENT, a);
        store.recordMessage('c1', RECIPIENT, b);
        const ch = store.getChannel('c1');
        expect(ch?.lastMessageAt).toBe('2026-04-23T11:00:00.000Z');
        expect(ch?.lastMessagePreview).toBe('world');
        expect(ch?.messageCount).toBe(2);
    });

    it('listChannels orders by lastMessageAt descending', () => {
        store.upsertChannel('c-old', { ...RECIPIENT, id: 'u-old' });
        store.upsertChannel('c-new', { ...RECIPIENT, id: 'u-new' });
        store.recordMessage('c-old', { ...RECIPIENT, id: 'u-old' }, makeMessage('m1', '2026-04-23T08:00:00.000Z'));
        store.recordMessage('c-new', { ...RECIPIENT, id: 'u-new' }, makeMessage('m2', '2026-04-23T09:00:00.000Z'));
        const ids = store.listChannels().map(c => c.id);
        expect(ids).toEqual(['c-new', 'c-old']);
    });

    it('getMessages returns messages sorted by createdAt ascending', () => {
        store.recordMessage('c1', RECIPIENT, makeMessage('m2', '2026-04-23T11:00:00.000Z'));
        store.recordMessage('c1', RECIPIENT, makeMessage('m1', '2026-04-23T10:00:00.000Z'));
        const ids = store.getMessages('c1').map(m => m.id);
        expect(ids).toEqual(['m1', 'm2']);
    });

    it('updateMessage replaces content and refreshes preview when message is the latest', () => {
        const original = makeMessage('m1', '2026-04-23T10:00:00.000Z', 'hello');
        store.recordMessage('c1', RECIPIENT, original);
        const edited = { ...original, content: 'hello edited' };
        expect(store.updateMessage('c1', edited)).toBe(true);
        expect(store.getChannel('c1')?.lastMessagePreview).toBe('hello edited');
    });

    it('updateMessage returns false for unknown message', () => {
        expect(store.updateMessage('c1', makeMessage('m-x', '2026-04-23T10:00:00.000Z'))).toBe(false);
    });

    it('removeMessage drops the entry', () => {
        store.recordMessage('c1', RECIPIENT, makeMessage('m1', '2026-04-23T10:00:00.000Z'));
        expect(store.removeMessage('c1', 'm1')).toBe(true);
        expect(store.getMessages('c1')).toHaveLength(0);
    });

    it('preview falls back to attachment, sticker, then embed', () => {
        store.recordMessage('c1', RECIPIENT, {
            ...makeMessage('m1', '2026-04-23T10:00:00.000Z', ''),
            attachments: [{ id: 'a', filename: 'pic.png', url: '', size: 1 }]
        });
        expect(store.getChannel('c1')?.lastMessagePreview).toBe('📎 pic.png');
    });

    it('caps stored messages per channel at the maximum', () => {
        for (let i = 0; i < 250; i++) {
            const ts = new Date(Date.UTC(2026, 3, 23, 0, 0, i)).toISOString();
            store.recordMessage('c1', RECIPIENT, makeMessage(`m${i}`, ts));
        }
        expect(store.getChannel('c1')?.messageCount).toBe(200);
        const messages = store.getMessages('c1');
        expect(messages[0].id).toBe('m50');
        expect(messages[messages.length - 1].id).toBe('m249');
    });
});
