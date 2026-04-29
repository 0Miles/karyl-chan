import type { FastifyInstance } from 'fastify';
import type { Client } from "discord.js";
import type { DMChannel, EmojiIdentifierResolvable, Message as DjsMessage } from 'discord.js';
import { ChannelType } from 'discord.js';
import { dmInboxService, type DmChannelSummary, type DmInboxStore } from './dm-inbox.service.js';
import { dmEventBus, type DmEventBus } from './dm-event-bus.js';
import { avatarUrlFor, toApiMessage } from './message-mapper.js';
import type { MessageEmoji } from './message-types.js';
import { requireCapability } from './route-guards.js';
import { DISCORD_MESSAGE_MAX, isSnowflake } from './validators.js';
import { jwtService } from './jwt.service.js';
import { resolveLoginRole } from './authorized-user.service.js';

function buildBaseUrl(): string {
    const explicit = process.env.WEB_BASE_URL?.trim();
    if (explicit) return explicit.replace(/\/+$/, '');
    const port = process.env.WEB_PORT ?? '3000';
    return `http://localhost:${port}`;
}

export interface DmRoutesOptions {
    bot: Client;
    inbox?: DmInboxStore;
    eventBus?: DmEventBus;
}

interface ReactionBody {
    emoji?: { id?: string | null; name?: string; animated?: boolean };
}

interface StartBody {
    recipientUserId?: string;
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

async function fetchDmChannel(bot: Client, channelId: string): Promise<DMChannel | null> {
    const channel = await bot.channels.fetch(channelId).catch(() => null);
    if (!channel || channel.type !== ChannelType.DM) return null;
    return channel as DMChannel;
}

export async function registerDmRoutes(server: FastifyInstance, options: DmRoutesOptions): Promise<void> {
    const { bot } = options;
    const inbox = options.inbox ?? dmInboxService;
    const events = options.eventBus ?? dmEventBus;

    server.get('/api/dm/channels', async (request, reply) => {
        if (!requireCapability(request, reply, 'dm.message')) return;
        return { channels: await inbox.listChannels() };
    });

    server.post<{ Body: { lastSeen?: Record<string, string | null> } }>(
        '/api/dm/unread',
        async (request, reply) => {
            if (!requireCapability(request, reply, 'dm.message')) return;
            const lastSeen = (request.body?.lastSeen && typeof request.body.lastSeen === 'object')
                ? request.body.lastSeen
                : {};
            const channels = await inbox.listChannels();
            const botUserId = bot.user?.id ?? '';

            // Snowflakes are monotonically increasing — string compare
            // works when both sides are the same length. `lastMessageId`
            // null means we never recorded a message; treat every message
            // after the oldest possible id as unread (equivalent to passing
            // a zero snowflake).
            function isNewer(latest: string | null, seen: string | null | undefined): boolean {
                if (!latest) return false;
                if (!seen) return true;
                if (latest.length !== seen.length) return latest.length > seen.length;
                return latest > seen;
            }

            const stale = channels.filter(c => isNewer(c.lastMessageId, lastSeen[c.id] ?? null));

            const MAX_COUNT = 500;
            const PAGE_SIZE = 100;
            const CONCURRENCY = 5;

            async function countFor(c: DmChannelSummary): Promise<[string, { count: number; hasMore: boolean }]> {
                const seen = lastSeen[c.id] ?? null;
                try {
                    const channel = await fetchDmChannel(bot, c.id);
                    if (!channel) return [c.id, { count: 0, hasMore: false }];
                    let cursor = seen ?? '0';
                    let count = 0;
                    while (count < MAX_COUNT) {
                        const fetched = await channel.messages.fetch({ limit: PAGE_SIZE, after: cursor });
                        if (fetched.size === 0) break;
                        let maxId = cursor;
                        for (const m of fetched.values()) {
                            if (m.author.id !== botUserId) count++;
                            if (m.id > maxId || m.id.length > maxId.length) maxId = m.id;
                        }
                        if (fetched.size < PAGE_SIZE) break;
                        if (maxId === cursor) break;
                        cursor = maxId;
                    }
                    return [c.id, { count: Math.min(count, MAX_COUNT), hasMore: count >= MAX_COUNT }];
                } catch (err) {
                    request.log.warn({ err, channelId: c.id }, 'dm unread fetch failed');
                    return [c.id, { count: 0, hasMore: false }];
                }
            }

            // Chunked fan-out: unbounded Promise.all over 200+ DM channels
            // bursts Discord's REST queue and stalls unrelated requests.
            const channelsOut: Record<string, { count: number; hasMore: boolean }> = {};
            for (let i = 0; i < stale.length; i += CONCURRENCY) {
                const slice = stale.slice(i, i + CONCURRENCY);
                const results = await Promise.all(slice.map(countFor));
                for (const [id, data] of results) channelsOut[id] = data;
            }
            reply.send({ channels: channelsOut });
        }
    );

    server.get<{ Params: { channelId: string }; Querystring: { limit?: string; before?: string; around?: string } }>(
        '/api/dm/channels/:channelId/messages',
        async (request, reply) => {
            if (!requireCapability(request, reply, 'dm.message')) return;
            const { channelId } = request.params;
            const limit = Math.min(Math.max(Number(request.query.limit ?? 10) || 10, 1), 50);
            const before = typeof request.query.before === 'string' && request.query.before.length > 0 ? request.query.before : undefined;
            const around = typeof request.query.around === 'string' && request.query.around.length > 0 ? request.query.around : undefined;

            const summary = await inbox.getChannel(channelId);
            if (!summary) { reply.code(404).send({ error: 'Unknown channel' }); return; }

            const channel = await fetchDmChannel(bot, channelId);
            if (!channel) { reply.code(404).send({ error: 'Unknown DM channel' }); return; }

            try {
                // `around` (anchor pagination) takes precedence over `before`
                // so a link click can grab the window that contains the
                // target in one shot instead of trickling older pages.
                const fetched = around
                    ? await channel.messages.fetch({ limit, around })
                    : await channel.messages.fetch({ limit, before });
                const messages = [...fetched.values()]
                    .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
                    .map(toApiMessage);
                return {
                    channel: summary,
                    messages,
                    hasMore: messages.length === limit && !around
                };
            } catch (err) {
                request.log.error({ err }, 'failed to fetch DM messages');
                reply.code(502).send({ error: 'Failed to fetch messages' });
            }
        }
    );

    server.post<{ Params: { channelId: string } }>(
        '/api/dm/channels/:channelId/messages',
        async (request, reply) => {
            if (!requireCapability(request, reply, 'dm.message')) return;
            const channel = await fetchDmChannel(bot, request.params.channelId);
            if (!channel) { reply.code(404).send({ error: 'Unknown DM channel' }); return; }

            let content = '';
            let replyToMessageId: string | undefined;
            // Discord defaults to pinging the replied-to author. We default
            // to NOT pinging because the admin client favours quiet replies;
            // composer is responsible for opting back in via this flag.
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
                const sent: DjsMessage = await channel.send({
                    content: content || undefined,
                    files: files.length > 0 ? files : undefined,
                    stickers: stickerIds.length > 0 ? stickerIds : undefined,
                    reply: replyToMessageId
                        ? { messageReference: replyToMessageId, failIfNotExists: false }
                        : undefined,
                    // Only set allowedMentions when actually replying; for
                    // non-reply messages Discord's defaults are fine.
                    allowedMentions: replyToMessageId
                        ? { repliedUser: replyPingAuthor, parse: ['users', 'roles', 'everyone'] }
                        : undefined
                });
                return { message: toApiMessage(sent) };
            } catch (err) {
                request.log.error({ err }, 'failed to send DM');
                reply.code(502).send({ error: 'Failed to send DM' });
            }
        }
    );

    // Proactive bot actions in a DM channel — UI-triggered messages
    // composed by the backend (not the admin's free-text input). Each
    // action is gated on the recipient's own admin authorization, so
    // we never leak login links to a user who isn't allowed in.
    server.post<{ Params: { channelId: string; action: string } }>(
        '/api/dm/channels/:channelId/proactive/:action',
        async (request, reply) => {
            if (!requireCapability(request, reply, 'dm.message')) return;
            const channel = await fetchDmChannel(bot, request.params.channelId);
            if (!channel) { reply.code(404).send({ error: 'Unknown DM channel' }); return; }

            if (request.params.action === 'admin-login') {
                const recipientId = channel.recipient?.id;
                if (!recipientId) { reply.code(400).send({ error: 'DM channel has no recipient' }); return; }
                // Mirror admin-login-dm.events.ts: only mint a token for
                // someone who'd actually be allowed to log in. Owner +
                // anyone in authorized_users with a non-empty role.
                const role = await resolveLoginRole(recipientId);
                if (!role) { reply.code(403).send({ error: 'Recipient is not authorized to log in' }); return; }

                // No source message for proactive sends — synthesize a
                // messageId from the channel id so the JWT payload still
                // satisfies the verifier's required-string check. The
                // exchange endpoint treats the audit fields as opaque.
                const { token, expiresAt } = jwtService.sign({
                    purpose: 'login',
                    userId: recipientId,
                    guildId: null,
                    channelId: channel.id,
                    messageId: `proactive:${channel.id}`
                });
                const url = `${buildBaseUrl()}/admin/auth?token=${encodeURIComponent(token)}`;
                const minutes = Math.max(1, Math.round((expiresAt - Date.now()) / 60_000));
                try {
                    const sent: DjsMessage = await channel.send({
                        content: `Login link (role: ${role}, expires in ~${minutes} min):\n${url}`
                    });
                    return { message: toApiMessage(sent) };
                } catch (err) {
                    request.log.error({ err }, 'failed to send proactive admin-login DM');
                    reply.code(502).send({ error: 'Failed to send DM' });
                    return;
                }
            }

            reply.code(404).send({ error: 'Unknown proactive action' });
        }
    );

    server.post<{ Body: StartBody }>('/api/dm/channels', async (request, reply) => {
        if (!requireCapability(request, reply, 'dm.message')) return;
        const recipientUserId = typeof request.body?.recipientUserId === 'string' ? request.body.recipientUserId : '';
        if (!isSnowflake(recipientUserId)) { reply.code(400).send({ error: 'recipientUserId must be a snowflake' }); return; }
        try {
            const user = await bot.users.fetch(recipientUserId);
            const channel = await user.createDM();
            const summary = await inbox.upsertChannel(channel.id, {
                id: user.id,
                username: user.username,
                globalName: user.globalName ?? null,
                avatarUrl: avatarUrlFor(user.id, user.avatar)
            });
            events.publish({ type: 'channel-touched', channel: summary });
            return { channel: summary };
        } catch (err) {
            request.log.error({ err }, 'failed to start DM');
            reply.code(404).send({ error: 'User not found or DMs unavailable' });
        }
    });

    server.patch<{ Params: { channelId: string; messageId: string }; Body: { content?: unknown } }>(
        '/api/dm/channels/:channelId/messages/:messageId',
        async (request, reply) => {
            if (!requireCapability(request, reply, 'dm.message')) return;
            if (!isSnowflake(request.params.messageId)) { reply.code(400).send({ error: 'invalid messageId' }); return; }
            const channel = await fetchDmChannel(bot, request.params.channelId);
            if (!channel) { reply.code(404).send({ error: 'Unknown DM channel' }); return; }
            const content = typeof request.body?.content === 'string' ? request.body.content : '';
            if (!content.trim()) { reply.code(400).send({ error: 'content required' }); return; }
            if (content.length > DISCORD_MESSAGE_MAX) {
                reply.code(400).send({ error: `content must be ≤${DISCORD_MESSAGE_MAX} chars` });
                return;
            }
            try {
                const message = await channel.messages.fetch(request.params.messageId);
                if (message.author.id !== bot.user?.id) {
                    reply.code(403).send({ error: 'Can only edit messages sent by the bot' });
                    return;
                }
                const edited = await message.edit({ content });
                events.publish({ type: 'message-updated', channelId: channel.id, message: toApiMessage(edited) });
                return { message: toApiMessage(edited) };
            } catch (err) {
                request.log.error({ err }, 'failed to edit message');
                reply.code(502).send({ error: 'Failed to edit message' });
            }
        }
    );

    server.delete<{ Params: { channelId: string; messageId: string } }>(
        '/api/dm/channels/:channelId/messages/:messageId',
        async (request, reply) => {
            if (!requireCapability(request, reply, 'dm.message')) return;
            if (!isSnowflake(request.params.messageId)) { reply.code(400).send({ error: 'invalid messageId' }); return; }
            const channel = await fetchDmChannel(bot, request.params.channelId);
            if (!channel) { reply.code(404).send({ error: 'Unknown DM channel' }); return; }
            try {
                const message = await channel.messages.fetch(request.params.messageId);
                if (message.author.id !== bot.user?.id) {
                    reply.code(403).send({ error: 'Can only delete messages sent by the bot' });
                    return;
                }
                await message.delete();
                events.publish({ type: 'message-deleted', channelId: channel.id, messageId: request.params.messageId });
                reply.code(204).send();
            } catch (err) {
                request.log.error({ err }, 'failed to delete message');
                reply.code(502).send({ error: 'Failed to delete message' });
            }
        }
    );

    server.get<{ Params: { channelId: string; messageId: string }; Querystring: { emojiId?: string; emojiName?: string } }>(
        '/api/dm/channels/:channelId/messages/:messageId/reactions/users',
        async (request, reply) => {
            if (!requireCapability(request, reply, 'dm.message')) return;
            if (!isSnowflake(request.params.messageId)) { reply.code(400).send({ error: 'invalid messageId' }); return; }
            const channel = await fetchDmChannel(bot, request.params.channelId);
            if (!channel) { reply.code(404).send({ error: 'Unknown DM channel' }); return; }
            const key = request.query.emojiId ?? request.query.emojiName;
            if (!key) { reply.code(400).send({ error: 'emoji required' }); return; }
            try {
                const message = await channel.messages.fetch(request.params.messageId);
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
                request.log.error({ err }, 'failed to fetch DM reaction users');
                reply.code(502).send({ error: 'Failed to fetch reaction users' });
            }
        }
    );

    server.post<{ Params: { channelId: string; messageId: string }; Body: ReactionBody }>(
        '/api/dm/channels/:channelId/messages/:messageId/reactions',
        async (request, reply) => {
            if (!requireCapability(request, reply, 'dm.message')) return;
            if (!isSnowflake(request.params.messageId)) { reply.code(400).send({ error: 'invalid messageId' }); return; }
            const channel = await fetchDmChannel(bot, request.params.channelId);
            if (!channel) { reply.code(404).send({ error: 'Unknown DM channel' }); return; }
            const emoji = request.body?.emoji;
            if (!emoji) { reply.code(400).send({ error: 'emoji required' }); return; }
            const resolvable = emojiResolvable({ id: emoji.id ?? null, name: emoji.name ?? '', animated: !!emoji.animated });
            if (!resolvable) { reply.code(400).send({ error: 'emoji.id or emoji.name required' }); return; }
            try {
                const message = await channel.messages.fetch(request.params.messageId);
                await message.react(resolvable);
                // The gateway-driven messageReactionAdd listener publishes the
                // authoritative state once the change propagates; doing it here
                // races with Discord's eventual consistency and produces stale
                // counts.
                reply.code(204).send();
            } catch (err) {
                request.log.error({ err }, 'failed to add reaction');
                reply.code(502).send({ error: 'Failed to add reaction' });
            }
        }
    );

    server.delete<{ Params: { channelId: string; messageId: string }; Body: ReactionBody }>(
        '/api/dm/channels/:channelId/messages/:messageId/reactions',
        async (request, reply) => {
            if (!requireCapability(request, reply, 'dm.message')) return;
            if (!isSnowflake(request.params.messageId)) { reply.code(400).send({ error: 'invalid messageId' }); return; }
            const channel = await fetchDmChannel(bot, request.params.channelId);
            if (!channel) { reply.code(404).send({ error: 'Unknown DM channel' }); return; }
            const emoji = request.body?.emoji;
            if (!emoji) { reply.code(400).send({ error: 'emoji required' }); return; }
            const key = emojiCacheKey({ id: emoji.id ?? null, name: emoji.name ?? '' });
            if (!key) { reply.code(400).send({ error: 'emoji.id or emoji.name required' }); return; }
            try {
                const message = await channel.messages.fetch(request.params.messageId);
                const reaction = message.reactions.cache.get(key);
                if (reaction && bot.user) await reaction.users.remove(bot.user.id);
                // gateway listener handles the SSE publish — see add route note.
                reply.code(204).send();
            } catch (err) {
                request.log.error({ err }, 'failed to remove reaction');
                reply.code(502).send({ error: 'Failed to remove reaction' });
            }
        }
    );

    server.get<{ Params: { channelId: string } }>(
        '/api/dm/channels/:channelId/pins',
        async (request, reply) => {
            if (!requireCapability(request, reply, 'dm.message')) return;
            const channel = await fetchDmChannel(bot, request.params.channelId);
            if (!channel) { reply.code(404).send({ error: 'Unknown DM channel' }); return; }
            try {
                // Discord caps pinned messages at 50, so this is always a
                // single round-trip — no pagination needed.
                const pinned = await channel.messages.fetchPinned();
                const messages = [...pinned.values()]
                    .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
                    .map(toApiMessage);
                return { messages };
            } catch (err) {
                request.log.error({ err }, 'failed to fetch DM pins');
                reply.code(502).send({ error: 'Failed to fetch pins' });
            }
        }
    );

    server.get<{ Params: { stickerId: string } }>(
        '/api/dm/stickers/:stickerId',
        async (request, reply) => {
            if (!requireCapability(request, reply, 'dm.message')) return;
            const id = request.params.stickerId.replace(/[^0-9]/g, '');
            if (!id) { reply.code(400).send({ error: 'invalid sticker id' }); return; }
            // Hard ceiling on proxied response size. Lottie sticker JSON
            // from Discord rarely exceeds ~200KB; 1MB is generous and
            // protects us from a malicious / misbehaving upstream that
            // tries to stream a multi-MB blob through our process.
            const MAX_BYTES = 1_000_000;
            try {
                const upstream = await fetch(`https://cdn.discordapp.com/stickers/${id}.json`);
                if (!upstream.ok) { reply.code(upstream.status).send({ error: 'upstream' }); return; }
                const declaredLen = Number(upstream.headers.get('content-length') ?? '0');
                if (declaredLen > MAX_BYTES) {
                    reply.code(502).send({ error: 'sticker too large' });
                    return;
                }
                const buf = Buffer.from(await upstream.arrayBuffer());
                if (buf.byteLength > MAX_BYTES) {
                    reply.code(502).send({ error: 'sticker too large' });
                    return;
                }
                reply.header('content-type', 'application/json');
                reply.header('cache-control', 'public, max-age=86400');
                reply.send(buf);
            } catch (err) {
                request.log.error({ err }, 'sticker proxy failed');
                reply.code(502).send({ error: 'proxy failed' });
            }
        }
    );

    server.get('/api/dm/events', async (request, reply) => {
        if (!requireCapability(request, reply, 'dm.message')) return;
        // Hand the socket to us — without this fastify auto-sends a body once
        // the async handler returns, which races with our SSE writes and the
        // browser sees the connection close immediately.
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
            try {
                reply.raw.write(`event: ${event.type}\n`);
                reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
            } catch (err) {
                request.log.error({ err }, 'failed to write SSE event');
            }
        });

        request.raw.on('close', () => {
            clearInterval(heartbeat);
            unsubscribe();
        });
    });
}
