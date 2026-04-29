import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyMultipart from '@fastify/multipart';
import { ChannelType } from 'discord.js';
import type { Client } from 'discordx';
import { registerGuildChannelRoutes } from '../src/web/guild-channel-routes.js';
import { GuildChannelEventBus } from '../src/web/guild-channel-event-bus.js';
import type { AdminCapability } from '../src/modules/admin/authorized-user.service.js';

const GUILD_ID = '900000000000000001';
const CHANNEL_ID = '900000000000000002';
const FORUM_ID = '900000000000000003';
const VOICE_ID = '900000000000000004';
const STAGE_ID = '900000000000000005';
const CAT_ID = '900000000000000006';
const POST_ID = '900000000000000007';
const THREAD_ID = '900000000000000008';
const MESSAGE_ID = '900000000000000009';

/**
 * Fake guild builder. Returns just enough surface to satisfy the
 * route handlers' duck-typing — discord.js's real types are massive
 * and we only ever read a handful of fields per route.
 */
function fakeGuild(opts: {
    voice?: boolean;
    forum?: boolean;
    activeThreads?: Array<{ id: string; name: string; parentId: string | null }>;
    fetchPinned?: () => Promise<Map<string, unknown>>;
    pinChannel?: { messages: { fetchPinned: () => Promise<Map<string, unknown>> } };
    forumThreads?: Array<{ id: string; name: string; messageCount?: number; archived?: boolean }>;
} = {}) {
    const cache = new Map<string, unknown>();
    cache.set(CAT_ID, { id: CAT_ID, name: 'Voice cat', type: ChannelType.GuildCategory, position: 0 });
    cache.set(CHANNEL_ID, {
        id: CHANNEL_ID,
        name: 'general',
        type: ChannelType.GuildText,
        position: 0,
        parentId: null,
        guildId: GUILD_ID,
        lastMessageId: null,
        messages: opts.pinChannel?.messages ?? { fetchPinned: vi.fn(async () => new Map()) }
    });
    if (opts.voice) {
        cache.set(VOICE_ID, {
            id: VOICE_ID,
            name: 'general voice',
            type: ChannelType.GuildVoice,
            position: 0,
            parentId: CAT_ID,
            members: new Map([
                [
                    '800000000000000001',
                    { id: '800000000000000001', user: { username: 'alice', globalName: 'Alice', avatar: null }, nickname: null, avatar: null }
                ]
            ])
        });
        cache.set(STAGE_ID, {
            id: STAGE_ID,
            name: 'town hall',
            type: ChannelType.GuildStageVoice,
            position: 1,
            parentId: CAT_ID,
            members: new Map()
        });
    }
    if (opts.forum) {
        cache.set(FORUM_ID, {
            id: FORUM_ID,
            name: 'help-forum',
            type: ChannelType.GuildForum,
            position: 5,
            parentId: null,
            threads: {
                fetchActive: vi.fn(async () => ({
                    threads: new Map(
                        (opts.forumThreads ?? []).map(t => [t.id, {
                            id: t.id,
                            name: t.name,
                            messageCount: t.messageCount ?? 0,
                            archived: !!t.archived
                        }])
                    )
                }))
            }
        });
    }

    return {
        id: GUILD_ID,
        channels: {
            cache,
            // discord.js Collection-like .filter not used by routes;
            // they iterate via [...cache.values()].
            fetchActiveThreads: vi.fn(async () => ({
                threads: new Map(
                    (opts.activeThreads ?? []).map(t => [t.id, {
                        id: t.id,
                        name: t.name,
                        parentId: t.parentId,
                        archived: false,
                        locked: false,
                        memberCount: 0,
                        messageCount: 0,
                        lastMessageId: null
                    }])
                )
            }))
        },
        memberCount: 0,
        members: { cache: new Map() }
    };
}

function fakeBot(guild: ReturnType<typeof fakeGuild> | null): Client {
    const cache = new Map<string, unknown>();
    if (guild) cache.set(guild.id, guild);
    return {
        user: { id: 'bot-self' },
        guilds: { cache },
        users: { fetch: vi.fn() }
    } as unknown as Client;
}

async function buildServer(bot: Client, caps: AdminCapability[] = ['admin']): Promise<FastifyInstance> {
    const fastify = Fastify({ logger: false });
    fastify.addHook('onRequest', async (request) => {
        request.authUserId = 'test-user';
        request.authCapabilities = new Set(caps);
    });
    // Routes call `request.isMultipart()` on POST; the helper only
    // exists when the multipart plugin is registered. Without it the
    // call throws and fastify wraps it as a 500.
    await fastify.register(fastifyMultipart);
    await registerGuildChannelRoutes(fastify, { bot, eventBus: new GuildChannelEventBus() });
    await fastify.ready();
    return fastify;
}

let server: FastifyInstance | null = null;
afterEach(async () => {
    if (server) await server.close();
    server = null;
});

describe('GET /api/guilds/:guildId/voice-channels', () => {
    it('returns voice + stage channels grouped by category', async () => {
        const guild = fakeGuild({ voice: true });
        server = await buildServer(fakeBot(guild));
        const r = await server.inject({
            method: 'GET',
            url: `/api/guilds/${GUILD_ID}/voice-channels`
        });
        expect(r.statusCode).toBe(200);
        const body = r.json() as { categories: Array<{ name: string | null; channels: Array<{ id: string; type: string; members: { id: string }[] }> }> };
        const cat = body.categories.find(c => c.name === 'Voice cat');
        expect(cat).toBeDefined();
        expect(cat!.channels.map(c => c.id).sort()).toEqual([STAGE_ID, VOICE_ID].sort());
        const voice = cat!.channels.find(c => c.id === VOICE_ID)!;
        expect(voice.type).toBe('voice');
        expect(voice.members[0].id).toBe('800000000000000001');
        const stage = cat!.channels.find(c => c.id === STAGE_ID)!;
        expect(stage.type).toBe('stage');
    });

    it('404s when the guild is unknown', async () => {
        server = await buildServer(fakeBot(null));
        const r = await server.inject({
            method: 'GET',
            url: `/api/guilds/${GUILD_ID}/voice-channels`
        });
        expect(r.statusCode).toBe(404);
    });

    it('requires guild.read', async () => {
        server = await buildServer(fakeBot(fakeGuild()), ['dm.message']);
        const r = await server.inject({
            method: 'GET',
            url: `/api/guilds/${GUILD_ID}/voice-channels`
        });
        expect(r.statusCode).toBe(403);
    });
});

describe('GET /api/guilds/:guildId/active-threads', () => {
    it('lists active threads with parentId for client-side grouping', async () => {
        const guild = fakeGuild({
            activeThreads: [
                { id: THREAD_ID, name: 'discussion', parentId: CHANNEL_ID }
            ]
        });
        server = await buildServer(fakeBot(guild));
        const r = await server.inject({
            method: 'GET',
            url: `/api/guilds/${GUILD_ID}/active-threads`
        });
        expect(r.statusCode).toBe(200);
        const body = r.json() as { threads: Array<{ id: string; parentId: string }> };
        expect(body.threads).toHaveLength(1);
        expect(body.threads[0].id).toBe(THREAD_ID);
        expect(body.threads[0].parentId).toBe(CHANNEL_ID);
    });

    it('returns empty list when no active threads', async () => {
        server = await buildServer(fakeBot(fakeGuild()));
        const r = await server.inject({
            method: 'GET',
            url: `/api/guilds/${GUILD_ID}/active-threads`
        });
        expect(r.statusCode).toBe(200);
        expect(r.json().threads).toEqual([]);
    });

    it('requires guild.read', async () => {
        server = await buildServer(fakeBot(fakeGuild()), ['dm.message']);
        const r = await server.inject({
            method: 'GET',
            url: `/api/guilds/${GUILD_ID}/active-threads`
        });
        expect(r.statusCode).toBe(403);
    });
});

describe('GET /api/guilds/:guildId/forums', () => {
    it('lists forums with their active posts', async () => {
        const guild = fakeGuild({
            forum: true,
            forumThreads: [{ id: POST_ID, name: 'How do I…', messageCount: 7 }]
        });
        server = await buildServer(fakeBot(guild));
        const r = await server.inject({
            method: 'GET',
            url: `/api/guilds/${GUILD_ID}/forums`
        });
        expect(r.statusCode).toBe(200);
        const body = r.json() as { forums: Array<{ id: string; name: string; posts: Array<{ id: string; messageCount: number }> }> };
        expect(body.forums).toHaveLength(1);
        expect(body.forums[0].id).toBe(FORUM_ID);
        expect(body.forums[0].posts).toEqual([{ id: POST_ID, name: 'How do I…', messageCount: 7, archived: false }]);
    });

    it('skips forums where fetchActive throws (warns but continues)', async () => {
        const guild = fakeGuild({ forum: true });
        // Simulate a permission error from Discord.
        const forumChannel = guild.channels.cache.get(FORUM_ID) as { threads: { fetchActive: () => Promise<unknown> } };
        forumChannel.threads.fetchActive = vi.fn(async () => { throw new Error('Missing Permissions'); });
        server = await buildServer(fakeBot(guild));
        const r = await server.inject({
            method: 'GET',
            url: `/api/guilds/${GUILD_ID}/forums`
        });
        expect(r.statusCode).toBe(200);
        const body = r.json() as { forums: Array<{ id: string; posts: unknown[] }> };
        // The forum is still listed, just with an empty post list —
        // failure to fetch posts shouldn't drop the forum entirely.
        expect(body.forums).toHaveLength(1);
        expect(body.forums[0].posts).toEqual([]);
    });

    it('requires guild.read', async () => {
        server = await buildServer(fakeBot(fakeGuild({ forum: true })), ['dm.message']);
        const r = await server.inject({
            method: 'GET',
            url: `/api/guilds/${GUILD_ID}/forums`
        });
        expect(r.statusCode).toBe(403);
    });
});

describe('GET /api/guilds/:guildId/text-channels/:channelId/pins', () => {
    it('returns mapped pinned messages sorted oldest-first', async () => {
        const fakePin = (id: string, ts: number) => ({
            id,
            channelId: CHANNEL_ID,
            guildId: GUILD_ID,
            content: `pin-${id}`,
            createdAt: new Date(ts),
            createdTimestamp: ts,
            editedAt: null,
            author: { id: '1', username: 'a', globalName: null, bot: false, avatar: null },
            attachments: new Map(),
            reactions: { cache: new Map() },
            stickers: new Map(),
            embeds: [],
            reference: null,
            channel: { messages: { cache: new Map() } },
            mentions: { everyone: false },
            pinned: true,
            tts: false
        });
        const guild = fakeGuild();
        const channel = guild.channels.cache.get(CHANNEL_ID) as { messages: { fetchPinned: () => Promise<Map<string, unknown>> } };
        channel.messages.fetchPinned = vi.fn(async () => new Map([
            ['m-2', fakePin('m-2', 200)],
            ['m-1', fakePin('m-1', 100)]
        ]));
        server = await buildServer(fakeBot(guild));
        const r = await server.inject({
            method: 'GET',
            url: `/api/guilds/${GUILD_ID}/text-channels/${CHANNEL_ID}/pins`
        });
        expect(r.statusCode).toBe(200);
        const body = r.json() as { messages: Array<{ id: string }> };
        expect(body.messages.map(m => m.id)).toEqual(['m-1', 'm-2']);
    });

    it('404s when the channel does not exist', async () => {
        server = await buildServer(fakeBot(fakeGuild()));
        const r = await server.inject({
            method: 'GET',
            url: `/api/guilds/${GUILD_ID}/text-channels/${MESSAGE_ID}/pins`
        });
        expect(r.statusCode).toBe(404);
    });
});

describe('GET /reactions/users', () => {
    it('rejects a non-snowflake messageId before hitting Discord', async () => {
        const guild = fakeGuild();
        server = await buildServer(fakeBot(guild));
        const r = await server.inject({
            method: 'GET',
            url: `/api/guilds/${GUILD_ID}/text-channels/${CHANNEL_ID}/messages/not-a-snowflake/reactions/users?emojiName=%F0%9F%91%8D`
        });
        expect(r.statusCode).toBe(400);
        expect(r.json().error).toMatch(/messageId/);
    });

    it('rejects when emojiName/emojiId are both missing', async () => {
        const guild = fakeGuild();
        server = await buildServer(fakeBot(guild));
        const r = await server.inject({
            method: 'GET',
            url: `/api/guilds/${GUILD_ID}/text-channels/${CHANNEL_ID}/messages/${MESSAGE_ID}/reactions/users`
        });
        expect(r.statusCode).toBe(400);
        expect(r.json().error).toMatch(/emoji/);
    });

    it('returns empty list when the reaction isn\'t cached on the message', async () => {
        const guild = fakeGuild();
        const channel = guild.channels.cache.get(CHANNEL_ID) as { messages: { fetch: (id: string) => Promise<{ reactions: { cache: Map<string, unknown> } }> } };
        channel.messages.fetch = vi.fn(async () => ({
            reactions: { cache: new Map() }
        }));
        server = await buildServer(fakeBot(guild));
        const r = await server.inject({
            method: 'GET',
            url: `/api/guilds/${GUILD_ID}/text-channels/${CHANNEL_ID}/messages/${MESSAGE_ID}/reactions/users?emojiName=%F0%9F%91%8D`
        });
        expect(r.statusCode).toBe(200);
        expect(r.json().users).toEqual([]);
    });
});

describe('message validation guards', () => {
    it('PATCH messages rejects an invalid messageId before hitting Discord', async () => {
        server = await buildServer(fakeBot(fakeGuild()));
        const r = await server.inject({
            method: 'PATCH',
            url: `/api/guilds/${GUILD_ID}/text-channels/${CHANNEL_ID}/messages/bad-id`,
            payload: { content: 'edit' }
        });
        expect(r.statusCode).toBe(400);
    });

    it('PATCH messages rejects content over 2000 chars', async () => {
        const guild = fakeGuild();
        const channel = guild.channels.cache.get(CHANNEL_ID) as { messages: { fetch?: (id: string) => Promise<unknown> } };
        // Stub `fetch` so we can confirm it's NEVER called when content
        // exceeds the limit (the validation must short-circuit).
        const fetchSpy = vi.fn();
        channel.messages.fetch = fetchSpy;
        server = await buildServer(fakeBot(guild));
        const r = await server.inject({
            method: 'PATCH',
            url: `/api/guilds/${GUILD_ID}/text-channels/${CHANNEL_ID}/messages/${MESSAGE_ID}`,
            payload: { content: 'x'.repeat(2001) }
        });
        expect(r.statusCode).toBe(400);
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('DELETE messages rejects an invalid messageId before hitting Discord', async () => {
        server = await buildServer(fakeBot(fakeGuild()));
        const r = await server.inject({
            method: 'DELETE',
            url: `/api/guilds/${GUILD_ID}/text-channels/${CHANNEL_ID}/messages/bad-id`
        });
        expect(r.statusCode).toBe(400);
    });

    it('POST messages rejects bogus sticker ids without dispatching', async () => {
        const guild = fakeGuild();
        const channel = guild.channels.cache.get(CHANNEL_ID) as { send?: () => Promise<unknown> };
        const sendSpy = vi.fn();
        channel.send = sendSpy;
        server = await buildServer(fakeBot(guild));
        const r = await server.inject({
            method: 'POST',
            url: `/api/guilds/${GUILD_ID}/text-channels/${CHANNEL_ID}/messages`,
            payload: { content: 'hi', stickerIds: ['not-a-snowflake'] }
        });
        expect(r.statusCode).toBe(400);
        expect(sendSpy).not.toHaveBeenCalled();
    });
});
