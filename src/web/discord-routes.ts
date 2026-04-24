import type { FastifyInstance } from 'fastify';
import type { Client } from 'discordx';
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
