import type { FastifyInstance } from 'fastify';
import type { Client } from 'discordx';
import type { Message as DjsMessage } from 'discord.js';
import { avatarUrlFor, bannerUrlFor, guildAvatarUrlFor, guildBannerUrlFor } from './message-mapper.js';

export interface DiscordRoutesOptions {
    bot: Client;
}

interface EmojiRow {
    id: string;
    name: string;
    animated: boolean;
}

interface StickerRow {
    id: string;
    name: string;
    formatType: number;
    description: string | null;
}

interface GuildBucket<T> {
    guildId: string;
    guildName: string;
    items: T[];
}

function messagePreview(message: DjsMessage): string {
    const content = message.content.trim();
    if (content) return content.length > 60 ? `${content.slice(0, 60)}…` : content;
    if (message.stickers.size > 0) {
        const first = [...message.stickers.values()][0];
        return `[${first.name}]`;
    }
    if (message.attachments.size > 0) {
        const first = [...message.attachments.values()][0];
        return `📎 ${first.name}`;
    }
    if (message.embeds.length > 0) return '[embed]';
    return '(empty)';
}

export async function registerDiscordRoutes(server: FastifyInstance, options: DiscordRoutesOptions): Promise<void> {
    const { bot } = options;

    server.get('/api/discord/emojis', async () => {
        const buckets: GuildBucket<EmojiRow>[] = [];
        for (const guild of bot.guilds.cache.values()) {
            const items: EmojiRow[] = [...guild.emojis.cache.values()].map(e => ({
                id: e.id,
                name: e.name ?? '',
                animated: !!e.animated
            }));
            if (items.length > 0) {
                items.sort((a, b) => a.name.localeCompare(b.name));
                buckets.push({ guildId: guild.id, guildName: guild.name, items });
            }
        }
        return { guilds: buckets };
    });

    // Profile card data: base user (avatar, banner, display name) plus
    // guild-specific member fields (nickname, roles) when `?guildId=…` is
    // supplied. `force: true` is required to pull `banner` + `accentColor`
    // — the cached user object from a message event doesn't carry them.
    server.get<{ Params: { userId: string }; Querystring: { guildId?: string } }>(
        '/api/discord/users/:userId',
        async (request, reply) => {
            try {
                const user = await bot.users.fetch(request.params.userId, { force: true });
                const base = {
                    id: user.id,
                    username: user.username,
                    globalName: user.globalName ?? null,
                    discriminator: user.discriminator === '0' ? null : user.discriminator,
                    avatarUrl: avatarUrlFor(user.id, user.avatar, 256),
                    bannerUrl: bannerUrlFor(user.id, user.banner, 600),
                    accentColor: user.accentColor ?? null,
                    bot: !!user.bot
                };
                const guildId = request.query.guildId;
                if (!guildId) return { user: base, member: null };

                const guild = bot.guilds.cache.get(guildId);
                if (!guild) { reply.code(404).send({ error: 'guild not found' }); return; }
                try {
                    // `force: true` so we refetch member data (avatar/banner
                    // can change; cache may be stale from older gateway
                    // events that lack the newer banner field entirely).
                    const member = await guild.members.fetch({ user: request.params.userId, force: true });
                    // Sort roles highest first, skip @everyone (role id === guildId).
                    const roles = [...member.roles.cache.values()]
                        .filter(r => r.id !== guildId)
                        .sort((a, b) => b.position - a.position)
                        .map(r => ({
                            id: r.id,
                            name: r.name,
                            color: r.color ? `#${r.color.toString(16).padStart(6, '0')}` : null,
                            position: r.position
                        }));
                    return {
                        user: base,
                        member: {
                            nickname: member.nickname ?? null,
                            joinedAt: member.joinedAt?.toISOString() ?? null,
                            // Per-guild avatar/banner are distinct from the
                            // user's global ones; frontend prefers these
                            // when present to match Discord's own rendering.
                            avatarUrl: member.avatar ? guildAvatarUrlFor(guildId, user.id, member.avatar, 256) : null,
                            bannerUrl: guildBannerUrlFor(guildId, user.id, member.banner, 600),
                            roles
                        }
                    };
                } catch {
                    // User exists but isn't a member of this guild.
                    return { user: base, member: null };
                }
            } catch (err) {
                request.log.error({ err }, 'failed to fetch user');
                reply.code(404).send({ error: 'user not found' });
            }
        }
    );

    // Metadata for a Discord permalink (message link or channel link).
    // `guild=@me` (or omitted) indicates a DM surface. `message` is
    // optional — when absent the endpoint returns channel/guild info
    // with a null preview so the client can render a channel-only chip.
    // Returns 404 when anything in the chain is unreachable (bot isn't
    // in the guild, channel isn't visible, message is gone); the client
    // falls back to the `# 不明` chip in that case.
    server.get<{ Querystring: { guild?: string; channel?: string; message?: string } }>(
        '/api/discord/message-link',
        async (request, reply) => {
            const rawGuild = request.query.guild;
            const guildId = rawGuild && rawGuild !== '@me' ? rawGuild : null;
            const channelId = request.query.channel;
            const messageId = request.query.message && request.query.message.length > 0
                ? request.query.message
                : null;
            if (!channelId) {
                reply.code(400).send({ error: 'channel required' });
                return;
            }
            try {
                if (guildId) {
                    const guild = bot.guilds.cache.get(guildId);
                    if (!guild) {
                        request.log.info({ guildId }, 'message-link: guild not in bot cache');
                        reply.code(404).send({ error: 'guild not accessible' });
                        return;
                    }
                    // Threads / announcement / forum posts all live under
                    // `guild.channels` (including threads in most setups)
                    // but a freshly created one may not be cached yet —
                    // fall back to a REST fetch before giving up.
                    let channel = guild.channels.cache.get(channelId) ?? null;
                    if (!channel) {
                        channel = await guild.channels.fetch(channelId).catch(() => null);
                    }
                    if (!channel || !channel.isTextBased()) {
                        request.log.info({ guildId, channelId, type: channel?.type }, 'message-link: channel not accessible or not text-based');
                        reply.code(404).send({ error: 'channel not accessible' });
                        return;
                    }
                    const message = messageId ? await channel.messages.fetch(messageId) : null;
                    return {
                        guildId,
                        guildName: guild.name,
                        guildIconUrl: guild.iconURL({ size: 64, extension: 'webp' }) ?? null,
                        channelId,
                        channelName: channel.name ?? '',
                        messageId: message?.id ?? null,
                        preview: message ? messagePreview(message) : null
                    };
                }
                // DM path: bot can only reach DMs where it's a party.
                const channel = await bot.channels.fetch(channelId);
                if (!channel || !channel.isDMBased()) {
                    request.log.info({ channelId, type: channel?.type }, 'message-link: DM channel not accessible');
                    reply.code(404).send({ error: 'channel not accessible' });
                    return;
                }
                const message = messageId ? await channel.messages.fetch(messageId) : null;
                let channelName = 'Direct Message';
                if ('recipient' in channel && channel.recipient) {
                    channelName = channel.recipient.globalName ?? channel.recipient.username;
                }
                return {
                    guildId: null,
                    guildName: null,
                    guildIconUrl: null,
                    channelId,
                    channelName,
                    messageId: message?.id ?? null,
                    preview: message ? messagePreview(message) : null
                };
            } catch (err) {
                request.log.info({ err, guildId, channelId, messageId }, 'message-link fetch threw');
                reply.code(404).send({ error: 'not accessible' });
            }
        }
    );

    server.get('/api/discord/stickers', async () => {
        const buckets: GuildBucket<StickerRow>[] = [];
        for (const guild of bot.guilds.cache.values()) {
            try {
                const stickers = guild.stickers.cache.size > 0
                    ? guild.stickers.cache
                    : await guild.stickers.fetch();
                const items: StickerRow[] = [...stickers.values()].map(s => ({
                    id: s.id,
                    name: s.name,
                    formatType: Number(s.format),
                    description: s.description ?? null
                }));
                if (items.length > 0) {
                    items.sort((a, b) => a.name.localeCompare(b.name));
                    buckets.push({ guildId: guild.id, guildName: guild.name, items });
                }
            } catch (err) {
                server.log.warn({ err, guildId: guild.id }, 'failed to fetch stickers');
            }
        }
        return { guilds: buckets };
    });
}
