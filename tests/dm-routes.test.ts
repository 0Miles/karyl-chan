import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Client } from 'discordx';
import { createWebServer } from '../src/web/server.js';
import { InMemoryDmInbox, type DmRecipient } from '../src/web/dm-inbox.service.js';
import { DmEventBus } from '../src/web/dm-event-bus.js';

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
        createdTimestamp: new Date('2026-04-23T12:00:00.000Z').getTime(),
        editedAt: null,
        author: {
            id: '111111111111111111',
            username: 'karyl',
            globalName: 'Karyl',
            bot: true,
            avatar: null
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
    let eventBus: DmEventBus;

    afterEach(async () => {
        if (server) await server.close();
    });

    beforeEach(() => {
        inbox = new InMemoryDmInbox();
        eventBus = new DmEventBus();
    });

    it('GET /api/dm/channels lists everything tracked in the inbox', async () => {
        await inbox.upsertChannel('c1', RECIPIENT);
        const bot = fakeBot({});
        server = await createWebServer({ staticRoot: undefined, bot, dmInbox: inbox });
        await server.ready();

        const response = await server.inject({ method: 'GET', url: '/api/dm/channels' });
        expect(response.statusCode).toBe(200);
        expect(response.json().channels).toHaveLength(1);
    });

    it('GET messages returns 404 when the inbox does not know the channel', async () => {
        const bot = fakeBot({});
        server = await createWebServer({ staticRoot: undefined, bot, dmInbox: inbox });
        await server.ready();
        const response = await server.inject({ method: 'GET', url: '/api/dm/channels/c-unknown/messages' });
        expect(response.statusCode).toBe(404);
    });

    it('GET messages forwards limit and before to channel.messages.fetch', async () => {
        await inbox.upsertChannel('c1', RECIPIENT);
        const fetched = new Map();
        fetched.set('m1', fakeDmMessage({ id: 'm1', createdTimestamp: 1, content: 'first' }));
        fetched.set('m2', fakeDmMessage({ id: 'm2', createdTimestamp: 2, content: 'second' }));
        const messagesFetch = vi.fn(async () => fetched);
        const channel = { id: 'c1', type: 1, messages: { fetch: messagesFetch } };
        const bot = fakeBot(channel);
        server = await createWebServer({ staticRoot: undefined, bot, dmInbox: inbox });
        await server.ready();

        const response = await server.inject({
            method: 'GET',
            url: '/api/dm/channels/c1/messages?limit=5&before=m99'
        });
        expect(response.statusCode).toBe(200);
        expect(messagesFetch).toHaveBeenCalledWith({ limit: 5, before: 'm99' });
        const body = response.json();
        expect(body.messages.map((m: { id: string }) => m.id)).toEqual(['m1', 'm2']);
        expect(body.hasMore).toBe(false);
    });

    it('POST sends a JSON DM and returns the mapped message', async () => {
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
        expect(send).toHaveBeenCalledWith({ content: 'pong', files: undefined, reply: undefined });
    });

    it('POST refuses an empty body with no attachments', async () => {
        const send = vi.fn();
        const channel = { id: 'c1', type: 1, send };
        const bot = fakeBot(channel);
        server = await createWebServer({ staticRoot: undefined, bot, dmInbox: inbox });
        await server.ready();
        const response = await server.inject({
            method: 'POST',
            url: '/api/dm/channels/c1/messages',
            payload: { content: '   ' }
        });
        expect(response.statusCode).toBe(400);
        expect(send).not.toHaveBeenCalled();
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
            files: undefined,
            reply: { messageReference: 'm-prev', failIfNotExists: false }
        });
    });

    it('POST /api/dm/channels starts a new DM and emits channel-touched', async () => {
        const userFetch = vi.fn(async () => ({
            id: '222222222222222222',
            username: 'bob',
            globalName: 'Bob',
            avatar: null,
            createDM: async () => ({ id: 'c-new' })
        }));
        const bot = fakeBot({}, { userFetch });
        server = await createWebServer({ staticRoot: undefined, bot, dmInbox: inbox });
        await server.ready();

        const events: unknown[] = [];
        const restoreBus = (server as unknown as { _testBus?: () => void });
        void restoreBus;

        const response = await server.inject({
            method: 'POST',
            url: '/api/dm/channels',
            payload: { recipientUserId: 'u-new' }
        });
        expect(response.statusCode).toBe(200);
        expect((await inbox.getChannel('c-new'))?.recipient.username).toBe('bob');
        // events array intentionally unchecked: createWebServer used the
        // module-level singleton bus; covered by direct route+bus tests below.
        void events;
    });

    it('POST reaction calls message.react with the resolvable form', async () => {
        const react = vi.fn(async () => undefined);
        const message = { ...fakeDmMessage(), id: 'm-x', react, reactions: { cache: new Map() } };
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

    describe('DmEventBus integration', () => {
        it('publishes channel-touched when a new DM is started through the route', async () => {
            const userFetch = vi.fn(async () => ({
                id: '333333333333333333',
                username: 'x',
                globalName: null,
                avatar: null,
                createDM: async () => ({ id: 'c-x' })
            }));
            const bot = fakeBot({}, { userFetch });
            const seen: string[] = [];
            eventBus.subscribe(e => seen.push(e.type));
            // Manually invoke the route registration with our injected bus.
            const { registerDmRoutes } = await import('../src/web/dm-routes.js');
            const fastify = (await import('fastify')).default();
            await registerDmRoutes(fastify, { bot, inbox, eventBus });
            await fastify.ready();
            try {
                const r = await fastify.inject({
                    method: 'POST',
                    url: '/api/dm/channels',
                    payload: { recipientUserId: 'u-x' }
                });
                expect(r.statusCode).toBe(200);
            } finally {
                await fastify.close();
            }
            expect(seen).toContain('channel-touched');
        });
    });
});
