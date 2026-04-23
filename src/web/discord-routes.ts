import type { FastifyInstance } from 'fastify';
import type { Client } from 'discordx';

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
