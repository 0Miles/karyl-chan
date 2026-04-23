import type { FastifyInstance } from 'fastify';
import type { Client } from 'discordx';
import { ChannelType, type CategoryChannel, type EmojiIdentifierResolvable, type TextChannel } from 'discord.js';
import { guildChannelEventBus, type GuildChannelEventBus } from './guild-channel-event-bus.js';
import { toApiMessage } from './message-mapper.js';
import type { MessageEmoji } from './message-types.js';

export interface GuildChannelRoutesOptions {
    bot: Client;
    eventBus?: GuildChannelEventBus;
}

interface ReactionBody {
    emoji?: { id?: string | null; name?: string; animated?: boolean };
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

function fetchTextChannel(bot: Client, guildId: string, channelId: string): TextChannel | null {
    const guild = bot.guilds.cache.get(guildId);
    if (!guild) return null;
    const channel = guild.channels.cache.get(channelId);
    if (!channel || channel.type !== ChannelType.GuildText) return null;
    return channel as TextChannel;
}

export async function registerGuildChannelRoutes(server: FastifyInstance, options: GuildChannelRoutesOptions): Promise<void> {
    const { bot } = options;
    const events = options.eventBus ?? guildChannelEventBus;

    // Static path — Fastify prioritises it over /:guildId even when registered after.
    server.get('/api/guilds/events', async (request, reply) => {
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
                request.log.error({ err }, 'failed to write guild SSE event');
            }
        });

        request.raw.on('close', () => {
            clearInterval(heartbeat);
            unsubscribe();
        });
    });

    server.get<{ Params: { guildId: string } }>(
        '/api/guilds/:guildId/text-channels',
        async (request, reply) => {
            const { guildId } = request.params;
            const guild = bot.guilds.cache.get(guildId);
            if (!guild) { reply.code(404).send({ error: 'Unknown guild' }); return; }

            const all = [...guild.channels.cache.values()];
            const categoryChannels = (all.filter(c => c.type === ChannelType.GuildCategory) as CategoryChannel[])
                .sort((a, b) => a.position - b.position);
            const textChannels = (all.filter(c => c.type === ChannelType.GuildText) as TextChannel[])
                .sort((a, b) => a.position - b.position);

            const categoryIds = new Set(categoryChannels.map(c => c.id));
            const uncategorized = textChannels.filter(c => !c.parentId || !categoryIds.has(c.parentId));
            const categories: Array<{ id: string | null; name: string | null; channels: { id: string; name: string }[] }> = [];

            if (uncategorized.length > 0) {
                categories.push({ id: null, name: null, channels: uncategorized.map(c => ({ id: c.id, name: c.name })) });
            }
            for (const cat of categoryChannels) {
                const children = textChannels.filter(c => c.parentId === cat.id).map(c => ({ id: c.id, name: c.name }));
                if (children.length > 0) {
                    categories.push({ id: cat.id, name: cat.name, channels: children });
                }
            }

            return { categories };
        }
    );

    server.get<{ Params: { guildId: string; channelId: string }; Querystring: { limit?: string; before?: string } }>(
        '/api/guilds/:guildId/text-channels/:channelId/messages',
        async (request, reply) => {
            const { guildId, channelId } = request.params;
            const limit = Math.min(Math.max(Number(request.query.limit ?? 16) || 16, 1), 50);
            const before = typeof request.query.before === 'string' && request.query.before.length > 0 ? request.query.before : undefined;

            const channel = fetchTextChannel(bot, guildId, channelId);
            if (!channel) { reply.code(404).send({ error: 'Unknown channel' }); return; }

            try {
                const fetched = await channel.messages.fetch({ limit, before });
                const messages = [...fetched.values()]
                    .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
                    .map(toApiMessage);
                return { messages, hasMore: messages.length === limit };
            } catch (err) {
                request.log.error({ err }, 'failed to fetch guild channel messages');
                reply.code(502).send({ error: 'Failed to fetch messages' });
            }
        }
    );

    server.post<{ Params: { guildId: string; channelId: string } }>(
        '/api/guilds/:guildId/text-channels/:channelId/messages',
        async (request, reply) => {
            const { guildId, channelId } = request.params;
            const channel = fetchTextChannel(bot, guildId, channelId);
            if (!channel) { reply.code(404).send({ error: 'Unknown channel' }); return; }

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
                const sent = await channel.send({
                    content: content || undefined,
                    files: files.length > 0 ? files : undefined,
                    stickers: stickerIds.length > 0 ? stickerIds : undefined,
                    reply: replyToMessageId
                        ? { messageReference: replyToMessageId, failIfNotExists: false }
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
            const { guildId, channelId, messageId } = request.params;
            const channel = fetchTextChannel(bot, guildId, channelId);
            if (!channel) { reply.code(404).send({ error: 'Unknown channel' }); return; }
            const content = typeof request.body?.content === 'string' ? request.body.content : '';
            if (!content.trim()) { reply.code(400).send({ error: 'content required' }); return; }
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
            const { guildId, channelId, messageId } = request.params;
            const channel = fetchTextChannel(bot, guildId, channelId);
            if (!channel) { reply.code(404).send({ error: 'Unknown channel' }); return; }
            try {
                const message = await channel.messages.fetch(messageId);
                if (message.author.id !== bot.user?.id) {
                    reply.code(403).send({ error: 'Can only delete messages sent by the bot' });
                    return;
                }
                await message.delete();
                events.publish({ type: 'guild-message-deleted', guildId, channelId: channel.id, messageId });
                reply.code(204).send();
            } catch (err) {
                request.log.error({ err }, 'failed to delete guild message');
                reply.code(502).send({ error: 'Failed to delete message' });
            }
        }
    );

    server.post<{ Params: { guildId: string; channelId: string; messageId: string }; Body: ReactionBody }>(
        '/api/guilds/:guildId/text-channels/:channelId/messages/:messageId/reactions',
        async (request, reply) => {
            const { guildId, channelId, messageId } = request.params;
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
            const { guildId, channelId, messageId } = request.params;
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
}
