import type { FastifyInstance } from 'fastify';
import type { Client } from 'discordx';
import { TodoChannel } from '../models/todo-channel.model.js';
import { PictureOnlyChannel } from '../models/picture-only-channel.model.js';
import { RconForwardChannel } from '../models/rcon-forward-channel.model.js';
import { RoleEmoji } from '../models/role-emoji.model.js';
import { RoleReceiveMessage } from '../models/role-receive-message.model.js';
import { CapabilityGrant } from '../models/capability-grant.model.js';

export interface GuildsRoutesOptions {
    bot: Client;
}

interface GuildSummary {
    id: string;
    name: string;
    iconUrl: string | null;
    memberCount: number;
    ownerId: string | null;
    joinedAt: string | null;
}

function summariseGuilds(bot: Client): GuildSummary[] {
    return [...bot.guilds.cache.values()].map(g => ({
        id: g.id,
        name: g.name,
        iconUrl: g.iconURL({ size: 128 }) ?? null,
        memberCount: g.memberCount ?? g.members.cache.size,
        ownerId: g.ownerId ?? null,
        joinedAt: g.joinedAt ? g.joinedAt.toISOString() : null
    }));
}

export async function registerGuildsRoutes(server: FastifyInstance, options: GuildsRoutesOptions): Promise<void> {
    const { bot } = options;

    server.get('/api/guilds', async () => {
        const guilds = summariseGuilds(bot).sort((a, b) => a.name.localeCompare(b.name));
        return { guilds };
    });

    server.get<{ Params: { guildId: string } }>('/api/guilds/:guildId', async (request, reply) => {
        const guild = bot.guilds.cache.get(request.params.guildId);
        if (!guild) {
            reply.code(404).send({ error: 'Bot is not in this guild' });
            return;
        }

        const [
            todoChannels,
            pictureOnlyChannels,
            rconForwardChannels,
            roleEmojis,
            roleReceiveMessages,
            capabilityGrants
        ] = await Promise.all([
            TodoChannel.findAll({ where: { guildId: guild.id } }),
            PictureOnlyChannel.findAll({ where: { guildId: guild.id } }),
            RconForwardChannel.findAll({ where: { guildId: guild.id } }),
            RoleEmoji.findAll({ where: { guildId: guild.id } }),
            RoleReceiveMessage.findAll({ where: { guildId: guild.id } }),
            CapabilityGrant.findAll({ where: { guildId: guild.id } })
        ]);

        const channelName = (id: string) => guild.channels.cache.get(id)?.name ?? null;
        const roleName = (id: string) => guild.roles.cache.get(id)?.name ?? null;
        const roleColor = (id: string) => {
            const r = guild.roles.cache.get(id);
            if (!r) return null;
            const hex = r.color === 0 ? null : `#${r.color.toString(16).padStart(6, '0')}`;
            return hex;
        };

        return {
            guild: {
                id: guild.id,
                name: guild.name,
                iconUrl: guild.iconURL({ size: 256 }) ?? null,
                memberCount: guild.memberCount ?? guild.members.cache.size,
                ownerId: guild.ownerId ?? null,
                joinedAt: guild.joinedAt ? guild.joinedAt.toISOString() : null,
                description: guild.description ?? null
            },
            todoChannels: todoChannels.map(r => ({
                channelId: r.getDataValue('channelId') as string,
                channelName: channelName(r.getDataValue('channelId') as string)
            })),
            pictureOnlyChannels: pictureOnlyChannels.map(r => ({
                channelId: r.getDataValue('channelId') as string,
                channelName: channelName(r.getDataValue('channelId') as string)
            })),
            rconForwardChannels: rconForwardChannels.map(r => ({
                channelId: r.getDataValue('channelId') as string,
                channelName: channelName(r.getDataValue('channelId') as string),
                commandPrefix: r.getDataValue('commandPrefix') as string | null,
                triggerPrefix: r.getDataValue('triggerPrefix') as string | null,
                host: r.getDataValue('host') as string | null,
                port: r.getDataValue('port') as number | null
            })),
            roleEmojis: roleEmojis.map(r => ({
                roleId: r.getDataValue('roleId') as string,
                roleName: roleName(r.getDataValue('roleId') as string),
                emojiName: r.getDataValue('emojiName') as string,
                emojiId: r.getDataValue('emojiId') as string,
                emojiChar: r.getDataValue('emojiChar') as string
            })),
            roleReceiveMessages: roleReceiveMessages.map(r => ({
                channelId: r.getDataValue('channelId') as string,
                channelName: channelName(r.getDataValue('channelId') as string),
                messageId: r.getDataValue('messageId') as string
            })),
            capabilityGrants: capabilityGrants.map(r => ({
                capability: r.getDataValue('capability') as string,
                roleId: r.getDataValue('roleId') as string,
                roleName: roleName(r.getDataValue('roleId') as string),
                roleColor: roleColor(r.getDataValue('roleId') as string)
            }))
        };
    });
}
