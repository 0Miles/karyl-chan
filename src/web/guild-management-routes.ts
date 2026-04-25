import type { FastifyInstance } from 'fastify';
import type { Client } from 'discordx';
import { ChannelType, PermissionsBitField } from 'discord.js';
import { requireCapability } from './route-guards.js';
import { isSnowflake } from './validators.js';
import { guildChannelEventBus, type GuildChannelEventBus } from './guild-channel-event-bus.js';

export interface GuildManagementRoutesOptions {
    bot: Client;
    eventBus?: GuildChannelEventBus;
}

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

    // ── Member ops ───────────────────────────────────────────────────────

    server.post<{ Params: { guildId: string; userId: string }; Body: { reason?: unknown } }>(
        '/api/guilds/:guildId/members/:userId/kick',
        async (request, reply) => {
            if (!requireCapability(request, reply, 'guild.write')) return;
            const { guildId, userId } = request.params;
            const guild = bot.guilds.cache.get(guildId);
            if (!guild) { reply.code(404).send({ error: 'Unknown guild' }); return; }
            const member = await guild.members.fetch(userId).catch(() => null);
            if (!member) { reply.code(404).send({ error: 'Unknown member' }); return; }
            const reason = typeof request.body?.reason === 'string' ? request.body.reason : undefined;
            try {
                await member.kick(reason);
                reply.code(204).send();
            } catch (err) {
                request.log.error({ err }, 'failed to kick member');
                reply.code(502).send({ error: 'Failed to kick member' });
            }
        }
    );

    server.post<{ Params: { guildId: string; userId: string }; Body: { reason?: unknown; deleteMessageSeconds?: unknown } }>(
        '/api/guilds/:guildId/members/:userId/ban',
        async (request, reply) => {
            if (!requireCapability(request, reply, 'guild.write')) return;
            const { guildId, userId } = request.params;
            const guild = bot.guilds.cache.get(guildId);
            if (!guild) { reply.code(404).send({ error: 'Unknown guild' }); return; }
            if (!isSnowflake(userId)) { reply.code(400).send({ error: 'invalid userId' }); return; }
            const reason = typeof request.body?.reason === 'string' ? request.body.reason : undefined;
            const rawDelete = request.body?.deleteMessageSeconds;
            // Discord clamps to [0, 604800]; we mirror the cap here so
            // bad input doesn't get pushed downstream and 400'd.
            const deleteMessageSeconds = typeof rawDelete === 'number' && Number.isFinite(rawDelete)
                ? Math.max(0, Math.min(604800, Math.floor(rawDelete)))
                : 0;
            try {
                await guild.bans.create(userId, { reason, deleteMessageSeconds });
                reply.code(204).send();
            } catch (err) {
                request.log.error({ err }, 'failed to ban user');
                reply.code(502).send({ error: 'Failed to ban user' });
            }
        }
    );

    server.delete<{ Params: { guildId: string; userId: string }; Body: { reason?: unknown } }>(
        '/api/guilds/:guildId/bans/:userId',
        async (request, reply) => {
            if (!requireCapability(request, reply, 'guild.write')) return;
            const { guildId, userId } = request.params;
            const guild = bot.guilds.cache.get(guildId);
            if (!guild) { reply.code(404).send({ error: 'Unknown guild' }); return; }
            if (!isSnowflake(userId)) { reply.code(400).send({ error: 'invalid userId' }); return; }
            const reason = typeof request.body?.reason === 'string' ? request.body.reason : undefined;
            try {
                await guild.bans.remove(userId, reason);
                reply.code(204).send();
            } catch (err) {
                request.log.error({ err }, 'failed to unban user');
                reply.code(502).send({ error: 'Failed to unban user' });
            }
        }
    );

    server.get<{ Params: { guildId: string } }>(
        '/api/guilds/:guildId/bans',
        async (request, reply) => {
            if (!requireCapability(request, reply, 'guild.read')) return;
            const { guildId } = request.params;
            const guild = bot.guilds.cache.get(guildId);
            if (!guild) { reply.code(404).send({ error: 'Unknown guild' }); return; }
            try {
                // Discord's REST endpoint supports cursor pagination — we
                // fetch the first 1000 here, which covers the vast majority
                // of guilds. If a guild needs more, an explicit follow-up
                // endpoint with `before`/`after` can iterate.
                const bans = await guild.bans.fetch({ limit: 1000 });
                return {
                    bans: [...bans.values()].map(b => ({
                        userId: b.user.id,
                        username: b.user.username,
                        globalName: b.user.globalName ?? null,
                        avatar: b.user.avatar,
                        reason: b.reason ?? null
                    }))
                };
            } catch (err) {
                request.log.error({ err }, 'failed to list bans');
                reply.code(502).send({ error: 'Failed to list bans' });
            }
        }
    );

    server.patch<{ Params: { guildId: string; userId: string }; Body: { until?: unknown; reason?: unknown } }>(
        '/api/guilds/:guildId/members/:userId/timeout',
        async (request, reply) => {
            if (!requireCapability(request, reply, 'guild.write')) return;
            const { guildId, userId } = request.params;
            const guild = bot.guilds.cache.get(guildId);
            if (!guild) { reply.code(404).send({ error: 'Unknown guild' }); return; }
            const member = await guild.members.fetch(userId).catch(() => null);
            if (!member) { reply.code(404).send({ error: 'Unknown member' }); return; }
            // `until` is an ISO timestamp the user picked; null clears the
            // timeout. We turn ISO → ms-from-now because discord.js's
            // `timeout()` takes a duration, not an absolute time.
            const rawUntil = request.body?.until;
            let durationMs: number | null;
            if (rawUntil === null) {
                durationMs = null;
            } else if (typeof rawUntil === 'string') {
                const ts = Date.parse(rawUntil);
                if (Number.isNaN(ts)) {
                    reply.code(400).send({ error: 'invalid until ISO timestamp' });
                    return;
                }
                const delta = ts - Date.now();
                if (delta <= 0 || delta > 28 * 24 * 60 * 60 * 1000) {
                    reply.code(400).send({ error: 'until must be 0..28 days in the future' });
                    return;
                }
                durationMs = delta;
            } else {
                reply.code(400).send({ error: 'until must be ISO string or null' });
                return;
            }
            const reason = typeof request.body?.reason === 'string' ? request.body.reason : undefined;
            try {
                await member.timeout(durationMs, reason);
                reply.code(204).send();
            } catch (err) {
                request.log.error({ err }, 'failed to set member timeout');
                reply.code(502).send({ error: 'Failed to set timeout' });
            }
        }
    );

    server.patch<{ Params: { guildId: string; userId: string }; Body: { nickname?: unknown; reason?: unknown } }>(
        '/api/guilds/:guildId/members/:userId/nickname',
        async (request, reply) => {
            if (!requireCapability(request, reply, 'guild.write')) return;
            const { guildId, userId } = request.params;
            const guild = bot.guilds.cache.get(guildId);
            if (!guild) { reply.code(404).send({ error: 'Unknown guild' }); return; }
            const member = await guild.members.fetch(userId).catch(() => null);
            if (!member) { reply.code(404).send({ error: 'Unknown member' }); return; }
            const raw = request.body?.nickname;
            // null = clear nickname (Discord shows globalName/username);
            // string '' is treated as null too, matching the UI's empty input.
            const nickname: string | null = raw === null || raw === '' ? null
                : typeof raw === 'string' ? raw : (undefined as unknown as null);
            if (nickname === undefined) {
                reply.code(400).send({ error: 'nickname must be string or null' });
                return;
            }
            if (typeof nickname === 'string' && nickname.length > 32) {
                reply.code(400).send({ error: 'nickname must be ≤32 chars' });
                return;
            }
            const reason = typeof request.body?.reason === 'string' ? request.body.reason : undefined;
            try {
                await member.setNickname(nickname, reason);
                reply.code(204).send();
            } catch (err) {
                request.log.error({ err }, 'failed to set nickname');
                reply.code(502).send({ error: 'Failed to set nickname' });
            }
        }
    );

    server.post<{ Params: { guildId: string; userId: string; roleId: string }; Body: { reason?: unknown } }>(
        '/api/guilds/:guildId/members/:userId/roles/:roleId',
        async (request, reply) => {
            if (!requireCapability(request, reply, 'guild.write')) return;
            const { guildId, userId, roleId } = request.params;
            if (!isSnowflake(roleId)) { reply.code(400).send({ error: 'invalid roleId' }); return; }
            const guild = bot.guilds.cache.get(guildId);
            if (!guild) { reply.code(404).send({ error: 'Unknown guild' }); return; }
            const member = await guild.members.fetch(userId).catch(() => null);
            if (!member) { reply.code(404).send({ error: 'Unknown member' }); return; }
            const reason = typeof request.body?.reason === 'string' ? request.body.reason : undefined;
            try {
                await member.roles.add(roleId, reason);
                reply.code(204).send();
            } catch (err) {
                request.log.error({ err }, 'failed to add role');
                reply.code(502).send({ error: 'Failed to add role' });
            }
        }
    );

    server.delete<{ Params: { guildId: string; userId: string; roleId: string }; Body: { reason?: unknown } }>(
        '/api/guilds/:guildId/members/:userId/roles/:roleId',
        async (request, reply) => {
            if (!requireCapability(request, reply, 'guild.write')) return;
            const { guildId, userId, roleId } = request.params;
            if (!isSnowflake(roleId)) { reply.code(400).send({ error: 'invalid roleId' }); return; }
            const guild = bot.guilds.cache.get(guildId);
            if (!guild) { reply.code(404).send({ error: 'Unknown guild' }); return; }
            const member = await guild.members.fetch(userId).catch(() => null);
            if (!member) { reply.code(404).send({ error: 'Unknown member' }); return; }
            const reason = typeof request.body?.reason === 'string' ? request.body.reason : undefined;
            try {
                await member.roles.remove(roleId, reason);
                reply.code(204).send();
            } catch (err) {
                request.log.error({ err }, 'failed to remove role');
                reply.code(502).send({ error: 'Failed to remove role' });
            }
        }
    );

    // ── Message ops (pin, unpin, crosspost, bulk delete) ────────────────

    server.post<{ Params: { guildId: string; channelId: string; messageId: string } }>(
        '/api/guilds/:guildId/text-channels/:channelId/messages/:messageId/pin',
        async (request, reply) => {
            if (!requireCapability(request, reply, 'guild.write')) return;
            const { guildId, channelId, messageId } = request.params;
            if (!isSnowflake(messageId)) { reply.code(400).send({ error: 'invalid messageId' }); return; }
            const channel = fetchTextLike(bot, guildId, channelId);
            if (!channel) { reply.code(404).send({ error: 'Unknown channel' }); return; }
            try {
                const message = await channel.messages.fetch(messageId);
                await message.pin();
                reply.code(204).send();
            } catch (err) {
                request.log.error({ err }, 'failed to pin message');
                reply.code(502).send({ error: 'Failed to pin message' });
            }
        }
    );

    server.delete<{ Params: { guildId: string; channelId: string; messageId: string } }>(
        '/api/guilds/:guildId/text-channels/:channelId/messages/:messageId/pin',
        async (request, reply) => {
            if (!requireCapability(request, reply, 'guild.write')) return;
            const { guildId, channelId, messageId } = request.params;
            if (!isSnowflake(messageId)) { reply.code(400).send({ error: 'invalid messageId' }); return; }
            const channel = fetchTextLike(bot, guildId, channelId);
            if (!channel) { reply.code(404).send({ error: 'Unknown channel' }); return; }
            try {
                const message = await channel.messages.fetch(messageId);
                await message.unpin();
                reply.code(204).send();
            } catch (err) {
                request.log.error({ err }, 'failed to unpin message');
                reply.code(502).send({ error: 'Failed to unpin message' });
            }
        }
    );

    server.post<{ Params: { guildId: string; channelId: string; messageId: string } }>(
        '/api/guilds/:guildId/text-channels/:channelId/messages/:messageId/crosspost',
        async (request, reply) => {
            if (!requireCapability(request, reply, 'guild.write')) return;
            const { guildId, channelId, messageId } = request.params;
            if (!isSnowflake(messageId)) { reply.code(400).send({ error: 'invalid messageId' }); return; }
            const channel = fetchTextLike(bot, guildId, channelId);
            if (!channel) { reply.code(404).send({ error: 'Unknown channel' }); return; }
            // crosspost is only valid in announcement channels — Discord
            // returns 50068 otherwise. We pre-check so the UI can hide the
            // entry; the route is the safety net.
            const ch = bot.guilds.cache.get(guildId)?.channels.cache.get(channelId);
            if (!ch || ch.type !== ChannelType.GuildAnnouncement) {
                reply.code(400).send({ error: 'crosspost only valid in announcement channels' });
                return;
            }
            try {
                const message = await channel.messages.fetch(messageId);
                await message.crosspost();
                reply.code(204).send();
            } catch (err) {
                request.log.error({ err }, 'failed to crosspost message');
                reply.code(502).send({ error: 'Failed to crosspost message' });
            }
        }
    );

    // ── Role CRUD ────────────────────────────────────────────────────────

    server.post<{ Params: { guildId: string }; Body: {
        name?: unknown; color?: unknown; hoist?: unknown;
        mentionable?: unknown; permissions?: unknown; reason?: unknown;
    } }>(
        '/api/guilds/:guildId/roles',
        async (request, reply) => {
            if (!requireCapability(request, reply, 'guild.write')) return;
            const { guildId } = request.params;
            const guild = bot.guilds.cache.get(guildId);
            if (!guild) { reply.code(404).send({ error: 'Unknown guild' }); return; }
            const opts = parseRoleBody(request.body ?? {});
            if (opts.error) { reply.code(400).send({ error: opts.error }); return; }
            try {
                const role = await guild.roles.create({
                    name: opts.name ?? undefined,
                    color: opts.color ?? undefined,
                    hoist: opts.hoist ?? undefined,
                    mentionable: opts.mentionable ?? undefined,
                    permissions: opts.permissions ?? undefined,
                    reason: opts.reason
                });
                return { id: role.id };
            } catch (err) {
                request.log.error({ err }, 'failed to create role');
                reply.code(502).send({ error: 'Failed to create role' });
            }
        }
    );

    server.patch<{ Params: { guildId: string; roleId: string }; Body: {
        name?: unknown; color?: unknown; hoist?: unknown;
        mentionable?: unknown; permissions?: unknown; reason?: unknown;
    } }>(
        '/api/guilds/:guildId/roles/:roleId',
        async (request, reply) => {
            if (!requireCapability(request, reply, 'guild.write')) return;
            const { guildId, roleId } = request.params;
            if (!isSnowflake(roleId)) { reply.code(400).send({ error: 'invalid roleId' }); return; }
            const guild = bot.guilds.cache.get(guildId);
            if (!guild) { reply.code(404).send({ error: 'Unknown guild' }); return; }
            const role = guild.roles.cache.get(roleId);
            if (!role) { reply.code(404).send({ error: 'Unknown role' }); return; }
            const opts = parseRoleBody(request.body ?? {});
            if (opts.error) { reply.code(400).send({ error: opts.error }); return; }
            try {
                await role.edit({
                    name: opts.name ?? undefined,
                    color: opts.color ?? undefined,
                    hoist: opts.hoist ?? undefined,
                    mentionable: opts.mentionable ?? undefined,
                    permissions: opts.permissions ?? undefined,
                    reason: opts.reason
                });
                reply.code(204).send();
            } catch (err) {
                request.log.error({ err }, 'failed to edit role');
                reply.code(502).send({ error: 'Failed to edit role' });
            }
        }
    );

    server.delete<{ Params: { guildId: string; roleId: string }; Body: { reason?: unknown } }>(
        '/api/guilds/:guildId/roles/:roleId',
        async (request, reply) => {
            if (!requireCapability(request, reply, 'guild.write')) return;
            const { guildId, roleId } = request.params;
            if (!isSnowflake(roleId)) { reply.code(400).send({ error: 'invalid roleId' }); return; }
            const guild = bot.guilds.cache.get(guildId);
            if (!guild) { reply.code(404).send({ error: 'Unknown guild' }); return; }
            const reason = typeof request.body?.reason === 'string' ? request.body.reason : undefined;
            try {
                await guild.roles.delete(roleId, reason);
                reply.code(204).send();
            } catch (err) {
                request.log.error({ err }, 'failed to delete role');
                reply.code(502).send({ error: 'Failed to delete role' });
            }
        }
    );

    // ── Invite revocation ────────────────────────────────────────────────

    server.delete<{ Params: { guildId: string; code: string }; Body: { reason?: unknown } }>(
        '/api/guilds/:guildId/invites/:code',
        async (request, reply) => {
            if (!requireCapability(request, reply, 'guild.write')) return;
            const { guildId, code } = request.params;
            const guild = bot.guilds.cache.get(guildId);
            if (!guild) { reply.code(404).send({ error: 'Unknown guild' }); return; }
            const reason = typeof request.body?.reason === 'string' ? request.body.reason : undefined;
            try {
                await guild.invites.delete(code, reason);
                reply.code(204).send();
            } catch (err) {
                request.log.error({ err }, 'failed to revoke invite');
                reply.code(502).send({ error: 'Failed to revoke invite' });
            }
        }
    );

    // ── Emoji CRUD ──────────────────────────────────────────────────────

    server.get<{ Params: { guildId: string } }>(
        '/api/guilds/:guildId/emojis',
        async (request, reply) => {
            if (!requireCapability(request, reply, 'guild.read')) return;
            const guild = bot.guilds.cache.get(request.params.guildId);
            if (!guild) { reply.code(404).send({ error: 'Unknown guild' }); return; }
            return {
                emojis: [...guild.emojis.cache.values()].map(e => ({
                    id: e.id,
                    name: e.name,
                    animated: !!e.animated,
                    url: e.imageURL({ size: 64 })
                }))
            };
        }
    );

    server.post<{ Params: { guildId: string } }>(
        '/api/guilds/:guildId/emojis',
        async (request, reply) => {
            if (!requireCapability(request, reply, 'guild.write')) return;
            const guild = bot.guilds.cache.get(request.params.guildId);
            if (!guild) { reply.code(404).send({ error: 'Unknown guild' }); return; }
            if (!request.isMultipart()) {
                reply.code(400).send({ error: 'multipart upload required' });
                return;
            }
            let name = '';
            let attachment: Buffer | null = null;
            for await (const part of request.parts()) {
                if (part.type === 'file') attachment = await part.toBuffer();
                else if (part.fieldname === 'name') name = String(part.value ?? '').trim();
            }
            if (!name || name.length < 2 || name.length > 32) {
                reply.code(400).send({ error: 'name must be 2..32 chars' });
                return;
            }
            if (!attachment) {
                reply.code(400).send({ error: 'image attachment required' });
                return;
            }
            try {
                const emoji = await guild.emojis.create({ attachment, name });
                return { id: emoji.id };
            } catch (err) {
                request.log.error({ err }, 'failed to create emoji');
                reply.code(502).send({ error: 'Failed to create emoji' });
            }
        }
    );

    server.patch<{ Params: { guildId: string; emojiId: string }; Body: { name?: unknown; reason?: unknown } }>(
        '/api/guilds/:guildId/emojis/:emojiId',
        async (request, reply) => {
            if (!requireCapability(request, reply, 'guild.write')) return;
            const { guildId, emojiId } = request.params;
            const guild = bot.guilds.cache.get(guildId);
            if (!guild) { reply.code(404).send({ error: 'Unknown guild' }); return; }
            const name = typeof request.body?.name === 'string' ? request.body.name.trim() : '';
            if (!name || name.length < 2 || name.length > 32) {
                reply.code(400).send({ error: 'name must be 2..32 chars' });
                return;
            }
            const reason = typeof request.body?.reason === 'string' ? request.body.reason : undefined;
            try {
                await guild.emojis.edit(emojiId, reason ? { name, reason } : { name });
                reply.code(204).send();
            } catch (err) {
                request.log.error({ err }, 'failed to edit emoji');
                reply.code(502).send({ error: 'Failed to edit emoji' });
            }
        }
    );

    server.delete<{ Params: { guildId: string; emojiId: string }; Body: { reason?: unknown } }>(
        '/api/guilds/:guildId/emojis/:emojiId',
        async (request, reply) => {
            if (!requireCapability(request, reply, 'guild.write')) return;
            const { guildId, emojiId } = request.params;
            const guild = bot.guilds.cache.get(guildId);
            if (!guild) { reply.code(404).send({ error: 'Unknown guild' }); return; }
            const reason = typeof request.body?.reason === 'string' ? request.body.reason : undefined;
            try {
                await guild.emojis.delete(emojiId, reason);
                reply.code(204).send();
            } catch (err) {
                request.log.error({ err }, 'failed to delete emoji');
                reply.code(502).send({ error: 'Failed to delete emoji' });
            }
        }
    );

    // ── Sticker CRUD ────────────────────────────────────────────────────

    server.get<{ Params: { guildId: string } }>(
        '/api/guilds/:guildId/stickers',
        async (request, reply) => {
            if (!requireCapability(request, reply, 'guild.read')) return;
            const guild = bot.guilds.cache.get(request.params.guildId);
            if (!guild) { reply.code(404).send({ error: 'Unknown guild' }); return; }
            try {
                const stickers = guild.stickers.cache.size > 0
                    ? guild.stickers.cache
                    : await guild.stickers.fetch();
                return {
                    stickers: [...stickers.values()].map(s => ({
                        id: s.id,
                        name: s.name,
                        description: s.description,
                        tags: s.tags,
                        format: s.format,
                        url: s.url
                    }))
                };
            } catch (err) {
                request.log.error({ err }, 'failed to list stickers');
                reply.code(502).send({ error: 'Failed to list stickers' });
            }
        }
    );

    server.post<{ Params: { guildId: string } }>(
        '/api/guilds/:guildId/stickers',
        async (request, reply) => {
            if (!requireCapability(request, reply, 'guild.write')) return;
            const guild = bot.guilds.cache.get(request.params.guildId);
            if (!guild) { reply.code(404).send({ error: 'Unknown guild' }); return; }
            if (!request.isMultipart()) {
                reply.code(400).send({ error: 'multipart upload required' });
                return;
            }
            let name = '';
            let tags = '';
            let description = '';
            // Discord requires a filename hint even for in-memory buffers,
            // so we capture it alongside the body to feed into stickers.create.
            let file: { attachment: Buffer; name: string } | null = null;
            for await (const part of request.parts()) {
                if (part.type === 'file') {
                    file = { attachment: await part.toBuffer(), name: part.filename };
                } else if (part.fieldname === 'name') name = String(part.value ?? '').trim();
                else if (part.fieldname === 'tags') tags = String(part.value ?? '').trim();
                else if (part.fieldname === 'description') description = String(part.value ?? '').trim();
            }
            if (!name || name.length < 2 || name.length > 30) {
                reply.code(400).send({ error: 'name must be 2..30 chars' });
                return;
            }
            if (!tags || tags.length > 200) {
                reply.code(400).send({ error: 'tags required (≤200 chars)' });
                return;
            }
            if (!description || description.length < 2 || description.length > 100) {
                reply.code(400).send({ error: 'description must be 2..100 chars' });
                return;
            }
            if (!file) {
                reply.code(400).send({ error: 'image attachment required' });
                return;
            }
            try {
                const sticker = await guild.stickers.create({
                    file: file.attachment,
                    name,
                    tags,
                    description
                });
                return { id: sticker.id };
            } catch (err) {
                request.log.error({ err }, 'failed to create sticker');
                reply.code(502).send({ error: 'Failed to create sticker' });
            }
        }
    );

    server.patch<{ Params: { guildId: string; stickerId: string }; Body: {
        name?: unknown; tags?: unknown; description?: unknown; reason?: unknown;
    } }>(
        '/api/guilds/:guildId/stickers/:stickerId',
        async (request, reply) => {
            if (!requireCapability(request, reply, 'guild.write')) return;
            const { guildId, stickerId } = request.params;
            const guild = bot.guilds.cache.get(guildId);
            if (!guild) { reply.code(404).send({ error: 'Unknown guild' }); return; }
            const body = request.body ?? {};
            const edit: { name?: string; tags?: string; description?: string } = {};
            if (typeof body.name === 'string' && body.name.trim()) edit.name = body.name.trim().slice(0, 30);
            if (typeof body.tags === 'string') edit.tags = body.tags.trim().slice(0, 200);
            if (typeof body.description === 'string') edit.description = body.description.trim().slice(0, 100);
            if (Object.keys(edit).length === 0) {
                reply.code(400).send({ error: 'no editable fields supplied' });
                return;
            }
            const reason = typeof body.reason === 'string' ? body.reason : undefined;
            try {
                await guild.stickers.edit(stickerId, reason ? { ...edit, reason } : edit);
                reply.code(204).send();
            } catch (err) {
                request.log.error({ err }, 'failed to edit sticker');
                reply.code(502).send({ error: 'Failed to edit sticker' });
            }
        }
    );

    server.delete<{ Params: { guildId: string; stickerId: string }; Body: { reason?: unknown } }>(
        '/api/guilds/:guildId/stickers/:stickerId',
        async (request, reply) => {
            if (!requireCapability(request, reply, 'guild.write')) return;
            const { guildId, stickerId } = request.params;
            const guild = bot.guilds.cache.get(guildId);
            if (!guild) { reply.code(404).send({ error: 'Unknown guild' }); return; }
            const reason = typeof request.body?.reason === 'string' ? request.body.reason : undefined;
            try {
                await guild.stickers.delete(stickerId, reason);
                reply.code(204).send();
            } catch (err) {
                request.log.error({ err }, 'failed to delete sticker');
                reply.code(502).send({ error: 'Failed to delete sticker' });
            }
        }
    );

    // ── Channel CRUD ─────────────────────────────────────────────────────

    server.post<{ Params: { guildId: string }; Body: {
        name?: unknown; type?: unknown; parentId?: unknown; topic?: unknown;
        rateLimitPerUser?: unknown; nsfw?: unknown; reason?: unknown;
    } }>(
        '/api/guilds/:guildId/channels',
        async (request, reply) => {
            if (!requireCapability(request, reply, 'guild.write')) return;
            const { guildId } = request.params;
            const guild = bot.guilds.cache.get(guildId);
            if (!guild) { reply.code(404).send({ error: 'Unknown guild' }); return; }
            const body = request.body ?? {};
            const name = typeof body.name === 'string' ? body.name.trim() : '';
            if (!name || name.length > 100) {
                reply.code(400).send({ error: 'name required (1..100 chars)' });
                return;
            }
            // Only the channel kinds the UI can create are accepted; the
            // rest (DM, news-thread, group-DM, …) require flows we don't
            // expose. Numbers map to discord.js's ChannelType enum.
            const ALLOWED: Record<string, number> = {
                text: ChannelType.GuildText,
                voice: ChannelType.GuildVoice,
                category: ChannelType.GuildCategory,
                announcement: ChannelType.GuildAnnouncement,
                forum: ChannelType.GuildForum
            };
            const typeKey = typeof body.type === 'string' ? body.type : 'text';
            const channelType = ALLOWED[typeKey];
            if (channelType === undefined) {
                reply.code(400).send({ error: `type must be one of: ${Object.keys(ALLOWED).join(', ')}` });
                return;
            }
            const parentId = typeof body.parentId === 'string' && isSnowflake(body.parentId) ? body.parentId : undefined;
            const topic = typeof body.topic === 'string' ? body.topic.slice(0, 1024) : undefined;
            const rateLimitPerUser = typeof body.rateLimitPerUser === 'number' && Number.isFinite(body.rateLimitPerUser)
                ? Math.max(0, Math.min(21600, Math.floor(body.rateLimitPerUser)))
                : undefined;
            const nsfw = typeof body.nsfw === 'boolean' ? body.nsfw : undefined;
            const reason = typeof body.reason === 'string' ? body.reason : undefined;
            try {
                const created = await guild.channels.create({
                    name,
                    type: channelType as Parameters<typeof guild.channels.create>[0]['type'],
                    parent: parentId,
                    topic,
                    rateLimitPerUser,
                    nsfw,
                    reason
                });
                return { id: created.id };
            } catch (err) {
                request.log.error({ err }, 'failed to create channel');
                reply.code(502).send({ error: 'Failed to create channel' });
            }
        }
    );

    server.delete<{ Params: { guildId: string; channelId: string }; Body: { reason?: unknown } }>(
        '/api/guilds/:guildId/channels/:channelId',
        async (request, reply) => {
            if (!requireCapability(request, reply, 'guild.write')) return;
            const { guildId, channelId } = request.params;
            const guild = bot.guilds.cache.get(guildId);
            if (!guild) { reply.code(404).send({ error: 'Unknown guild' }); return; }
            const channel = guild.channels.cache.get(channelId);
            if (!channel) { reply.code(404).send({ error: 'Unknown channel' }); return; }
            const reason = typeof request.body?.reason === 'string' ? request.body.reason : undefined;
            try {
                await channel.delete(reason);
                reply.code(204).send();
            } catch (err) {
                request.log.error({ err }, 'failed to delete channel');
                reply.code(502).send({ error: 'Failed to delete channel' });
            }
        }
    );

    server.patch<{ Params: { guildId: string; channelId: string }; Body: {
        name?: unknown; topic?: unknown; parentId?: unknown;
        rateLimitPerUser?: unknown; nsfw?: unknown;
        archived?: unknown; locked?: unknown; autoArchiveDuration?: unknown;
        reason?: unknown;
    } }>(
        '/api/guilds/:guildId/channels/:channelId',
        async (request, reply) => {
            if (!requireCapability(request, reply, 'guild.write')) return;
            const { guildId, channelId } = request.params;
            const guild = bot.guilds.cache.get(guildId);
            if (!guild) { reply.code(404).send({ error: 'Unknown guild' }); return; }
            const channel = guild.channels.cache.get(channelId);
            if (!channel) { reply.code(404).send({ error: 'Unknown channel' }); return; }
            const body = request.body ?? {};
            // Build the edit payload only with fields the caller actually
            // sent — discord.js ignores undefined keys but explicitly
            // setting null/empty would unset values we didn't mean to.
            const edit: Record<string, unknown> = {};
            if (typeof body.name === 'string' && body.name.trim()) edit.name = body.name.slice(0, 100);
            if (typeof body.topic === 'string') edit.topic = body.topic.slice(0, 1024);
            if (typeof body.parentId === 'string' && isSnowflake(body.parentId)) edit.parent = body.parentId;
            else if (body.parentId === null) edit.parent = null;
            if (typeof body.rateLimitPerUser === 'number' && Number.isFinite(body.rateLimitPerUser)) {
                edit.rateLimitPerUser = Math.max(0, Math.min(21600, Math.floor(body.rateLimitPerUser)));
            }
            if (typeof body.nsfw === 'boolean') edit.nsfw = body.nsfw;
            // Thread-only flags. Forwarded blindly — discord.js rejects
            // them with InvalidChannelType when applied to a regular text
            // channel, which surfaces as the 502 below.
            if (typeof body.archived === 'boolean') edit.archived = body.archived;
            if (typeof body.locked === 'boolean') edit.locked = body.locked;
            if (typeof body.autoArchiveDuration === 'number') {
                const v = Math.floor(body.autoArchiveDuration);
                if ([60, 1440, 4320, 10080].includes(v)) edit.autoArchiveDuration = v;
            }
            const reason = typeof body.reason === 'string' ? body.reason : undefined;
            if (Object.keys(edit).length === 0) {
                reply.code(400).send({ error: 'no editable fields supplied' });
                return;
            }
            try {
                await (channel as unknown as { edit: (opts: unknown, reason?: string) => Promise<unknown> })
                    .edit(edit, reason);
                reply.code(204).send();
            } catch (err) {
                request.log.error({ err }, 'failed to edit channel');
                reply.code(502).send({ error: 'Failed to edit channel' });
            }
        }
    );

    // ── Private thread member management ───────────────────────────────

    server.get<{ Params: { guildId: string; threadId: string } }>(
        '/api/guilds/:guildId/threads/:threadId/members',
        async (request, reply) => {
            if (!requireCapability(request, reply, 'guild.read')) return;
            const { guildId, threadId } = request.params;
            const guild = bot.guilds.cache.get(guildId);
            if (!guild) { reply.code(404).send({ error: 'Unknown guild' }); return; }
            const channel = guild.channels.cache.get(threadId);
            if (!channel || !channel.isThread()) {
                reply.code(404).send({ error: 'Unknown thread' });
                return;
            }
            try {
                const members = await channel.members.fetch();
                return {
                    members: [...members.values()].map(m => ({
                        userId: m.id,
                        joinedAt: m.joinedAt?.toISOString() ?? null
                    }))
                };
            } catch (err) {
                request.log.error({ err }, 'failed to list thread members');
                reply.code(502).send({ error: 'Failed to list thread members' });
            }
        }
    );

    server.post<{ Params: { guildId: string; threadId: string; userId: string } }>(
        '/api/guilds/:guildId/threads/:threadId/members/:userId',
        async (request, reply) => {
            if (!requireCapability(request, reply, 'guild.write')) return;
            const { guildId, threadId, userId } = request.params;
            if (!isSnowflake(userId)) { reply.code(400).send({ error: 'invalid userId' }); return; }
            const guild = bot.guilds.cache.get(guildId);
            if (!guild) { reply.code(404).send({ error: 'Unknown guild' }); return; }
            const channel = guild.channels.cache.get(threadId);
            if (!channel || !channel.isThread()) {
                reply.code(404).send({ error: 'Unknown thread' });
                return;
            }
            try {
                await channel.members.add(userId);
                reply.code(204).send();
            } catch (err) {
                request.log.error({ err }, 'failed to add thread member');
                reply.code(502).send({ error: 'Failed to add thread member' });
            }
        }
    );

    server.delete<{ Params: { guildId: string; threadId: string; userId: string } }>(
        '/api/guilds/:guildId/threads/:threadId/members/:userId',
        async (request, reply) => {
            if (!requireCapability(request, reply, 'guild.write')) return;
            const { guildId, threadId, userId } = request.params;
            if (!isSnowflake(userId)) { reply.code(400).send({ error: 'invalid userId' }); return; }
            const guild = bot.guilds.cache.get(guildId);
            if (!guild) { reply.code(404).send({ error: 'Unknown guild' }); return; }
            const channel = guild.channels.cache.get(threadId);
            if (!channel || !channel.isThread()) {
                reply.code(404).send({ error: 'Unknown thread' });
                return;
            }
            try {
                await channel.members.remove(userId);
                reply.code(204).send();
            } catch (err) {
                request.log.error({ err }, 'failed to remove thread member');
                reply.code(502).send({ error: 'Failed to remove thread member' });
            }
        }
    );

    server.post<{ Params: { guildId: string; channelId: string }; Body: { messageIds?: unknown } }>(
        '/api/guilds/:guildId/text-channels/:channelId/messages/bulk-delete',
        async (request, reply) => {
            if (!requireCapability(request, reply, 'guild.write')) return;
            const { guildId, channelId } = request.params;
            const ids = Array.isArray(request.body?.messageIds)
                ? (request.body!.messageIds as unknown[]).filter((id): id is string => typeof id === 'string' && isSnowflake(id))
                : [];
            // Discord requires 2..100 messages per bulkDelete and rejects
            // anything older than 14 days. We cap the count here; the
            // 14-day limit is enforced via discord.js's `filterOld` flag.
            if (ids.length < 2 || ids.length > 100) {
                reply.code(400).send({ error: 'messageIds must be 2..100 snowflakes' });
                return;
            }
            const channel = fetchTextLike(bot, guildId, channelId);
            if (!channel) { reply.code(404).send({ error: 'Unknown channel' }); return; }
            try {
                // `filterOld = true` skips messages older than 14 days
                // instead of throwing on the whole batch.
                const deleted = await channel.bulkDelete(ids, true);
                for (const id of deleted.keys()) {
                    events.publish({ type: 'guild-message-deleted', guildId, channelId, messageId: id });
                }
                return { deletedCount: deleted.size };
            } catch (err) {
                request.log.error({ err }, 'failed to bulk delete messages');
                reply.code(502).send({ error: 'Failed to bulk delete' });
            }
        }
    );
}

/**
 * Validate and normalize a role create/edit body. Discord accepts
 * `permissions` either as a bitfield bigint string or as an array of
 * permission names; we always convert to a `PermissionsBitField` so the
 * route handlers can pass it straight to discord.js.
 */
function parseRoleBody(body: {
    name?: unknown; color?: unknown; hoist?: unknown;
    mentionable?: unknown; permissions?: unknown; reason?: unknown;
}): {
    name?: string;
    color?: number;
    hoist?: boolean;
    mentionable?: boolean;
    permissions?: PermissionsBitField;
    reason?: string;
    error?: string;
} {
    const out: ReturnType<typeof parseRoleBody> = {};
    if (typeof body.name === 'string') {
        const trimmed = body.name.trim();
        if (trimmed.length > 100) return { error: 'name must be ≤100 chars' };
        if (trimmed.length > 0) out.name = trimmed;
    }
    if (typeof body.color === 'number' && Number.isFinite(body.color)) {
        const c = Math.floor(body.color);
        if (c < 0 || c > 0xFFFFFF) return { error: 'color must be a 24-bit RGB int' };
        out.color = c;
    } else if (typeof body.color === 'string' && body.color) {
        // Accept "#rrggbb" / "rrggbb" so the colour input on the form
        // doesn't need to convert client-side.
        const hex = body.color.replace(/^#/, '');
        if (!/^[0-9a-fA-F]{6}$/.test(hex)) return { error: 'color must be #RRGGBB' };
        out.color = parseInt(hex, 16);
    }
    if (typeof body.hoist === 'boolean') out.hoist = body.hoist;
    if (typeof body.mentionable === 'boolean') out.mentionable = body.mentionable;
    if (typeof body.permissions === 'string') {
        try {
            out.permissions = new PermissionsBitField(BigInt(body.permissions));
        } catch {
            return { error: 'permissions must be a bigint string' };
        }
    }
    if (typeof body.reason === 'string') out.reason = body.reason;
    return out;
}

/**
 * Same widening as guild-channel-routes' fetchTextChannel — a thin local
 * copy so this file doesn't import the route module just for a helper.
 */
function fetchTextLike(bot: Client, guildId: string, channelId: string) {
    const guild = bot.guilds.cache.get(guildId);
    if (!guild) return null;
    const channel = guild.channels.cache.get(channelId);
    if (!channel) return null;
    if (
        channel.type === ChannelType.GuildText
        || channel.type === ChannelType.GuildAnnouncement
        || channel.type === ChannelType.PublicThread
        || channel.type === ChannelType.PrivateThread
        || channel.type === ChannelType.AnnouncementThread
        || channel.type === ChannelType.GuildVoice
        || channel.type === ChannelType.GuildStageVoice
    ) {
        // The members of this union all expose `.messages.fetch` /
        // `.bulkDelete` at runtime; the cast is a typing convenience.
        return channel as unknown as import('discord.js').TextChannel;
    }
    return null;
}
