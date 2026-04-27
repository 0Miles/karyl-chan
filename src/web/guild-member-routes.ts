import type { FastifyInstance } from 'fastify';
import { requireGuildCapability } from './route-guards.js';
import { isSnowflake } from './validators.js';
import { avatarUrlFor, guildAvatarUrlFor } from './message-mapper.js';
import type { GuildManagementRoutesOptions } from './guild-management-shared.js';

export async function registerGuildMemberRoutes(
    server: FastifyInstance,
    options: GuildManagementRoutesOptions
): Promise<void> {
    const { bot } = options;

    // ── Member ops ───────────────────────────────────────────────────────

    server.post<{ Params: { guildId: string; userId: string }; Body: { reason?: unknown } }>(
        '/api/guilds/:guildId/members/:userId/kick',
        async (request, reply) => {
            if (!requireGuildCapability(request, reply, request.params.guildId, 'manage')) return;
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
            if (!requireGuildCapability(request, reply, request.params.guildId, 'manage')) return;
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
            if (!requireGuildCapability(request, reply, request.params.guildId, 'manage')) return;
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
            if (!requireGuildCapability(request, reply, request.params.guildId, 'manage')) return;
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
                        avatarUrl: avatarUrlFor(b.user.id, b.user.avatar, 64),
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
            if (!requireGuildCapability(request, reply, request.params.guildId, 'manage')) return;
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
            if (!requireGuildCapability(request, reply, request.params.guildId, 'manage')) return;
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
            if (!requireGuildCapability(request, reply, request.params.guildId, 'manage')) return;
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
            if (!requireGuildCapability(request, reply, request.params.guildId, 'manage')) return;
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

    // ── Guild-wide member listing ──────────────────────────────────────
    //
    // The per-channel `/text-channels/:channelId/members` endpoint exists
    // for mention suggestions and is permission-filtered against a single
    // channel. The members panel needs the whole roster, so we hit the
    // bot-level cache instead. `query` triggers a REST search (Discord's
    // server-side prefix index) for guilds large enough that the local
    // cache is incomplete.
    server.get<{ Params: { guildId: string }; Querystring: { limit?: string; query?: string } }>(
        '/api/guilds/:guildId/members',
        async (request, reply) => {
            if (!requireGuildCapability(request, reply, request.params.guildId, 'manage')) return;
            const guild = bot.guilds.cache.get(request.params.guildId);
            if (!guild) { reply.code(404).send({ error: 'Unknown guild' }); return; }
            const limit = Math.min(Math.max(Number(request.query.limit ?? 200) || 200, 1), 1000);
            const query = typeof request.query.query === 'string' ? request.query.query.trim() : '';
            try {
                const members = query
                    ? await guild.members.search({ query, limit: Math.min(limit, 100) })
                    : await guild.members.fetch({ limit }).catch(() => guild.members.cache);
                const rows = [...members.values()].map(m => ({
                    id: m.id,
                    username: m.user.username,
                    globalName: m.user.globalName ?? null,
                    nickname: m.nickname ?? null,
                    avatarUrl: m.avatar
                        ? guildAvatarUrlFor(guild.id, m.user.id, m.avatar, 64)
                        : avatarUrlFor(m.user.id, m.user.avatar, 64),
                    color: m.displayColor ? `#${m.displayColor.toString(16).padStart(6, '0')}` : null,
                    bot: m.user.bot,
                    joinedAt: m.joinedAt ? m.joinedAt.toISOString() : null,
                    pending: m.pending,
                    roles: [...m.roles.cache.keys()].filter(id => id !== guild.id),
                    timeoutUntil: m.communicationDisabledUntil ? m.communicationDisabledUntil.toISOString() : null
                }))
                .sort((a, b) =>
                    (a.nickname ?? a.globalName ?? a.username).localeCompare(b.nickname ?? b.globalName ?? b.username));
                return { members: rows };
            } catch (err) {
                request.log.error({ err }, 'failed to list guild members');
                reply.code(502).send({ error: 'Failed to list members' });
            }
        }
    );
}
