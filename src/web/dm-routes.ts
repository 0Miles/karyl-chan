import type { FastifyInstance } from 'fastify';
import type { Client } from 'discordx';
import type { DMChannel, EmojiIdentifierResolvable, Message as DjsMessage } from 'discord.js';
import { ChannelType } from 'discord.js';
import { dmInboxService, type DmInboxStore } from './dm-inbox.service.js';
import { dmEventBus, type DmEventBus } from './dm-event-bus.js';
import { avatarUrlFor, toApiMessage } from './message-mapper.js';
import type { MessageEmoji } from './message-types.js';

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

    server.get('/api/dm/channels', async () => {
        return { channels: await inbox.listChannels() };
    });

    server.get<{ Params: { channelId: string }; Querystring: { limit?: string; before?: string } }>(
        '/api/dm/channels/:channelId/messages',
        async (request, reply) => {
            const { channelId } = request.params;
            const limit = Math.min(Math.max(Number(request.query.limit ?? 10) || 10, 1), 50);
            const before = typeof request.query.before === 'string' && request.query.before.length > 0 ? request.query.before : undefined;

            const summary = await inbox.getChannel(channelId);
            if (!summary) { reply.code(404).send({ error: 'Unknown channel' }); return; }

            const channel = await fetchDmChannel(bot, channelId);
            if (!channel) { reply.code(404).send({ error: 'Unknown DM channel' }); return; }

            try {
                const fetched = await channel.messages.fetch({ limit, before });
                const messages = [...fetched.values()]
                    .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
                    .map(toApiMessage);
                return {
                    channel: summary,
                    messages,
                    hasMore: messages.length === limit
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
            const channel = await fetchDmChannel(bot, request.params.channelId);
            if (!channel) { reply.code(404).send({ error: 'Unknown DM channel' }); return; }

            let content = '';
            let replyToMessageId: string | undefined;
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
                    } else if (part.fieldname === 'stickerIds' || part.fieldname === 'stickerIds[]') {
                        const value = String(part.value ?? '').trim();
                        if (value) stickerIds.push(value);
                    }
                }
            } else {
                const body = (request.body ?? {}) as { content?: unknown; replyToMessageId?: unknown; stickerIds?: unknown };
                content = typeof body.content === 'string' ? body.content : '';
                if (typeof body.replyToMessageId === 'string' && body.replyToMessageId.length > 0) {
                    replyToMessageId = body.replyToMessageId;
                }
                if (Array.isArray(body.stickerIds)) {
                    stickerIds = body.stickerIds.filter((id): id is string => typeof id === 'string' && id.length > 0);
                }
            }

            stickerIds = stickerIds.slice(0, 3);

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
                        : undefined
                });
                return { message: toApiMessage(sent) };
            } catch (err) {
                request.log.error({ err }, 'failed to send DM');
                reply.code(502).send({ error: 'Failed to send DM' });
            }
        }
    );

    server.post<{ Body: StartBody }>('/api/dm/channels', async (request, reply) => {
        const recipientUserId = typeof request.body?.recipientUserId === 'string' ? request.body.recipientUserId : '';
        if (!recipientUserId) { reply.code(400).send({ error: 'recipientUserId required' }); return; }
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
            const channel = await fetchDmChannel(bot, request.params.channelId);
            if (!channel) { reply.code(404).send({ error: 'Unknown DM channel' }); return; }
            const content = typeof request.body?.content === 'string' ? request.body.content : '';
            if (!content.trim()) { reply.code(400).send({ error: 'content required' }); return; }
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

    server.post<{ Params: { channelId: string; messageId: string }; Body: ReactionBody }>(
        '/api/dm/channels/:channelId/messages/:messageId/reactions',
        async (request, reply) => {
            const channel = await fetchDmChannel(bot, request.params.channelId);
            if (!channel) { reply.code(404).send({ error: 'Unknown DM channel' }); return; }
            const emoji = request.body?.emoji;
            if (!emoji) { reply.code(400).send({ error: 'emoji required' }); return; }
            const resolvable = emojiResolvable({ id: emoji.id ?? null, name: emoji.name ?? '', animated: !!emoji.animated });
            if (!resolvable) { reply.code(400).send({ error: 'emoji.id or emoji.name required' }); return; }
            try {
                const message = await channel.messages.fetch(request.params.messageId);
                await message.react(resolvable);
                const fresh = await channel.messages.fetch({ message: request.params.messageId, force: true });
                events.publish({ type: 'message-updated', channelId: channel.id, message: toApiMessage(fresh) });
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
                const fresh = await channel.messages.fetch({ message: request.params.messageId, force: true });
                events.publish({ type: 'message-updated', channelId: channel.id, message: toApiMessage(fresh) });
                reply.code(204).send();
            } catch (err) {
                request.log.error({ err }, 'failed to remove reaction');
                reply.code(502).send({ error: 'Failed to remove reaction' });
            }
        }
    );

    server.get<{ Params: { stickerId: string } }>(
        '/api/dm/stickers/:stickerId',
        async (request, reply) => {
            const id = request.params.stickerId.replace(/[^0-9]/g, '');
            if (!id) { reply.code(400).send({ error: 'invalid sticker id' }); return; }
            try {
                const upstream = await fetch(`https://cdn.discordapp.com/stickers/${id}.json`);
                if (!upstream.ok) { reply.code(upstream.status).send({ error: 'upstream' }); return; }
                const body = await upstream.text();
                reply.header('content-type', 'application/json');
                reply.header('cache-control', 'public, max-age=86400');
                reply.send(body);
            } catch (err) {
                request.log.error({ err }, 'sticker proxy failed');
                reply.code(502).send({ error: 'proxy failed' });
            }
        }
    );

    server.get('/api/dm/events', async (request, reply) => {
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
