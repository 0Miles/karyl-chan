import { describe, expect, it, beforeEach } from 'vitest';
import { InMemoryDmInbox, type DmRecipient } from '../src/web/dm-inbox.service.js';
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

describe('InMemoryDmInbox', () => {
    let store: InMemoryDmInbox;

    beforeEach(() => {
        store = new InMemoryDmInbox();
    });

    it('upserting a channel without messages still surfaces it in the list', async () => {
        await store.upsertChannel('c1', RECIPIENT);
        const list = await store.listChannels();
        expect(list).toHaveLength(1);
        expect(list[0].id).toBe('c1');
        expect(list[0].messageCount).toBe(0);
        expect(list[0].lastMessageAt).toBeNull();
    });

    it('recording messages updates lastMessageAt and preview', async () => {
        await store.recordMessage('c1', RECIPIENT, makeMessage('m1', '2026-04-23T10:00:00.000Z', 'hello'));
        await store.recordMessage('c1', RECIPIENT, makeMessage('m2', '2026-04-23T11:00:00.000Z', 'world'));
        const ch = await store.getChannel('c1');
        expect(ch?.lastMessageAt).toBe('2026-04-23T11:00:00.000Z');
        expect(ch?.lastMessagePreview).toBe('world');
        expect(ch?.messageCount).toBe(2);
    });

    it('listChannels orders by lastMessageAt descending', async () => {
        await store.upsertChannel('c-old', { ...RECIPIENT, id: 'u-old' });
        await store.upsertChannel('c-new', { ...RECIPIENT, id: 'u-new' });
        await store.recordMessage('c-old', { ...RECIPIENT, id: 'u-old' }, makeMessage('m1', '2026-04-23T08:00:00.000Z'));
        await store.recordMessage('c-new', { ...RECIPIENT, id: 'u-new' }, makeMessage('m2', '2026-04-23T09:00:00.000Z'));
        const ids = (await store.listChannels()).map(c => c.id);
        expect(ids).toEqual(['c-new', 'c-old']);
    });

    it('getMessages returns only the last N sorted by createdAt ascending', async () => {
        for (let i = 1; i <= 15; i++) {
            const ts = new Date(Date.UTC(2026, 3, 23, 10, 0, i)).toISOString();
            await store.recordMessage('c1', RECIPIENT, makeMessage(`m${i.toString().padStart(2, '0')}`, ts));
        }
        const page = await store.getMessages('c1', { limit: 10 });
        expect(page).toHaveLength(10);
        expect(page[0].id).toBe('m06');
        expect(page[page.length - 1].id).toBe('m15');
    });

    it('getMessages with before returns older messages only', async () => {
        for (let i = 1; i <= 15; i++) {
            const ts = new Date(Date.UTC(2026, 3, 23, 10, 0, i)).toISOString();
            await store.recordMessage('c1', RECIPIENT, makeMessage(`m${i.toString().padStart(2, '0')}`, ts));
        }
        const older = await store.getMessages('c1', { limit: 10, before: 'm06' });
        expect(older).toHaveLength(5);
        expect(older[0].id).toBe('m01');
        expect(older[older.length - 1].id).toBe('m05');
    });

    it('getMessages with unknown before cursor returns empty', async () => {
        await store.recordMessage('c1', RECIPIENT, makeMessage('m1', '2026-04-23T10:00:00.000Z'));
        const empty = await store.getMessages('c1', { before: 'nope' });
        expect(empty).toEqual([]);
    });

    it('getMessages defaults to the 10 most recent when limit omitted', async () => {
        for (let i = 1; i <= 20; i++) {
            const ts = new Date(Date.UTC(2026, 3, 23, 10, 0, i)).toISOString();
            await store.recordMessage('c1', RECIPIENT, makeMessage(`m${i.toString().padStart(2, '0')}`, ts));
        }
        const page = await store.getMessages('c1');
        expect(page).toHaveLength(10);
        expect(page[0].id).toBe('m11');
    });

    it('updateMessage refreshes preview when the edited row is the latest', async () => {
        await store.recordMessage('c1', RECIPIENT, makeMessage('m1', '2026-04-23T10:00:00.000Z', 'hello'));
        expect(await store.updateMessage('c1', makeMessage('m1', '2026-04-23T10:00:00.000Z', 'hello edited'))).toBe(true);
        expect((await store.getChannel('c1'))?.lastMessagePreview).toBe('hello edited');
    });

    it('removeMessage decrements messageCount', async () => {
        await store.recordMessage('c1', RECIPIENT, makeMessage('m1', '2026-04-23T10:00:00.000Z'));
        expect(await store.removeMessage('c1', 'm1')).toBe(true);
        const ch = await store.getChannel('c1');
        expect(ch?.messageCount).toBe(0);
    });

    it('preview falls back to attachment, sticker, then embed when content is empty', async () => {
        await store.recordMessage('c1', RECIPIENT, {
            ...makeMessage('m1', '2026-04-23T10:00:00.000Z', ''),
            attachments: [{ id: 'a', filename: 'pic.png', url: '', size: 1 }]
        });
        expect((await store.getChannel('c1'))?.lastMessagePreview).toBe('📎 pic.png');
    });
});
