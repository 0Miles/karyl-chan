import type { FastifyInstance } from 'fastify';
import type { Client } from 'discordx';
import type { DMChannel, EmojiIdentifierResolvable, Message as DjsMessage } from 'discord.js';
import { ChannelType } from 'discord.js';
import { dmInboxService, type DmInboxStore } from './dm-inbox.service.js';
import { toApiMessage } from './message-mapper.js';
import type { MessageEmoji } from './message-types.js';

export interface DmRoutesOptions {
    bot: Client;
    inbox?: DmInboxStore;
}

interface ReactionBody {
    emoji?: { id?: string | null; name?: string; animated?: boolean };
}

interface SendBody {
    content?: string;
    replyToMessageId?: string;
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

    server.get('/api/dm/channels', async () => {
        return { channels: await inbox.listChannels() };
    });

    server.get<{ Params: { channelId: string }; Querystring: { limit?: string; before?: string } }>(
        '/api/dm/channels/:channelId/messages',
        async (request, reply) => {
            const { channelId } = request.params;
            const limit = request.query.limit ? Number(request.query.limit) : undefined;
            const before = typeof request.query.before === 'string' && request.query.before.length > 0 ? request.query.before : undefined;
            const summary = await inbox.getChannel(channelId);
            if (!summary) {
                reply.code(404).send({ error: 'Unknown channel' });
                return;
            }
            const messages = await inbox.getMessages(channelId, { limit, before });
            return {
                channel: summary,
                messages,
                hasMore: messages.length === (limit ?? 10)
            };
        }
    );

    server.post<{ Params: { channelId: string }; Body: SendBody }>(
        '/api/dm/channels/:channelId/messages',
        async (request, reply) => {
            const channel = await fetchDmChannel(bot, request.params.channelId);
            if (!channel) {
                reply.code(404).send({ error: 'Unknown DM channel' });
                return;
            }
            const content = typeof request.body?.content === 'string' ? request.body.content : '';
            if (!content.trim()) {
                reply.code(400).send({ error: 'content required' });
                return;
            }
            try {
                const sent: DjsMessage = await channel.send({
                    content,
                    reply: request.body?.replyToMessageId
                        ? { messageReference: request.body.replyToMessageId, failIfNotExists: false }
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
        if (!recipientUserId) {
            reply.code(400).send({ error: 'recipientUserId required' });
            return;
        }
        try {
            const user = await bot.users.fetch(recipientUserId);
            const channel = await user.createDM();
            const summary = await inbox.upsertChannel(channel.id, {
                id: user.id,
                username: user.username,
                globalName: user.globalName ?? null,
                avatarUrl: user.displayAvatarURL({ size: 128 })
            });
            return { channel: summary };
        } catch (err) {
            request.log.error({ err }, 'failed to start DM');
            reply.code(404).send({ error: 'User not found or DMs unavailable' });
        }
    });

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
                await inbox.updateMessage(channel.id, toApiMessage(message));
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
                await inbox.updateMessage(channel.id, toApiMessage(message));
                reply.code(204).send();
            } catch (err) {
                request.log.error({ err }, 'failed to remove reaction');
                reply.code(502).send({ error: 'Failed to remove reaction' });
            }
        }
    );
}
