import type { FastifyInstance } from 'fastify';
import type { Client } from 'discordx';
import { ChannelType, PermissionFlagsBits, type CategoryChannel, type EmojiIdentifierResolvable, type TextChannel } from 'discord.js';
import { guildChannelEventBus, type GuildChannelEventBus } from './guild-channel-event-bus.js';
import { avatarUrlFor, guildAvatarUrlFor, toApiMessage } from './message-mapper.js';
import type { MessageEmoji } from './message-types.js';
import { guildAccessFilter, requireGuildCapability } from './route-guards.js';
import { hasGuildCapability } from '../permission/admin-capabilities.js';
import type { AdminCapability } from './authorized-user.service.js';
import { DISCORD_MESSAGE_MAX, isSnowflake } from './validators.js';

export interface GuildChannelRoutesOptions {
    bot: Client;
    eventBus?: GuildChannelEventBus;
}

interface ReactionBody {
    emoji?: { id?: string | null; name?: string; animated?: boolean };
}

interface ThreadLike {
    id: string;
    name: string;
    parentId?: string | null;
    archived?: boolean | null;
    locked?: boolean | null;
    memberCount?: number | null;
    messageCount?: number | null;
    lastMessageId?: string | null;
}

function threadRow(t: ThreadLike) {
    return {
        id: t.id,
        name: t.name,
        parentId: t.parentId ?? null,
        archived: !!t.archived,
        locked: !!t.locked,
        memberCount: t.memberCount ?? 0,
        messageCount: t.messageCount ?? 0,
        lastMessageId: t.lastMessageId ?? null
    };
}

function emojiResolvable(emoji: MessageEmoji): EmojiIdentifierResolvable | null {
    if (!emoji.id && !emoji.name) return null;
    if (emoji.id) return `${emoji.name || '_'}:${emoji.id}`;
    return emoji.name;
}

function emojiCacheKey(emoji: MessageEmoji): string | null {
    if (emoji.id) return emoji.id;
    return emoji.name || null;
}

/**
 * Resolve a "writable text-like channel" by id. Accepts the standard
 * text channel plus all thread variants — threads are first-class
 * message containers in discord.js so the existing send/edit/delete/
 * pinned routes work against them with no further changes once the
 * type filter here is widened. Voice + stage channels are included
 * because Discord embeds a text chat in each one with the same id.
 */
function fetchTextChannel(bot: Client, guildId: string, channelId: string): TextChannel | null {
    const guild = bot.guilds.cache.get(guildId);
    if (!guild) return null;
    const channel = guild.channels.cache.get(channelId);
    if (!channel) return null;
    if (
        channel.type === ChannelType.GuildText
        || channel.type === ChannelType.PublicThread
        || channel.type === ChannelType.PrivateThread
        || channel.type === ChannelType.AnnouncementThread
        || channel.type === ChannelType.GuildVoice
        || channel.type === ChannelType.GuildStageVoice
    ) {
        // The Message-API surface is the same on TextChannel, ThreadChannel
        // and VoiceChannel (`.messages.fetch`, `.send`, etc.) — narrowing to
        // TextChannel is a typing convenience; the runtime methods we use
        // exist on all of them.
        return channel as unknown as TextChannel;
    }
    return null;
}

export async function registerGuildChannelRoutes(server: FastifyInstance, options: GuildChannelRoutesOptions): Promise<void> {
    const { bot } = options;
    const events = options.eventBus ?? guildChannelEventBus;

    // Static path — Fastify prioritises it over /:guildId even when registered after.
    server.get('/api/guilds/events', async (request, reply) => {
        // Cross-guild stream — gate the connection itself on the user
        // having SOME guild scope, then filter each emitted event by
        // the caller's accessible guild ids.
        const caps = request.authCapabilities as Set<AdminCapability> | undefined;
        const hasAnyGuildAccess = !!caps && (
            caps.has('admin')
            || caps.has('guild.message')
            || caps.has('guild.manage')
            || [...caps].some(c => /^guild:[^.:]+\.(message|manage)$/.test(c))
        );
        if (!hasAnyGuildAccess) {
            reply.code(403).send({ error: 'guild capability required' });
            return;
        }
        reply.hijack();
        reply.raw.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no'
        });
        reply.raw.write(': connected\n\n');

        const heartbeat = setInterval(() => {
            try { reply.raw.write(': ping\n\n'); } catch { /* ignore */ }
        }, 25_000);
        heartbeat.unref();

        const unsubscribe = events.subscribe(event => {
            // Drop events for guilds this caller can't see — `message`
            // scope is enough since these are all message-shaped events.
            if (!caps || !hasGuildCapability(caps, event.guildId, 'message')) return;
            try {
                reply.raw.write(`event: ${event.type}\n`);
                reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
            } catch (err) {
                request.log.error({ err }, 'failed to write guild SSE event');
            }
        });

        request.raw.on('close', () => {
            clearInterval(heartbeat);
            unsubscribe();
        });
    });

    server.get<{ Params: { guildId: string } }>(
        '/api/guilds/:guildId/forums',
        async (request, reply) => {
            if (!requireGuildCapability(request, reply, request.params.guildId, 'message')) return;
            const { guildId } = request.params;
            const guild = bot.guilds.cache.get(guildId);
            if (!guild) { reply.code(404).send({ error: 'Unknown guild' }); return; }
            const forums = [...guild.channels.cache.values()]
                .filter(c => c.type === ChannelType.GuildForum)
                .sort((a, b) => ('position' in a && 'position' in b) ? (a.position as number) - (b.position as number) : 0);
            try {
                // Per-forum thread fetch is the right abstraction here —
                // a forum may have archived posts that the global active
                // sweep misses. We still only return active posts to keep
                // the payload bounded; archived browsing is a future hop.
                const result = await Promise.all(forums.map(async forum => {
                    let posts: Array<{ id: string; name: string; messageCount: number; archived: boolean }> = [];
                    try {
                        const fetched = await (forum as unknown as { threads: { fetchActive: () => Promise<{ threads: Map<string, { id: string; name: string; messageCount?: number; archived?: boolean }> }> } }).threads.fetchActive();
                        posts = [...fetched.threads.values()].map(t => ({
                            id: t.id,
                            name: t.name,
                            messageCount: t.messageCount ?? 0,
                            archived: !!t.archived
                        }));
                    } catch (err) {
                        request.log.warn({ err, forumId: forum.id }, 'forum.threads.fetchActive failed');
                    }
                    return {
                        id: forum.id,
                        name: forum.name,
                        posts
                    };
                }));
                return { forums: result };
            } catch (err) {
                request.log.error({ err }, 'failed to fetch forums');
                reply.code(502).send({ error: 'Failed to fetch forums' });
            }
        }
    );

    server.get<{ Params: { guildId: string } }>(
        '/api/guilds/:guildId/active-threads',
        async (request, reply) => {
            if (!requireGuildCapability(request, reply, request.params.guildId, 'message')) return;
            const { guildId } = request.params;
            const guild = bot.guilds.cache.get(guildId);
            if (!guild) { reply.code(404).send({ error: 'Unknown guild' }); return; }
            try {
                // `fetchActiveThreads` returns ALL active threads visible
                // to the bot in one round-trip — much cheaper than calling
                // `.threads.fetchActive()` per channel. Archived threads are
                // intentionally excluded; they're a separate fetch that
                // requires manage-threads in some guilds.
                const fetched = await guild.channels.fetchActiveThreads();
                const threads = [...fetched.threads.values()].map(t => ({
                    id: t.id,
                    name: t.name,
                    parentId: t.parentId ?? null,
                    archived: !!t.archived,
                    locked: !!t.locked,
                    memberCount: t.memberCount ?? 0,
                    messageCount: t.messageCount ?? 0,
                    lastMessageId: t.lastMessageId ?? null
                }));
                return { threads };
            } catch (err) {
                request.log.error({ err }, 'failed to fetch active threads');
                reply.code(502).send({ error: 'Failed to fetch threads' });
            }
        }
    );

    // Per-channel thread browser. Active threads come from the gateway
    // cache; archived ones require an extra REST call. We expose both
    // via a single endpoint so the channel-header thread browser only
    // needs one round-trip per open.
    server.get<{ Params: { guildId: string; channelId: string }; Querystring: { archived?: string } }>(
        '/api/guilds/:guildId/text-channels/:channelId/threads',
        async (request, reply) => {
            if (!requireGuildCapability(request, reply, request.params.guildId, 'message')) return;
            const { guildId, channelId } = request.params;
            const guild = bot.guilds.cache.get(guildId);
            if (!guild) { reply.code(404).send({ error: 'Unknown guild' }); return; }
            const channel = guild.channels.cache.get(channelId);
            if (!channel) { reply.code(404).send({ error: 'Unknown channel' }); return; }
            const wantArchived = request.query.archived === 'true';
            // discord.js exposes `.threads` on text/forum/news/voice channels.
            // Stage and category channels don't, so we duck-type and bail
            // if the manager isn't present rather than narrowing types.
            const threadsManager = (channel as unknown as {
                threads?: {
                    fetchActive: () => Promise<{ threads: Map<string, ThreadLike> }>;
                    fetchArchived: (opts: { type: 'public' | 'private'; limit: number }) => Promise<{ threads: Map<string, ThreadLike> }>;
                };
            }).threads;
            if (!threadsManager) {
                reply.code(400).send({ error: 'channel does not support threads' });
                return;
            }
            try {
                const map = wantArchived
                    ? await threadsManager.fetchArchived({ type: 'public', limit: 100 })
                    : await threadsManager.fetchActive();
                const threads = [...map.threads.values()].map(threadRow);
                return { threads };
            } catch (err) {
                request.log.error({ err }, 'failed to fetch channel threads');
                reply.code(502).send({ error: 'Failed to fetch threads' });
            }
        }
    );

    server.get<{ Params: { guildId: string } }>(
        '/api/guilds/:guildId/voice-channels',
        async (request, reply) => {
            if (!requireGuildCapability(request, reply, request.params.guildId, 'message')) return;
            const { guildId } = request.params;
            const guild = bot.guilds.cache.get(guildId);
            if (!guild) { reply.code(404).send({ error: 'Unknown guild' }); return; }

            const all = [...guild.channels.cache.values()];
            const categoryChannels = (all.filter(c => c.type === ChannelType.GuildCategory) as CategoryChannel[])
                .sort((a, b) => a.position - b.position);
            // Voice channels include the standard `GuildVoice` and
            // `GuildStageVoice` types. Stage isn't fully featured here
            // (no role distinction), but reading the participant list
            // works the same way so it's worth including.
            const voiceChannels = all
                .filter(c => c.type === ChannelType.GuildVoice || c.type === ChannelType.GuildStageVoice)
                .sort((a, b) => ('position' in a && 'position' in b) ? (a.position as number) - (b.position as number) : 0);

            const memberRow = (m: { id: string; user: { username: string; globalName: string | null; avatar: string | null }; nickname: string | null; avatar: string | null }) => ({
                id: m.id,
                username: m.user.username,
                globalName: m.user.globalName ?? null,
                nickname: m.nickname ?? null,
                avatarUrl: m.avatar
                    ? guildAvatarUrlFor(guildId, m.id, m.avatar, 64)
                    : avatarUrlFor(m.id, m.user.avatar, 64)
            });

            const toChannel = (c: typeof voiceChannels[number]) => {
                // `members` is a Collection on VoiceChannel/StageChannel;
                // its values are GuildMembers currently connected. We
                // narrow via duck-typing because the union spans two
                // related but distinct discord.js types.
                const memberCollection = (c as unknown as { members?: { values?: () => Iterable<unknown> } }).members;
                const memberArr = memberCollection?.values
                    ? [...memberCollection.values()]
                    : [];
                return {
                    id: c.id,
                    name: c.name,
                    type: c.type === ChannelType.GuildStageVoice ? 'stage' : 'voice',
                    members: memberArr.map(m => memberRow(m as Parameters<typeof memberRow>[0]))
                };
            };

            const categoryIds = new Set(categoryChannels.map(c => c.id));
            const uncategorized = voiceChannels.filter(c => !c.parentId || !categoryIds.has(c.parentId));
            const categories: Array<{ id: string | null; name: string | null; channels: ReturnType<typeof toChannel>[] }> = [];
            if (uncategorized.length > 0) {
                categories.push({ id: null, name: null, channels: uncategorized.map(toChannel) });
            }
            for (const cat of categoryChannels) {
                const children = voiceChannels.filter(c => c.parentId === cat.id).map(toChannel);
                if (children.length > 0) {
                    categories.push({ id: cat.id, name: cat.name, channels: children });
                }
            }
            return { categories };
        }
    );

    server.get<{ Params: { guildId: string } }>(
        '/api/guilds/:guildId/text-channels',
        async (request, reply) => {
            if (!requireGuildCapability(request, reply, request.params.guildId, 'message')) return;
            const { guildId } = request.params;
            const guild = bot.guilds.cache.get(guildId);
            if (!guild) { reply.code(404).send({ error: 'Unknown guild' }); return; }

            const all = [...guild.channels.cache.values()];
            const categoryChannels = (all.filter(c => c.type === ChannelType.GuildCategory) as CategoryChannel[])
                .sort((a, b) => a.position - b.position);
            // Voice and forum channels are returned alongside text channels in
            // the same Discord category — matching the native client's tree —
            // with a `kind` discriminator so the sidebar can render the right
            // icon and the workspace can switch panels (forum browser vs chat).
            const listed = all
                .filter(c =>
                    c.type === ChannelType.GuildText
                    || c.type === ChannelType.GuildVoice
                    || c.type === ChannelType.GuildStageVoice
                    || c.type === ChannelType.GuildForum
                )
                .sort((a, b) => ('position' in a && 'position' in b) ? (a.position as number) - (b.position as number) : 0);

            const memberRow = (m: { id: string; user: { username: string; globalName: string | null; avatar: string | null }; nickname: string | null; avatar: string | null }) => ({
                id: m.id,
                username: m.user.username,
                globalName: m.user.globalName ?? null,
                nickname: m.nickname ?? null,
                avatarUrl: m.avatar
                    ? guildAvatarUrlFor(guildId, m.id, m.avatar, 64)
                    : avatarUrlFor(m.id, m.user.avatar, 64)
            });

            type ChannelRow = {
                id: string;
                name: string;
                kind: 'text' | 'voice' | 'stage' | 'forum';
                lastMessageId: string | null;
                voiceMembers?: ReturnType<typeof memberRow>[];
            };
            const toChannel = (c: typeof listed[number]): ChannelRow => {
                const lastMessageId = (c as unknown as { lastMessageId?: string | null }).lastMessageId ?? null;
                if (c.type === ChannelType.GuildVoice || c.type === ChannelType.GuildStageVoice) {
                    const memberCollection = (c as unknown as { members?: { values?: () => Iterable<unknown> } }).members;
                    const memberArr = memberCollection?.values ? [...memberCollection.values()] : [];
                    return {
                        id: c.id,
                        name: c.name,
                        kind: c.type === ChannelType.GuildStageVoice ? 'stage' : 'voice',
                        lastMessageId,
                        voiceMembers: memberArr.map(m => memberRow(m as Parameters<typeof memberRow>[0]))
                    };
                }
                if (c.type === ChannelType.GuildForum) {
                    return { id: c.id, name: c.name, kind: 'forum', lastMessageId: null };
                }
                return { id: c.id, name: c.name, kind: 'text', lastMessageId };
            };

            const categoryIds = new Set(categoryChannels.map(c => c.id));
            const uncategorized = listed.filter(c => !c.parentId || !categoryIds.has(c.parentId));
            const categories: Array<{ id: string | null; name: string | null; channels: ChannelRow[] }> = [];

            if (uncategorized.length > 0) {
                categories.push({ id: null, name: null, channels: uncategorized.map(toChannel) });
            }
            for (const cat of categoryChannels) {
                const children = listed.filter(c => c.parentId === cat.id).map(toChannel);
                if (children.length > 0) {
                    categories.push({ id: cat.id, name: cat.name, channels: children });
                }
            }

            return { categories };
        }
    );

    // Roles available for @-mentioning, sorted by position (highest first).
    // Includes @everyone filter (role id === guild id) and skips managed
    // integration roles which users generally can't mention meaningfully.
    server.get<{ Params: { guildId: string } }>(
        '/api/guilds/:guildId/roles',
        async (request, reply) => {
            if (!requireGuildCapability(request, reply, request.params.guildId, 'message')) return;
            const { guildId } = request.params;
            const guild = bot.guilds.cache.get(guildId);
            if (!guild) { reply.code(404).send({ error: 'Unknown guild' }); return; }
            // Populate members cache first so r.members.size reflects the
            // real role roster instead of just whatever was previously
            // cached (which on a fresh boot is essentially nothing).
            // discord.js dedupes concurrent fetches.
            if (guild.members.cache.size < guild.memberCount) {
                try {
                    await guild.members.fetch();
                } catch (err) {
                    // GuildMembers intent missing — fall back to cached counts.
                    request.log.warn({ err, guildId }, 'guild.members.fetch failed (roles)');
                }
            }
            const roles = [...guild.roles.cache.values()]
                .filter(r => r.id !== guildId)
                .sort((a, b) => b.position - a.position)
                .map(r => ({
                    id: r.id,
                    name: r.name,
                    color: r.color ? `#${r.color.toString(16).padStart(6, '0')}` : null,
                    position: r.position,
                    mentionable: r.mentionable,
                    memberCount: r.members.size,
                    hoist: r.hoist,
                    managed: r.managed,
                    // Permissions as a bigint string so the editor can
                    // pre-populate every checkbox; sending a Number would
                    // lose the high bits (Discord uses up to 2^48+).
                    permissions: r.permissions.bitfield.toString()
                }));
            return { roles };
        }
    );

    // Channel members that can @-mention — users holding ViewChannel on the
    // target channel. `guild.members.cache` only contains members the bot
    // has already observed via events, so we fetch the full roster once.
    // Discord.js dedupes concurrent fetches and reuses the cache on
    // subsequent calls, so the cost is a single gateway round-trip the
    // first time a guild's mention list is opened.
    server.get<{ Params: { guildId: string; channelId: string } }>(
        '/api/guilds/:guildId/text-channels/:channelId/members',
        async (request, reply) => {
            if (!requireGuildCapability(request, reply, request.params.guildId, 'message')) return;
            const { guildId, channelId } = request.params;
            const channel = fetchTextChannel(bot, guildId, channelId);
            if (!channel) { reply.code(404).send({ error: 'Unknown channel' }); return; }
            const guild = channel.guild;
            if (guild.members.cache.size < guild.memberCount) {
                try {
                    await guild.members.fetch();
                } catch (err) {
                    // Most likely GuildMembers intent unavailable for this
                    // guild; fall through with whatever is cached.
                    request.log.warn({ err, guildId }, 'guild.members.fetch failed');
                }
            }
            const members = [...guild.members.cache.values()]
                .filter(m => m.permissionsIn(channel).has(PermissionFlagsBits.ViewChannel))
                .map(m => ({
                    id: m.id,
                    username: m.user.username,
                    globalName: m.user.globalName ?? null,
                    nickname: m.nickname ?? null,
                    // Prefer the per-guild avatar when the member has one;
                    // the mention suggestion UI matches Discord's own server
                    // render that way.
                    avatarUrl: m.avatar
                        ? guildAvatarUrlFor(guildId, m.user.id, m.avatar, 64)
                        : avatarUrlFor(m.user.id, m.user.avatar, 64),
                    // Display color = the member's highest coloured role, matching
                    // Discord's own author-name tint. 0 means no coloured role.
                    color: m.displayColor ? `#${m.displayColor.toString(16).padStart(6, '0')}` : null,
                    bot: m.user.bot
                }))
                .sort((a, b) => (a.nickname ?? a.globalName ?? a.username).localeCompare(b.nickname ?? b.globalName ?? b.username));
            return { members };
        }
    );

    server.get<{ Params: { guildId: string; channelId: string } }>(
        '/api/guilds/:guildId/text-channels/:channelId/pins',
        async (request, reply) => {
            if (!requireGuildCapability(request, reply, request.params.guildId, 'message')) return;
            const { guildId, channelId } = request.params;
            const channel = fetchTextChannel(bot, guildId, channelId);
            if (!channel) { reply.code(404).send({ error: 'Unknown channel' }); return; }
            try {
                const pinned = await channel.messages.fetchPinned();
                const messages = [...pinned.values()]
                    .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
                    .map(toApiMessage);
                return { messages };
            } catch (err) {
                request.log.error({ err }, 'failed to fetch guild pins');
                reply.code(502).send({ error: 'Failed to fetch pins' });
            }
        }
    );

    server.get<{ Params: { guildId: string; channelId: string }; Querystring: { limit?: string; before?: string; around?: string } }>(
        '/api/guilds/:guildId/text-channels/:channelId/messages',
        async (request, reply) => {
            if (!requireGuildCapability(request, reply, request.params.guildId, 'message')) return;
            const { guildId, channelId } = request.params;
            const limit = Math.min(Math.max(Number(request.query.limit ?? 16) || 16, 1), 50);
            const before = typeof request.query.before === 'string' && request.query.before.length > 0 ? request.query.before : undefined;
            const around = typeof request.query.around === 'string' && request.query.around.length > 0 ? request.query.around : undefined;

            const channel = fetchTextChannel(bot, guildId, channelId);
            if (!channel) { reply.code(404).send({ error: 'Unknown channel' }); return; }

            try {
                // Wipe the reactions cache on every message in the channel
                // BEFORE the bulk fetch. discord.js's `Message._patch` only
                // rebuilds the reactions cache when the API response
                // includes a `reactions` field — and Discord OMITS that
                // field for messages with zero reactions. Without this
                // pre-clear, stale `MessageReaction` entries (e.g. count=1
                // ghosts left behind because `MessageReaction._remove`
                // refuses to decrement the bot's own count) survive a
                // patch where Discord said "no reactions" by omission.
                // Clearing first means the omit-path keeps the now-empty
                // cache, while the present-path repopulates from API.
                for (const cached of channel.messages.cache.values()) {
                    cached.reactions.cache.clear();
                }
                // `around` returns a window centred on the anchor — used
                // when a message link click needs to land on an older
                // message that wouldn't be in the default latest page.
                const fetched = around
                    ? await channel.messages.fetch({ limit, around })
                    : await channel.messages.fetch({ limit, before });
                const messages = [...fetched.values()]
                    .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
                    .map(toApiMessage);
                return { messages, hasMore: messages.length === limit && !around };
            } catch (err) {
                request.log.error({ err }, 'failed to fetch guild channel messages');
                reply.code(502).send({ error: 'Failed to fetch messages' });
            }
        }
    );

    server.post<{ Params: { guildId: string; channelId: string } }>(
        '/api/guilds/:guildId/text-channels/:channelId/messages',
        async (request, reply) => {
            if (!requireGuildCapability(request, reply, request.params.guildId, 'message')) return;
            const { guildId, channelId } = request.params;
            const channel = fetchTextChannel(bot, guildId, channelId);
            if (!channel) { reply.code(404).send({ error: 'Unknown channel' }); return; }

            let content = '';
            let replyToMessageId: string | undefined;
            let replyPingAuthor = false;
            let stickerIds: string[] = [];
            const files: Array<{ attachment: Buffer; name: string }> = [];

            if (request.isMultipart()) {
                for await (const part of request.parts()) {
                    if (part.type === 'file') {
                        const buffer = await part.toBuffer();
                        files.push({ attachment: buffer, name: part.filename });
                    } else if (part.fieldname === 'content') {
                        content = String(part.value ?? '');
                    } else if (part.fieldname === 'replyToMessageId') {
                        const value = String(part.value ?? '').trim();
                        if (value) replyToMessageId = value;
                    } else if (part.fieldname === 'replyPingAuthor') {
                        replyPingAuthor = String(part.value ?? '') === '1';
                    } else if (part.fieldname === 'stickerIds' || part.fieldname === 'stickerIds[]') {
                        const value = String(part.value ?? '').trim();
                        if (value) stickerIds.push(value);
                    }
                }
            } else {
                const body = (request.body ?? {}) as { content?: unknown; replyToMessageId?: unknown; replyPingAuthor?: unknown; stickerIds?: unknown };
                content = typeof body.content === 'string' ? body.content : '';
                if (typeof body.replyToMessageId === 'string' && body.replyToMessageId.length > 0) {
                    replyToMessageId = body.replyToMessageId;
                }
                if (typeof body.replyPingAuthor === 'boolean') {
                    replyPingAuthor = body.replyPingAuthor;
                }
                if (Array.isArray(body.stickerIds)) {
                    stickerIds = body.stickerIds.filter((id): id is string => typeof id === 'string' && id.length > 0);
                }
            }

            stickerIds = stickerIds.slice(0, 3);
            if (!stickerIds.every(isSnowflake)) {
                reply.code(400).send({ error: 'invalid sticker id' });
                return;
            }
            if (replyToMessageId !== undefined && !isSnowflake(replyToMessageId)) {
                reply.code(400).send({ error: 'invalid replyToMessageId' });
                return;
            }
            if (content.length > DISCORD_MESSAGE_MAX) {
                reply.code(400).send({ error: `content must be ≤${DISCORD_MESSAGE_MAX} chars` });
                return;
            }

            if (!content.trim() && files.length === 0 && stickerIds.length === 0) {
                reply.code(400).send({ error: 'content, attachment, or sticker required' });
                return;
            }

            try {
                const sent = await channel.send({
                    content: content || undefined,
                    files: files.length > 0 ? files : undefined,
                    stickers: stickerIds.length > 0 ? stickerIds : undefined,
                    reply: replyToMessageId
                        ? { messageReference: replyToMessageId, failIfNotExists: false }
                        : undefined,
                    allowedMentions: replyToMessageId
                        ? { repliedUser: replyPingAuthor, parse: ['users', 'roles', 'everyone'] }
                        : undefined
                });
                return { message: toApiMessage(sent) };
            } catch (err) {
                request.log.error({ err }, 'failed to send guild message');
                reply.code(502).send({ error: 'Failed to send message' });
            }
        }
    );

    server.patch<{ Params: { guildId: string; channelId: string; messageId: string }; Body: { content?: unknown } }>(
        '/api/guilds/:guildId/text-channels/:channelId/messages/:messageId',
        async (request, reply) => {
            if (!requireGuildCapability(request, reply, request.params.guildId, 'message')) return;
            const { guildId, channelId, messageId } = request.params;
            if (!isSnowflake(messageId)) { reply.code(400).send({ error: 'invalid messageId' }); return; }
            const channel = fetchTextChannel(bot, guildId, channelId);
            if (!channel) { reply.code(404).send({ error: 'Unknown channel' }); return; }
            const content = typeof request.body?.content === 'string' ? request.body.content : '';
            if (!content.trim()) { reply.code(400).send({ error: 'content required' }); return; }
            if (content.length > DISCORD_MESSAGE_MAX) {
                reply.code(400).send({ error: `content must be ≤${DISCORD_MESSAGE_MAX} chars` });
                return;
            }
            try {
                const message = await channel.messages.fetch(messageId);
                if (message.author.id !== bot.user?.id) {
                    reply.code(403).send({ error: 'Can only edit messages sent by the bot' });
                    return;
                }
                const edited = await message.edit({ content });
                events.publish({ type: 'guild-message-updated', guildId, channelId: channel.id, message: toApiMessage(edited) });
                return { message: toApiMessage(edited) };
            } catch (err) {
                request.log.error({ err }, 'failed to edit guild message');
                reply.code(502).send({ error: 'Failed to edit message' });
            }
        }
    );

    server.delete<{ Params: { guildId: string; channelId: string; messageId: string } }>(
        '/api/guilds/:guildId/text-channels/:channelId/messages/:messageId',
        async (request, reply) => {
            if (!requireGuildCapability(request, reply, request.params.guildId, 'message')) return;
            const { guildId, channelId, messageId } = request.params;
            if (!isSnowflake(messageId)) { reply.code(400).send({ error: 'invalid messageId' }); return; }
            const channel = fetchTextChannel(bot, guildId, channelId);
            if (!channel) { reply.code(404).send({ error: 'Unknown channel' }); return; }
            try {
                const message = await channel.messages.fetch(messageId);
                // No author check — Discord enforces that non-own deletion
                // requires ManageMessages on the bot. We forward the call and
                // let it surface a 50013 if the bot lacks the permission.
                await message.delete();
                events.publish({ type: 'guild-message-deleted', guildId, channelId: channel.id, messageId });
                reply.code(204).send();
            } catch (err) {
                request.log.error({ err }, 'failed to delete guild message');
                reply.code(502).send({ error: 'Failed to delete message' });
            }
        }
    );

    server.get<{ Params: { guildId: string; channelId: string; messageId: string }; Querystring: { emojiId?: string; emojiName?: string } }>(
        '/api/guilds/:guildId/text-channels/:channelId/messages/:messageId/reactions/users',
        async (request, reply) => {
            if (!requireGuildCapability(request, reply, request.params.guildId, 'message')) return;
            const { guildId, channelId, messageId } = request.params;
            if (!isSnowflake(messageId)) { reply.code(400).send({ error: 'invalid messageId' }); return; }
            const channel = fetchTextChannel(bot, guildId, channelId);
            if (!channel) { reply.code(404).send({ error: 'Unknown channel' }); return; }
            const key = request.query.emojiId ?? request.query.emojiName;
            if (!key) { reply.code(400).send({ error: 'emoji required' }); return; }
            try {
                const message = await channel.messages.fetch(messageId);
                const reaction = message.reactions.cache.get(key);
                if (!reaction) return { users: [] };
                const users = await reaction.users.fetch();
                return {
                    users: [...users.values()].map(u => ({
                        id: u.id,
                        username: u.username,
                        globalName: u.globalName ?? null,
                        avatarUrl: avatarUrlFor(u.id, u.avatar)
                    }))
                };
            } catch (err) {
                request.log.error({ err }, 'failed to fetch guild reaction users');
                reply.code(502).send({ error: 'Failed to fetch reaction users' });
            }
        }
    );

    server.post<{ Params: { guildId: string; channelId: string; messageId: string }; Body: ReactionBody }>(
        '/api/guilds/:guildId/text-channels/:channelId/messages/:messageId/reactions',
        async (request, reply) => {
            if (!requireGuildCapability(request, reply, request.params.guildId, 'message')) return;
            const { guildId, channelId, messageId } = request.params;
            if (!isSnowflake(messageId)) { reply.code(400).send({ error: 'invalid messageId' }); return; }
            const channel = fetchTextChannel(bot, guildId, channelId);
            if (!channel) { reply.code(404).send({ error: 'Unknown channel' }); return; }
            const emoji = request.body?.emoji;
            if (!emoji) { reply.code(400).send({ error: 'emoji required' }); return; }
            const resolvable = emojiResolvable({ id: emoji.id ?? null, name: emoji.name ?? '', animated: !!emoji.animated });
            if (!resolvable) { reply.code(400).send({ error: 'emoji.id or emoji.name required' }); return; }
            try {
                const message = await channel.messages.fetch(messageId);
                await message.react(resolvable);
                reply.code(204).send();
            } catch (err) {
                request.log.error({ err }, 'failed to add reaction to guild message');
                reply.code(502).send({ error: 'Failed to add reaction' });
            }
        }
    );

    server.delete<{ Params: { guildId: string; channelId: string; messageId: string }; Body: ReactionBody }>(
        '/api/guilds/:guildId/text-channels/:channelId/messages/:messageId/reactions',
        async (request, reply) => {
            if (!requireGuildCapability(request, reply, request.params.guildId, 'message')) return;
            const { guildId, channelId, messageId } = request.params;
            if (!isSnowflake(messageId)) { reply.code(400).send({ error: 'invalid messageId' }); return; }
            const channel = fetchTextChannel(bot, guildId, channelId);
            if (!channel) { reply.code(404).send({ error: 'Unknown channel' }); return; }
            const emoji = request.body?.emoji;
            if (!emoji) { reply.code(400).send({ error: 'emoji required' }); return; }
            const key = emojiCacheKey({ id: emoji.id ?? null, name: emoji.name ?? '' });
            if (!key) { reply.code(400).send({ error: 'emoji.id or emoji.name required' }); return; }
            try {
                const message = await channel.messages.fetch(messageId);
                const reaction = message.reactions.cache.get(key);
                if (reaction && bot.user) await reaction.users.remove(bot.user.id);
                reply.code(204).send();
            } catch (err) {
                request.log.error({ err }, 'failed to remove reaction from guild message');
                reply.code(502).send({ error: 'Failed to remove reaction' });
            }
        }
    );

    // Voice-state moderation: server mute / deafen / move-or-disconnect.
    // All three are scoped to the user being currently in any voice channel
    // of this guild (Discord rejects voice ops on disconnected members);
    // the route just forwards the discord.js call, which surfaces a 50013
    // when the bot lacks MuteMembers / DeafenMembers / MoveMembers.
    server.patch<{ Params: { guildId: string; userId: string }; Body: { mute?: unknown } }>(
        '/api/guilds/:guildId/voice-members/:userId/mute',
        async (request, reply) => {
            if (!requireGuildCapability(request, reply, request.params.guildId, 'message')) return;
            const { guildId, userId } = request.params;
            const guild = bot.guilds.cache.get(guildId);
            if (!guild) { reply.code(404).send({ error: 'Unknown guild' }); return; }
            const member = await guild.members.fetch(userId).catch(() => null);
            if (!member) { reply.code(404).send({ error: 'Unknown member' }); return; }
            const mute = !!request.body?.mute;
            try {
                await member.voice.setMute(mute);
                reply.code(204).send();
            } catch (err) {
                request.log.error({ err }, 'failed to set voice mute');
                reply.code(502).send({ error: 'Failed to set mute' });
            }
        }
    );

    server.patch<{ Params: { guildId: string; userId: string }; Body: { deaf?: unknown } }>(
        '/api/guilds/:guildId/voice-members/:userId/deafen',
        async (request, reply) => {
            if (!requireGuildCapability(request, reply, request.params.guildId, 'message')) return;
            const { guildId, userId } = request.params;
            const guild = bot.guilds.cache.get(guildId);
            if (!guild) { reply.code(404).send({ error: 'Unknown guild' }); return; }
            const member = await guild.members.fetch(userId).catch(() => null);
            if (!member) { reply.code(404).send({ error: 'Unknown member' }); return; }
            const deaf = !!request.body?.deaf;
            try {
                await member.voice.setDeaf(deaf);
                reply.code(204).send();
            } catch (err) {
                request.log.error({ err }, 'failed to set voice deafen');
                reply.code(502).send({ error: 'Failed to set deafen' });
            }
        }
    );

    server.patch<{ Params: { guildId: string; userId: string }; Body: { channelId?: unknown } }>(
        '/api/guilds/:guildId/voice-members/:userId/move',
        async (request, reply) => {
            if (!requireGuildCapability(request, reply, request.params.guildId, 'message')) return;
            const { guildId, userId } = request.params;
            const raw = request.body?.channelId;
            // null disconnects; a snowflake string moves into that channel.
            const target: string | null = raw === null ? null
                : (typeof raw === 'string' && isSnowflake(raw) ? raw : undefined as unknown as null);
            if (target === undefined) {
                reply.code(400).send({ error: 'channelId must be a snowflake or null' });
                return;
            }
            const guild = bot.guilds.cache.get(guildId);
            if (!guild) { reply.code(404).send({ error: 'Unknown guild' }); return; }
            const member = await guild.members.fetch(userId).catch(() => null);
            if (!member) { reply.code(404).send({ error: 'Unknown member' }); return; }
            if (target !== null) {
                const dest = guild.channels.cache.get(target);
                if (!dest || (dest.type !== ChannelType.GuildVoice && dest.type !== ChannelType.GuildStageVoice)) {
                    reply.code(400).send({ error: 'destination is not a voice channel' });
                    return;
                }
            }
            try {
                await member.voice.setChannel(target);
                reply.code(204).send();
            } catch (err) {
                request.log.error({ err }, 'failed to move voice member');
                reply.code(502).send({ error: 'Failed to move voice member' });
            }
        }
    );
}
