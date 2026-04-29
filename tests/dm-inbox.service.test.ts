import { describe, expect, it, beforeEach } from 'vitest';
import { InMemoryDmInbox, type DmRecipient } from '../src/modules/dm-inbox/dm-inbox.service.js';
import type { Message as ApiMessage } from '../src/modules/web-core/message-types.js';

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
        author: { id: 'u1', username: 'alice', globalName: 'Alice', avatarUrl: null },
        content,
        createdAt
    };
}

describe('InMemoryDmInbox', () => {
    let store: InMemoryDmInbox;

    beforeEach(() => {
        store = new InMemoryDmInbox();
    });

    it('upsertChannel records the recipient and surfaces it in the list', async () => {
        await store.upsertChannel('c1', RECIPIENT);
        const list = await store.listChannels();
        expect(list).toHaveLength(1);
        expect(list[0].id).toBe('c1');
        expect(list[0].lastMessageAt).toBeNull();
    });

    it('recordActivity updates lastMessageAt and preview when newer', async () => {
        await store.recordActivity('c1', RECIPIENT, makeMessage('m1', '2026-04-23T10:00:00.000Z', 'hello'));
        await store.recordActivity('c1', RECIPIENT, makeMessage('m2', '2026-04-23T11:00:00.000Z', 'world'));
        const ch = await store.getChannel('c1');
        expect(ch?.lastMessageAt).toBe('2026-04-23T11:00:00.000Z');
        expect(ch?.lastMessagePreview).toBe('world');
    });

    it('recordActivity does not overwrite when an older message arrives later', async () => {
        await store.recordActivity('c1', RECIPIENT, makeMessage('m2', '2026-04-23T11:00:00.000Z', 'newer'));
        await store.recordActivity('c1', RECIPIENT, makeMessage('m1', '2026-04-23T10:00:00.000Z', 'older'));
        const ch = await store.getChannel('c1');
        expect(ch?.lastMessageAt).toBe('2026-04-23T11:00:00.000Z');
        expect(ch?.lastMessagePreview).toBe('newer');
    });

    it('listChannels orders by lastMessageAt descending', async () => {
        await store.recordActivity('c-old', { ...RECIPIENT, id: 'u-old' }, makeMessage('m-old', '2026-04-23T08:00:00.000Z'));
        await store.recordActivity('c-new', { ...RECIPIENT, id: 'u-new' }, makeMessage('m-new', '2026-04-23T09:00:00.000Z'));
        const ids = (await store.listChannels()).map(c => c.id);
        expect(ids).toEqual(['c-new', 'c-old']);
    });

    it('preview falls back to attachment when content is empty', async () => {
        await store.recordActivity('c1', RECIPIENT, {
            ...makeMessage('m1', '2026-04-23T10:00:00.000Z', ''),
            attachments: [{ id: 'a', filename: 'pic.png', url: '', size: 1 }]
        });
        expect((await store.getChannel('c1'))?.lastMessagePreview).toBe('📎 pic.png');
    });

    it('getChannel returns null for unknown channel', async () => {
        expect(await store.getChannel('nope')).toBeNull();
    });
});
