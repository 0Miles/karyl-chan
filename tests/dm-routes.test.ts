import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Client } from 'discordx';
import { createWebServer } from '../src/web/server.js';
import { InMemoryDmInbox, type DmRecipient } from '../src/web/dm-inbox.service.js';

const RECIPIENT: DmRecipient = {
    id: 'u1',
    username: 'alice',
    globalName: 'Alice',
    avatarUrl: 'https://example.test/u1.png'
};

function fakeDmMessage(overrides: Record<string, unknown> = {}) {
    return {
        id: 'm-out',
        channelId: 'c1',
        guildId: null,
        content: 'hi',
        createdAt: new Date('2026-04-23T12:00:00.000Z'),
        editedAt: null,
        author: {
            id: 'bot1',
            username: 'karyl',
            globalName: 'Karyl',
            bot: true,
            displayAvatarURL: () => 'https://example.test/bot.png'
        },
        attachments: new Map(),
        reactions: { cache: new Map() },
        stickers: new Map(),
        embeds: [],
        reference: null,
        channel: { messages: { cache: new Map() } },
        mentions: { everyone: false },
        pinned: false,
        tts: false,
        ...overrides
    };
}

function fakeBot(channelImpl: Record<string, unknown>, opts: { userId?: string; userFetch?: (id: string) => Promise<unknown> } = {}): Client {
    return {
        user: { id: opts.userId ?? 'bot1' },
        channels: {
            fetch: vi.fn(async (id: string) => (id === 'c1' ? channelImpl : null))
        },
        users: {
            fetch: vi.fn(opts.userFetch ?? (async () => { throw new Error('not configured'); }))
        },
        isReady: () => true,
        guilds: { cache: { size: 0 } },
        uptime: 0
    } as unknown as Client;
}

describe('DM routes', () => {
    const originalOwnerId = process.env.BOT_OWNER_ID;
    beforeAll(() => { delete process.env.BOT_OWNER_ID; });
    afterAll(() => {
        if (originalOwnerId === undefined) delete process.env.BOT_OWNER_ID;
        else process.env.BOT_OWNER_ID = originalOwnerId;
    });

    let server: FastifyInstance;
    let inbox: InMemoryDmInbox;

    afterEach(async () => {
        if (server) await server.close();
    });

    beforeEach(() => {
        inbox = new InMemoryDmInbox();
    });

    it('GET /api/dm/channels lists everything in the inbox', async () => {
        await inbox.upsertChannel('c1', RECIPIENT);
        await inbox.recordMessage('c1', RECIPIENT, {
            id: 'm1', channelId: 'c1', author: { id: 'u1', username: 'alice', globalName: 'Alice', avatarUrl: null },
            content: 'hello', createdAt: '2026-04-23T10:00:00.000Z'
        });
        const bot = fakeBot({});
        server = await createWebServer({ staticRoot: undefined, bot, dmInbox: inbox });
        await server.ready();

        const response = await server.inject({ method: 'GET', url: '/api/dm/channels' });
        expect(response.statusCode).toBe(200);
        const body = response.json();
        expect(body.channels).toHaveLength(1);
        expect(body.channels[0].id).toBe('c1');
        expect(body.channels[0].lastMessagePreview).toBe('hello');
    });

    it('GET messages returns 404 for unknown channel', async () => {
        const bot = fakeBot({});
        server = await createWebServer({ staticRoot: undefined, bot, dmInbox: inbox });
        await server.ready();
        const response = await server.inject({ method: 'GET', url: '/api/dm/channels/c-unknown/messages' });
        expect(response.statusCode).toBe(404);
    });

    it('GET messages returns the cached list ordered by createdAt', async () => {
        await inbox.recordMessage('c1', RECIPIENT, {
            id: 'm2', channelId: 'c1',
            author: { id: 'u1', username: 'alice', globalName: 'Alice', avatarUrl: null },
            content: 'second', createdAt: '2026-04-23T11:00:00.000Z'
        });
        await inbox.recordMessage('c1', RECIPIENT, {
            id: 'm1', channelId: 'c1',
            author: { id: 'u1', username: 'alice', globalName: 'Alice', avatarUrl: null },
            content: 'first', createdAt: '2026-04-23T10:00:00.000Z'
        });
        const bot = fakeBot({});
        server = await createWebServer({ staticRoot: undefined, bot, dmInbox: inbox });
        await server.ready();
        const response = await server.inject({ method: 'GET', url: '/api/dm/channels/c1/messages' });
        const body = response.json();
        expect(body.messages.map((m: { id: string }) => m.id)).toEqual(['m1', 'm2']);
    });

    it('POST sends a DM and returns the mapped message', async () => {
        const send = vi.fn(async () => fakeDmMessage({ content: 'pong' }));
        const channel = { id: 'c1', type: 1, send };
        const bot = fakeBot(channel);
        server = await createWebServer({ staticRoot: undefined, bot, dmInbox: inbox });
        await server.ready();

        const response = await server.inject({
            method: 'POST',
            url: '/api/dm/channels/c1/messages',
            payload: { content: 'pong' }
        });
        expect(response.statusCode).toBe(200);
        expect(response.json().message.content).toBe('pong');
        expect(send).toHaveBeenCalledWith({ content: 'pong', reply: undefined });
    });

    it('POST refuses empty content', async () => {
        const channel = { id: 'c1', type: 1, send: vi.fn() };
        const bot = fakeBot(channel);
        server = await createWebServer({ staticRoot: undefined, bot, dmInbox: inbox });
        await server.ready();
        const response = await server.inject({
            method: 'POST',
            url: '/api/dm/channels/c1/messages',
            payload: { content: '   ' }
        });
        expect(response.statusCode).toBe(400);
    });

    it('POST attaches reply reference when replyToMessageId is provided', async () => {
        const send = vi.fn(async () => fakeDmMessage());
        const channel = { id: 'c1', type: 1, send };
        const bot = fakeBot(channel);
        server = await createWebServer({ staticRoot: undefined, bot, dmInbox: inbox });
        await server.ready();
        await server.inject({
            method: 'POST',
            url: '/api/dm/channels/c1/messages',
            payload: { content: 'reply', replyToMessageId: 'm-prev' }
        });
        expect(send).toHaveBeenCalledWith({
            content: 'reply',
            reply: { messageReference: 'm-prev', failIfNotExists: false }
        });
    });

    it('POST /api/dm/channels starts a new DM via users.fetch + createDM', async () => {
        const userFetch = vi.fn(async () => ({
            id: 'u-new',
            username: 'bob',
            globalName: 'Bob',
            displayAvatarURL: () => 'https://example.test/u-new.png',
            createDM: async () => ({ id: 'c-new' })
        }));
        const bot = fakeBot({}, { userFetch });
        server = await createWebServer({ staticRoot: undefined, bot, dmInbox: inbox });
        await server.ready();

        const response = await server.inject({
            method: 'POST',
            url: '/api/dm/channels',
            payload: { recipientUserId: 'u-new' }
        });
        expect(response.statusCode).toBe(200);
        expect(response.json().channel.id).toBe('c-new');
        expect((await inbox.getChannel('c-new'))?.recipient.username).toBe('bob');
    });

    it('POST reaction calls message.react with the resolvable form', async () => {
        const react = vi.fn(async () => undefined);
        const message = {
            ...fakeDmMessage(),
            id: 'm-x',
            react,
            reactions: { cache: new Map() }
        };
        const channel = { id: 'c1', type: 1, messages: { fetch: vi.fn(async () => message) } };
        const bot = fakeBot(channel);
        server = await createWebServer({ staticRoot: undefined, bot, dmInbox: inbox });
        await server.ready();
        const response = await server.inject({
            method: 'POST',
            url: '/api/dm/channels/c1/messages/m-x/reactions',
            payload: { emoji: { id: null, name: '👍' } }
        });
        expect(response.statusCode).toBe(204);
        expect(react).toHaveBeenCalledWith('👍');
    });

    it('POST custom emoji reaction uses name:id resolvable', async () => {
        const react = vi.fn(async () => undefined);
        const message = { ...fakeDmMessage(), id: 'm-y', react, reactions: { cache: new Map() } };
        const channel = { id: 'c1', type: 1, messages: { fetch: vi.fn(async () => message) } };
        const bot = fakeBot(channel);
        server = await createWebServer({ staticRoot: undefined, bot, dmInbox: inbox });
        await server.ready();
        await server.inject({
            method: 'POST',
            url: '/api/dm/channels/c1/messages/m-y/reactions',
            payload: { emoji: { id: '123', name: 'pog' } }
        });
        expect(react).toHaveBeenCalledWith('pog:123');
    });

    it('DELETE reaction removes the bot user from the cached reaction', async () => {
        const usersRemove = vi.fn(async () => undefined);
        const reactionsCache = new Map();
        reactionsCache.set('👍', {
            emoji: { id: null, name: '👍', animated: false },
            count: 1,
            me: true,
            users: { remove: usersRemove }
        });
        const message = { ...fakeDmMessage(), id: 'm-z', reactions: { cache: reactionsCache } };
        const channel = { id: 'c1', type: 1, messages: { fetch: vi.fn(async () => message) } };
        const bot = fakeBot(channel);
        server = await createWebServer({ staticRoot: undefined, bot, dmInbox: inbox });
        await server.ready();
        const response = await server.inject({
            method: 'DELETE',
            url: '/api/dm/channels/c1/messages/m-z/reactions',
            payload: { emoji: { id: null, name: '👍' } }
        });
        expect(response.statusCode).toBe(204);
        expect(usersRemove).toHaveBeenCalledWith('bot1');
    });
});
