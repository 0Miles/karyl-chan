import type { FastifyInstance } from 'fastify';
import { AuditLogEvent } from 'discord.js';
import { requireGuildCapability } from './route-guards.js';
import { isSnowflake } from './validators.js';
import { avatarUrlFor } from './message-mapper.js';
import { guildChannelEventBus } from './guild-channel-event-bus.js';
import { TodoChannel } from '../models/todo-channel.model.js';
import { PictureOnlyChannel } from '../models/picture-only-channel.model.js';
import { RconForwardChannel } from '../models/rcon-forward-channel.model.js';
import { RoleEmoji, addRoleEmoji } from '../models/role-emoji.model.js';
import { RoleEmojiGroup } from '../models/role-emoji-group.model.js';
import { RoleReceiveMessage } from '../models/role-receive-message.model.js';
import { CapabilityGrant } from '../models/capability-grant.model.js';
import {
    type GuildManagementRoutesOptions,
    EMOJI_REGEX,
    validateGroupId
} from './guild-management-shared.js';
import { registerGuildMemberRoutes } from './guild-member-routes.js';
import { registerGuildMessageRoutes } from './guild-message-routes.js';
import { registerGuildRoleRoutes } from './guild-role-routes.js';
import { registerGuildSettingsRoutes } from './guild-settings-routes.js';
import { registerGuildAutomodRoutes } from './guild-automod-routes.js';
import { registerGuildChannelMgmtRoutes } from './guild-channel-mgmt-routes.js';

export type { GuildManagementRoutesOptions };

/**
 * Routes for guild-level moderation actions: member kick / ban / timeout /
 * nickname / role assignment, and message-channel ops that affect a single
 * message (pin, unpin, crosspost) plus channel-level bulk delete.
 *
 * All endpoints require `guild.write` and forward to discord.js, which
 * surfaces a 50013 when the bot lacks the underlying Discord permission
 * (KickMembers / BanMembers / ModerateMembers / ManageNicknames /
 * ManageRoles / ManageMessages). We don't pre-check those because Discord
 * is the source of truth and double-checking just creates drift.
 */
export async function registerGuildManagementRoutes(
    server: FastifyInstance,
    options: GuildManagementRoutesOptions
): Promise<void> {
    const { bot } = options;
    const events = options.eventBus ?? guildChannelEventBus;

    await registerGuildMemberRoutes(server, options);
    await registerGuildMessageRoutes(server, options);
    await registerGuildRoleRoutes(server, options);
    await registerGuildSettingsRoutes(server, options);
    await registerGuildAutomodRoutes(server, options);
    await registerGuildChannelMgmtRoutes(server, options, events);

    // ── Audit log ──────────────────────────────────────────────────────

    server.get<{ Params: { guildId: string }; Querystring: { limit?: string; before?: string; type?: string; user?: string } }>(
        '/api/guilds/:guildId/audit-logs',
        async (request, reply) => {
            if (!requireGuildCapability(request, reply, request.params.guildId, 'manage')) return;
            const guild = bot.guilds.cache.get(request.params.guildId);
            if (!guild) { reply.code(404).send({ error: 'Unknown guild' }); return; }
            const limit = Math.min(Math.max(Number(request.query.limit ?? 50) || 50, 1), 100);
            const before = typeof request.query.before === 'string' && isSnowflake(request.query.before) ? request.query.before : undefined;
            const userId = typeof request.query.user === 'string' && isSnowflake(request.query.user) ? request.query.user : undefined;
            const typeNum = request.query.type ? Number(request.query.type) : undefined;
            const type = typeof typeNum === 'number' && Number.isFinite(typeNum) ? typeNum : undefined;
            try {
                const logs = await guild.fetchAuditLogs({ limit, before, user: userId, type });
                const entries = [...logs.entries.values()].map(e => ({
                    id: e.id,
                    actionType: Number(e.action),
                    actionTypeName: AuditLogEvent[e.action] ?? `Action ${e.action}`,
                    targetId: e.targetId,
                    executor: e.executor
                        ? {
                            id: e.executor.id,
                            username: e.executor.username,
                            globalName: e.executor.globalName ?? null,
                            avatarUrl: avatarUrlFor(e.executor.id, e.executor.avatar, 64)
                        }
                        : null,
                    reason: e.reason ?? null,
                    createdAt: e.createdAt.toISOString(),
                    changes: (e.changes ?? []).map(c => ({
                        key: c.key,
                        oldValue: c.old ?? null,
                        newValue: c.new ?? null
                    }))
                }));
                return { entries };
            } catch (err) {
                request.log.error({ err }, 'failed to fetch audit logs');
                reply.code(502).send({ error: 'Failed to fetch audit logs' });
            }
        }
    );

    // ── Bot-feature CRUD ───────────────────────────────────────────────
    //
    // Mirrors the slash commands (todo-channel, picture-only, rcon, role-emoji,
    // role-receive, capability grants) so admins can manage these from the
    // web panel without dropping into Discord. The data lives in our local
    // SQL models — Discord.js is only used for cosmetic name lookups.

    // Todo channels ─────────────────────────────────────────────────────
    server.post<{ Params: { guildId: string }; Body: { channelId?: unknown } }>(
        '/api/guilds/:guildId/feature/todo-channels',
        async (request, reply) => {
            if (!requireGuildCapability(request, reply, request.params.guildId, 'manage')) return;
            const { guildId } = request.params;
            const channelId = request.body?.channelId;
            if (typeof channelId !== 'string' || !isSnowflake(channelId)) {
                reply.code(400).send({ error: 'channelId required' }); return;
            }
            await TodoChannel.upsert({ channelId, guildId });
            reply.code(204).send();
        }
    );
    server.delete<{ Params: { guildId: string; channelId: string } }>(
        '/api/guilds/:guildId/feature/todo-channels/:channelId',
        async (request, reply) => {
            if (!requireGuildCapability(request, reply, request.params.guildId, 'manage')) return;
            const { guildId, channelId } = request.params;
            await TodoChannel.destroy({ where: { guildId, channelId } });
            reply.code(204).send();
        }
    );

    // Picture-only channels ─────────────────────────────────────────────
    server.post<{ Params: { guildId: string }; Body: { channelId?: unknown } }>(
        '/api/guilds/:guildId/feature/picture-only-channels',
        async (request, reply) => {
            if (!requireGuildCapability(request, reply, request.params.guildId, 'manage')) return;
            const { guildId } = request.params;
            const channelId = request.body?.channelId;
            if (typeof channelId !== 'string' || !isSnowflake(channelId)) {
                reply.code(400).send({ error: 'channelId required' }); return;
            }
            await PictureOnlyChannel.upsert({ channelId, guildId });
            reply.code(204).send();
        }
    );
    server.delete<{ Params: { guildId: string; channelId: string } }>(
        '/api/guilds/:guildId/feature/picture-only-channels/:channelId',
        async (request, reply) => {
            if (!requireGuildCapability(request, reply, request.params.guildId, 'manage')) return;
            const { guildId, channelId } = request.params;
            await PictureOnlyChannel.destroy({ where: { guildId, channelId } });
            reply.code(204).send();
        }
    );

    // RCON forward channels ─────────────────────────────────────────────
    server.post<{ Params: { guildId: string }; Body: {
        channelId?: unknown; host?: unknown; port?: unknown; password?: unknown;
        commandPrefix?: unknown; triggerPrefix?: unknown;
    } }>(
        '/api/guilds/:guildId/feature/rcon-channels',
        async (request, reply) => {
            if (!requireGuildCapability(request, reply, request.params.guildId, 'manage')) return;
            const { guildId } = request.params;
            const b = request.body ?? {};
            if (typeof b.channelId !== 'string' || !isSnowflake(b.channelId)) {
                reply.code(400).send({ error: 'channelId required' }); return;
            }
            await RconForwardChannel.upsert({
                channelId: b.channelId,
                guildId,
                host: typeof b.host === 'string' ? b.host : null,
                port: typeof b.port === 'number' && Number.isFinite(b.port) ? Math.floor(b.port) : null,
                password: typeof b.password === 'string' ? b.password : null,
                commandPrefix: typeof b.commandPrefix === 'string' ? b.commandPrefix : null,
                triggerPrefix: typeof b.triggerPrefix === 'string' ? b.triggerPrefix : null
            });
            reply.code(204).send();
        }
    );
    server.delete<{ Params: { guildId: string; channelId: string } }>(
        '/api/guilds/:guildId/feature/rcon-channels/:channelId',
        async (request, reply) => {
            if (!requireGuildCapability(request, reply, request.params.guildId, 'manage')) return;
            const { guildId, channelId } = request.params;
            await RconForwardChannel.destroy({ where: { guildId, channelId } });
            reply.code(204).send();
        }
    );

    // Role-emoji groups ─────────────────────────────────────────────────
    //
    // Groups bucket emoji→role mappings; one guild can have many. A
    // watched message can pin one or more groups (see the junction
    // routes below) so the same physical emoji can grant different
    // roles depending on which message it's reacted to.
    server.post<{ Params: { guildId: string }; Body: { name?: unknown } }>(
        '/api/guilds/:guildId/feature/role-emoji-groups',
        async (request, reply) => {
            if (!requireGuildCapability(request, reply, request.params.guildId, 'manage')) return;
            const { guildId } = request.params;
            const name = typeof request.body?.name === 'string' ? request.body.name.trim() : '';
            if (!name) { reply.code(400).send({ error: 'name required' }); return; }
            try {
                const created = await RoleEmojiGroup.create({ guildId, name });
                reply.code(200).send({ id: created.getDataValue('id'), name });
            } catch (err) {
                request.log.error({ err }, 'failed to add role-emoji group');
                reply.code(409).send({ error: 'group with that name already exists' });
            }
        }
    );
    server.delete<{ Params: { guildId: string; groupId: string } }>(
        '/api/guilds/:guildId/feature/role-emoji-groups/:groupId',
        async (request, reply) => {
            if (!requireGuildCapability(request, reply, request.params.guildId, 'manage')) return;
            const { guildId } = request.params;
            const groupId = parseInt(request.params.groupId, 10);
            if (!Number.isFinite(groupId)) { reply.code(400).send({ error: 'invalid groupId' }); return; }
            // RoleEmojiGroup is the source of truth for "does this
            // group belong to this guild" — the where clause rejects
            // ids from another guild before we cascade.
            const deleted = await RoleEmojiGroup.destroy({ where: { guildId, id: groupId } });
            if (deleted === 0) { reply.code(404).send({ error: 'group not found' }); return; }
            reply.code(204).send();
        }
    );

    // Role-emoji mapping ────────────────────────────────────────────────
    //
    // The `emoji` body parses with the same regex the slash command uses,
    // so the call site can pass a raw emoji literal (`👍` or `<:foo:123>`)
    // instead of having to mirror the parsing logic. Either branch fills
    // both PK columns (emojiChar / emojiId) so the SQL row is unique.
    server.post<{ Params: { guildId: string }; Body: { groupId?: unknown; roleId?: unknown; emoji?: unknown } }>(
        '/api/guilds/:guildId/feature/role-emoji',
        async (request, reply) => {
            if (!requireGuildCapability(request, reply, request.params.guildId, 'manage')) return;
            const { guildId } = request.params;
            const b = request.body ?? {};
            const groupId = typeof b.groupId === 'number' ? b.groupId : Number(b.groupId);
            if (!Number.isFinite(groupId)) { reply.code(400).send({ error: 'groupId required' }); return; }
            if (typeof b.roleId !== 'string' || !isSnowflake(b.roleId)) {
                reply.code(400).send({ error: 'roleId required' }); return;
            }
            if (typeof b.emoji !== 'string' || !b.emoji.trim()) {
                reply.code(400).send({ error: 'emoji required' }); return;
            }
            // Reject mappings against a group from another guild — the
            // (groupId, emojiId, emojiChar) PK doesn't carry guildId so
            // we have to check ownership ourselves.
            const owning = await RoleEmojiGroup.findOne({ where: { guildId, id: groupId } });
            if (!owning) { reply.code(404).send({ error: 'group not found' }); return; }
            const m = EMOJI_REGEX.exec(b.emoji);
            if (!m) { reply.code(400).send({ error: 'unparseable emoji' }); return; }
            try {
                await addRoleEmoji(groupId, b.roleId, m[1] ?? '', m[2] ?? '', m[3] ?? '');
                reply.code(204).send();
            } catch (err) {
                request.log.error({ err }, 'failed to add role-emoji');
                reply.code(409).send({ error: 'mapping already exists in this group' });
            }
        }
    );
    server.delete<{ Params: { guildId: string }; Querystring: { groupId?: string; emojiChar?: string; emojiId?: string } }>(
        '/api/guilds/:guildId/feature/role-emoji',
        async (request, reply) => {
            if (!requireGuildCapability(request, reply, request.params.guildId, 'manage')) return;
            const { guildId } = request.params;
            const groupId = parseInt(request.query.groupId ?? '', 10);
            const emojiChar = typeof request.query.emojiChar === 'string' ? request.query.emojiChar : '';
            const emojiId = typeof request.query.emojiId === 'string' ? request.query.emojiId : '';
            if (!Number.isFinite(groupId)) { reply.code(400).send({ error: 'groupId required' }); return; }
            if (!emojiChar && !emojiId) { reply.code(400).send({ error: 'emojiChar or emojiId required' }); return; }
            const owning = await RoleEmojiGroup.findOne({ where: { guildId, id: groupId } });
            if (!owning) { reply.code(404).send({ error: 'group not found' }); return; }
            await RoleEmoji.destroy({ where: { groupId, emojiChar, emojiId } });
            reply.code(204).send();
        }
    );

    // Role-receive messages ─────────────────────────────────────────────
    server.post<{ Params: { guildId: string }; Body: { channelId?: unknown; messageId?: unknown; groupId?: unknown } }>(
        '/api/guilds/:guildId/feature/role-receive-messages',
        async (request, reply) => {
            if (!requireGuildCapability(request, reply, request.params.guildId, 'manage')) return;
            const { guildId } = request.params;
            const b = request.body ?? {};
            if (typeof b.channelId !== 'string' || !isSnowflake(b.channelId)) {
                reply.code(400).send({ error: 'channelId required' }); return;
            }
            if (typeof b.messageId !== 'string' || !isSnowflake(b.messageId)) {
                reply.code(400).send({ error: 'messageId required' }); return;
            }
            const groupId = await validateGroupId(b.groupId, guildId);
            if (groupId === null) { reply.code(400).send({ error: 'invalid groupId' }); return; }
            await RoleReceiveMessage.upsert({ guildId, channelId: b.channelId, messageId: b.messageId, groupId });
            reply.code(204).send();
        }
    );
    server.put<{
        Params: { guildId: string; channelId: string; messageId: string };
        Body: { groupId?: unknown }
    }>(
        '/api/guilds/:guildId/feature/role-receive-messages/:channelId/:messageId/group',
        async (request, reply) => {
            if (!requireGuildCapability(request, reply, request.params.guildId, 'manage')) return;
            const { guildId, channelId, messageId } = request.params;
            const existing = await RoleReceiveMessage.findOne({ where: { guildId, channelId, messageId } });
            if (!existing) { reply.code(404).send({ error: 'watched message not found' }); return; }
            const groupId = await validateGroupId(request.body?.groupId, guildId);
            if (groupId === null) { reply.code(400).send({ error: 'invalid groupId' }); return; }
            await RoleReceiveMessage.update({ groupId }, { where: { guildId, channelId, messageId } });
            reply.code(204).send();
        }
    );
    server.delete<{ Params: { guildId: string; channelId: string; messageId: string } }>(
        '/api/guilds/:guildId/feature/role-receive-messages/:channelId/:messageId',
        async (request, reply) => {
            if (!requireGuildCapability(request, reply, request.params.guildId, 'manage')) return;
            const { guildId, channelId, messageId } = request.params;
            await RoleReceiveMessage.destroy({ where: { guildId, channelId, messageId } });
            reply.code(204).send();
        }
    );

    // Capability grants ─────────────────────────────────────────────────
    server.post<{ Params: { guildId: string }; Body: { capability?: unknown; roleId?: unknown } }>(
        '/api/guilds/:guildId/feature/capability-grants',
        async (request, reply) => {
            if (!requireGuildCapability(request, reply, request.params.guildId, 'manage')) return;
            const { guildId } = request.params;
            const b = request.body ?? {};
            if (typeof b.capability !== 'string' || !b.capability.trim()) {
                reply.code(400).send({ error: 'capability required' }); return;
            }
            if (typeof b.roleId !== 'string' || !isSnowflake(b.roleId)) {
                reply.code(400).send({ error: 'roleId required' }); return;
            }
            await CapabilityGrant.upsert({ guildId, capability: b.capability.trim(), roleId: b.roleId });
            reply.code(204).send();
        }
    );
    server.delete<{ Params: { guildId: string; capability: string; roleId: string } }>(
        '/api/guilds/:guildId/feature/capability-grants/:capability/:roleId',
        async (request, reply) => {
            if (!requireGuildCapability(request, reply, request.params.guildId, 'manage')) return;
            const { guildId, capability, roleId } = request.params;
            await CapabilityGrant.destroy({ where: { guildId, capability, roleId } });
            reply.code(204).send();
        }
    );
}
