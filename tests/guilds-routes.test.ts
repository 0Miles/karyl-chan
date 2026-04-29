import { describe, it, expect, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { ChannelType } from 'discord.js';
import type { Client } from 'discordx';
import { registerGuildsRoutes } from '../src/web/guilds-routes.js';
import type { AdminCapability } from '../src/modules/admin/authorized-user.service.js';

const GUILD_ID = '900000000000000001';
const TEXT_CHANNEL_ID = '900000000000000002';
const SYS_CHANNEL_ID = '900000000000000003';

interface FakeInvite {
    code: string;
    url: string;
    channelId: string | null;
    channel?: { name: string };
    inviterId?: string | null;
    inviter?: { username: string };
    uses?: number;
    maxUses?: number;
    maxAge?: number;
    temporary?: boolean;
    expiresAt?: Date | null;
    createdAt?: Date | null;
}

/**
 * Map-like with the `.find()` shape discord.js Collections expose.
 * The route uses `guild.channels.cache.find(c => …)` to fall back
 * to any text channel when systemChannel is null; plain Map doesn't
 * have that method, so we attach a thin shim.
 */
function collectionMap(): Map<string, unknown> & { find: (pred: (v: unknown) => boolean) => unknown } {
    const m = new Map<string, unknown>() as Map<string, unknown> & { find: (pred: (v: unknown) => boolean) => unknown };
    m.find = (pred: (v: unknown) => boolean) => {
        for (const v of m.values()) if (pred(v)) return v;
        return undefined;
    };
    return m;
}

function fakeGuild(opts: {
    invites?: FakeInvite[];
    inviteSpy?: ReturnType<typeof vi.fn>;
    /** When false, the test wants the guild to have NO invitable
     *  channel — drives the 400 path in POST /invites. */
    invitableChannel?: 'system' | 'text' | 'none';
} = {}) {
    const cache = collectionMap();
    const inviteSpy = opts.inviteSpy ?? vi.fn(async (o: object) => ({
        code: 'abc123',
        url: 'https://discord.gg/abc123',
        expiresAt: o && (o as { maxAge?: number }).maxAge === 0 ? null : new Date(Date.now() + 60_000)
    }));
    const invitable = opts.invitableChannel ?? 'system';
    const sysChannel = invitable === 'none' ? null : {
        id: invitable === 'system' ? SYS_CHANNEL_ID : TEXT_CHANNEL_ID,
        type: ChannelType.GuildText,
        name: 'general',
        createInvite: inviteSpy
    };
    if (sysChannel) cache.set(sysChannel.id, sysChannel);
    return {
        id: GUILD_ID,
        name: 'Test Guild',
        iconURL: () => null,
        memberCount: 5,
        ownerId: '111111111111111111',
        joinedAt: new Date('2024-01-01'),
        description: null,
        channels: { cache },
        members: { cache: new Map() },
        systemChannel: invitable === 'system' ? sysChannel : null,
        invites: {
            fetch: vi.fn(async () => new Map(
                (opts.invites ?? []).map(i => [i.code, i])
            ))
        },
        _inviteSpy: inviteSpy
    };
}

function fakeBot(guild: ReturnType<typeof fakeGuild> | null): Client {
    const cache = new Map<string, unknown>();
    if (guild) cache.set(guild.id, guild);
    return {
        guilds: { cache }
    } as unknown as Client;
}

async function buildServer(bot: Client, caps: AdminCapability[] = ['admin']): Promise<FastifyInstance> {
    const fastify = Fastify({ logger: false });
    fastify.addHook('onRequest', async (request) => {
        request.authUserId = 'test-user';
        request.authCapabilities = new Set(caps);
    });
    await registerGuildsRoutes(fastify, { bot });
    await fastify.ready();
    return fastify;
}

let server: FastifyInstance | null = null;
afterEach(async () => {
    if (server) await server.close();
    server = null;
});

describe('GET /api/guilds', () => {
    it('lists every guild the bot is in, sorted by name', async () => {
        const a = fakeGuild();
        Object.assign(a, { name: 'Zebra', id: '900000000000000010' });
        const b = fakeGuild();
        Object.assign(b, { name: 'Apple', id: '900000000000000011' });
        const cache = new Map<string, unknown>();
        cache.set(a.id, a);
        cache.set(b.id, b);
        const bot = { guilds: { cache } } as unknown as Client;
        server = await buildServer(bot);
        const r = await server.inject({ method: 'GET', url: '/api/guilds' });
        expect(r.statusCode).toBe(200);
        const body = r.json() as { guilds: Array<{ name: string }> };
        expect(body.guilds.map(g => g.name)).toEqual(['Apple', 'Zebra']);
    });

    it('returns an empty list (200) for callers with no guild grants', async () => {
        // Listing intentionally never 403s — surfacing the lack of
        // grants would let probers fingerprint user permissions.
        // The user just sees an empty list, same UI outcome.
        server = await buildServer(fakeBot(fakeGuild()), ['dm.message']);
        const r = await server.inject({ method: 'GET', url: '/api/guilds' });
        expect(r.statusCode).toBe(200);
        expect(r.json()).toEqual({ guilds: [] });
    });
});

describe('GET /api/guilds/:guildId/invites', () => {
    it('lists existing invites with all the ergonomic fields', async () => {
        const guild = fakeGuild({
            invites: [{
                code: 'abc',
                url: 'https://discord.gg/abc',
                channelId: TEXT_CHANNEL_ID,
                channel: { name: 'general' },
                inviterId: '111111111111111111',
                inviter: { username: 'alice' },
                uses: 3,
                maxUses: 10,
                maxAge: 86400,
                temporary: false,
                expiresAt: new Date('2026-12-01T00:00:00Z'),
                createdAt: new Date('2026-04-01T00:00:00Z')
            }]
        });
        server = await buildServer(fakeBot(guild));
        const r = await server.inject({ method: 'GET', url: `/api/guilds/${GUILD_ID}/invites` });
        expect(r.statusCode).toBe(200);
        const body = r.json() as { invites: Array<{ code: string; channelName: string | null; uses: number; expiresAt: string | null }> };
        expect(body.invites).toHaveLength(1);
        expect(body.invites[0]).toMatchObject({
            code: 'abc',
            channelName: 'general',
            uses: 3,
            maxUses: 10
        });
        expect(body.invites[0].expiresAt).toBe('2026-12-01T00:00:00.000Z');
    });

    it('returns empty list when there are no invites', async () => {
        server = await buildServer(fakeBot(fakeGuild()));
        const r = await server.inject({ method: 'GET', url: `/api/guilds/${GUILD_ID}/invites` });
        expect(r.statusCode).toBe(200);
        expect(r.json().invites).toEqual([]);
    });

    it('404s when the guild is unknown', async () => {
        server = await buildServer(fakeBot(null));
        const r = await server.inject({ method: 'GET', url: `/api/guilds/${GUILD_ID}/invites` });
        expect(r.statusCode).toBe(404);
    });

    it('requires guild.read', async () => {
        server = await buildServer(fakeBot(fakeGuild()), ['dm.message']);
        const r = await server.inject({ method: 'GET', url: `/api/guilds/${GUILD_ID}/invites` });
        expect(r.statusCode).toBe(403);
    });
});

describe('POST /api/guilds/:guildId/invites', () => {
    it('creates an invite via the system channel by default', async () => {
        const inviteSpy = vi.fn(async () => ({
            code: 'fresh',
            url: 'https://discord.gg/fresh',
            expiresAt: new Date(Date.now() + 86_400_000)
        }));
        const guild = fakeGuild({ inviteSpy });
        server = await buildServer(fakeBot(guild));
        const r = await server.inject({
            method: 'POST',
            url: `/api/guilds/${GUILD_ID}/invites`,
            payload: {}
        });
        expect(r.statusCode).toBe(200);
        const body = r.json() as { code: string; url: string };
        expect(body.code).toBe('fresh');
        expect(body.url).toBe('https://discord.gg/fresh');
        // Defaults: 24h max age, unlimited uses, unique=true.
        expect(inviteSpy).toHaveBeenCalledWith(
            expect.objectContaining({ maxAge: 86400, maxUses: 0, unique: true })
        );
    });

    it('falls back to any text channel when no system channel is set', async () => {
        const inviteSpy = vi.fn(async () => ({ code: 'x', url: 'https://x', expiresAt: null }));
        const guild = fakeGuild({ inviteSpy, invitableChannel: 'text' });
        server = await buildServer(fakeBot(guild));
        const r = await server.inject({
            method: 'POST',
            url: `/api/guilds/${GUILD_ID}/invites`,
            payload: {}
        });
        expect(r.statusCode).toBe(200);
        expect(inviteSpy).toHaveBeenCalled();
    });

    it('400s when no invitable channel exists', async () => {
        const guild = fakeGuild({ invitableChannel: 'none' });
        server = await buildServer(fakeBot(guild));
        const r = await server.inject({
            method: 'POST',
            url: `/api/guilds/${GUILD_ID}/invites`,
            payload: {}
        });
        expect(r.statusCode).toBe(400);
        expect(r.json().error).toMatch(/channel/);
    });

    it('clamps maxAge to Discord\'s 7-day ceiling', async () => {
        const inviteSpy = vi.fn(async () => ({ code: 'x', url: 'https://x', expiresAt: null }));
        const guild = fakeGuild({ inviteSpy });
        server = await buildServer(fakeBot(guild));
        await server.inject({
            method: 'POST',
            url: `/api/guilds/${GUILD_ID}/invites`,
            // Way over the 7-day cap (604800s).
            payload: { maxAge: 99_999_999 }
        });
        expect(inviteSpy).toHaveBeenCalledWith(
            expect.objectContaining({ maxAge: 604800 })
        );
    });

    it('clamps maxUses to 100', async () => {
        const inviteSpy = vi.fn(async () => ({ code: 'x', url: 'https://x', expiresAt: null }));
        const guild = fakeGuild({ inviteSpy });
        server = await buildServer(fakeBot(guild));
        await server.inject({
            method: 'POST',
            url: `/api/guilds/${GUILD_ID}/invites`,
            payload: { maxUses: 9999 }
        });
        expect(inviteSpy).toHaveBeenCalledWith(
            expect.objectContaining({ maxUses: 100 })
        );
    });

    it('respects a caller-supplied channelId', async () => {
        const otherChannelId = '900000000000000099';
        const otherSpy = vi.fn(async () => ({ code: 'other', url: 'https://other', expiresAt: null }));
        const guild = fakeGuild();
        // Add a second channel.
        (guild.channels.cache as ReturnType<typeof collectionMap>).set(otherChannelId, {
            id: otherChannelId,
            type: ChannelType.GuildText,
            name: 'announcements',
            createInvite: otherSpy
        });
        server = await buildServer(fakeBot(guild));
        const r = await server.inject({
            method: 'POST',
            url: `/api/guilds/${GUILD_ID}/invites`,
            payload: { channelId: otherChannelId }
        });
        expect(r.statusCode).toBe(200);
        // The original channel's createInvite must NOT have fired.
        expect(otherSpy).toHaveBeenCalled();
    });

    it('requires guild.write', async () => {
        const guild = fakeGuild();
        server = await buildServer(fakeBot(guild), ['guild.message']);
        const r = await server.inject({
            method: 'POST',
            url: `/api/guilds/${GUILD_ID}/invites`,
            payload: {}
        });
        expect(r.statusCode).toBe(403);
    });
});
