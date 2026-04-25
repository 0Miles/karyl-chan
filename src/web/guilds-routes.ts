import type { FastifyInstance } from 'fastify';
import type { Client } from 'discordx';
import { TodoChannel } from '../models/todo-channel.model.js';
import { PictureOnlyChannel } from '../models/picture-only-channel.model.js';
import { RconForwardChannel } from '../models/rcon-forward-channel.model.js';
import { RoleEmoji } from '../models/role-emoji.model.js';
import { RoleReceiveMessage } from '../models/role-receive-message.model.js';
import { ChannelType } from 'discord.js';
import { CapabilityGrant } from '../models/capability-grant.model.js';
import { requireCapability } from './route-guards.js';

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

    server.get('/api/guilds', async (request, reply) => {
        if (!requireCapability(request, reply, 'guild.read')) return;
        const guilds = summariseGuilds(bot).sort((a, b) => a.name.localeCompare(b.name));
        return { guilds };
    });

    server.get<{ Params: { guildId: string } }>('/api/guilds/:guildId', async (request, reply) => {
        if (!requireCapability(request, reply, 'guild.read')) return;
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

    server.get<{ Params: { guildId: string } }>('/api/guilds/:guildId/invites', async (request, reply) => {
        if (!requireCapability(request, reply, 'guild.read')) return;
        const guild = bot.guilds.cache.get(request.params.guildId);
        if (!guild) { reply.code(404).send({ error: 'Bot is not in this guild' }); return; }
        try {
            const invites = await guild.invites.fetch();
            return {
                invites: [...invites.values()].map(inv => ({
                    code: inv.code,
                    url: inv.url,
                    channelId: inv.channelId ?? null,
                    channelName: inv.channel?.name ?? null,
                    inviterId: inv.inviterId ?? null,
                    inviterName: inv.inviter?.username ?? null,
                    uses: inv.uses ?? 0,
                    maxUses: inv.maxUses ?? 0,
                    maxAge: inv.maxAge ?? 0,
                    temporary: !!inv.temporary,
                    expiresAt: inv.expiresAt ? inv.expiresAt.toISOString() : null,
                    createdAt: inv.createdAt ? inv.createdAt.toISOString() : null
                }))
            };
        } catch (err) {
            request.log.error({ err }, 'failed to fetch invites');
            reply.code(502).send({ error: 'Failed to fetch invites' });
        }
    });

    server.post<{
        Params: { guildId: string };
        Body: { channelId?: string; maxAge?: number; maxUses?: number; temporary?: boolean }
    }>('/api/guilds/:guildId/invites', async (request, reply) => {
        if (!requireCapability(request, reply, 'guild.write')) return;
        const guild = bot.guilds.cache.get(request.params.guildId);
        if (!guild) { reply.code(404).send({ error: 'Bot is not in this guild' }); return; }
        const body = request.body ?? {};
        // Default to a known channel — we need an invitable target. The
        // caller supplies it explicitly when they have a preference;
        // otherwise we fall back to the system channel, then any text
        // channel we can write in.
        let channel = body.channelId
            ? guild.channels.cache.get(body.channelId)
            : (guild.systemChannel ?? guild.channels.cache.find(c => c.type === ChannelType.GuildText) ?? null);
        if (!channel || !('createInvite' in channel)) {
            reply.code(400).send({ error: 'No invitable channel found' });
            return;
        }
        // Bound the input — Discord's max age is 7 days (604800s); 0 means
        // never expire. maxUses 0 means unlimited. Anything else is rejected.
        const maxAge = Number.isFinite(body.maxAge) ? Math.max(0, Math.min(Number(body.maxAge), 604800)) : 86400;
        const maxUses = Number.isFinite(body.maxUses) ? Math.max(0, Math.min(Number(body.maxUses), 100)) : 0;
        try {
            const invite = await (channel as { createInvite: (opts: object) => Promise<{ code: string; url: string; expiresAt: Date | null }> }).createInvite({
                maxAge,
                maxUses,
                temporary: !!body.temporary,
                unique: true
            });
            return {
                code: invite.code,
                url: invite.url,
                expiresAt: invite.expiresAt ? invite.expiresAt.toISOString() : null
            };
        } catch (err) {
            request.log.error({ err }, 'failed to create invite');
            reply.code(502).send({ error: 'Failed to create invite' });
        }
    });
}
