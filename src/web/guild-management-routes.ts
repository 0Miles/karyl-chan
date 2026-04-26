import type { FastifyInstance } from 'fastify';
import type { Client } from 'discordx';
import { AuditLogEvent, ChannelType, GuildSystemChannelFlags, PermissionsBitField } from 'discord.js';
import { requireGuildCapability } from './route-guards.js';
import { isSnowflake } from './validators.js';
import { avatarUrlFor, guildAvatarUrlFor } from './message-mapper.js';
import { guildChannelEventBus, type GuildChannelEventBus } from './guild-channel-event-bus.js';
import { TodoChannel } from '../models/todo-channel.model.js';
import { PictureOnlyChannel } from '../models/picture-only-channel.model.js';
import { RconForwardChannel } from '../models/rcon-forward-channel.model.js';
import { RoleEmoji } from '../models/role-emoji.model.js';
import { RoleEmojiGroup } from '../models/role-emoji-group.model.js';
import { RoleReceiveMessage } from '../models/role-receive-message.model.js';
import { setMessageGroups, removeAllMessageGroups } from '../models/role-receive-message-group.model.js';
import { CapabilityGrant } from '../models/capability-grant.model.js';

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
// ── Settings helpers ──────────────────────────────────────────────────

interface SystemChannelFlagsPayload {
    suppressJoinNotifications?: boolean;
    suppressPremiumSubscriptions?: boolean;
    suppressGuildReminderNotifications?: boolean;
    suppressJoinNotificationReplies?: boolean;
}

interface GuildSettingsPatchBody {
    name?: unknown;
    description?: unknown;
    afkChannelId?: unknown;
    afkTimeout?: number;
    systemChannelId?: unknown;
    systemChannelFlags?: SystemChannelFlagsPayload;
    verificationLevel?: number;
    explicitContentFilter?: number;
    defaultMessageNotifications?: number;
    rulesChannelId?: unknown;
    publicUpdatesChannelId?: unknown;
    premiumProgressBarEnabled?: boolean;
    reason?: unknown;
}

function serializeGuildSettings(guild: import('discord.js').Guild) {
    const flags = guild.systemChannelFlags;
    return {
        id: guild.id,
        name: guild.name,
        description: guild.description ?? null,
        iconUrl: guild.iconURL({ size: 256 }) ?? null,
        bannerUrl: guild.bannerURL({ size: 600 }) ?? null,
        ownerId: guild.ownerId ?? null,
        afkChannelId: guild.afkChannelId,
        afkTimeout: guild.afkTimeout,
        systemChannelId: guild.systemChannelId,
        systemChannelFlags: {
            suppressJoinNotifications: flags.has(GuildSystemChannelFlags.SuppressJoinNotifications),
            suppressPremiumSubscriptions: flags.has(GuildSystemChannelFlags.SuppressPremiumSubscriptions),
            suppressGuildReminderNotifications: flags.has(GuildSystemChannelFlags.SuppressGuildReminderNotifications),
            suppressJoinNotificationReplies: flags.has(GuildSystemChannelFlags.SuppressJoinNotificationReplies)
        },
        verificationLevel: Number(guild.verificationLevel),
        explicitContentFilter: Number(guild.explicitContentFilter),
        defaultMessageNotifications: Number(guild.defaultMessageNotifications),
        mfaLevel: Number(guild.mfaLevel),
        rulesChannelId: guild.rulesChannelId,
        publicUpdatesChannelId: guild.publicUpdatesChannelId,
        premiumTier: Number(guild.premiumTier),
        premiumSubscriptionCount: guild.premiumSubscriptionCount ?? 0,
        premiumProgressBarEnabled: guild.premiumProgressBarEnabled,
        features: [...guild.features]
    };
}

function encodeSystemChannelFlags(payload: SystemChannelFlagsPayload): number {
    let bits = 0;
    if (payload.suppressJoinNotifications) bits |= GuildSystemChannelFlags.SuppressJoinNotifications;
    if (payload.suppressPremiumSubscriptions) bits |= GuildSystemChannelFlags.SuppressPremiumSubscriptions;
    if (payload.suppressGuildReminderNotifications) bits |= GuildSystemChannelFlags.SuppressGuildReminderNotifications;
    if (payload.suppressJoinNotificationReplies) bits |= GuildSystemChannelFlags.SuppressJoinNotificationReplies;
    return bits;
}

// ── AutoMod helpers ───────────────────────────────────────────────────

interface AutoModRuleBody {
    name?: unknown;
    enabled?: unknown;
    eventType?: unknown;       // discord.js AutoModerationRuleEventType (1 = MessageSend)
    triggerType?: unknown;     // 1=Keyword, 3=Spam, 4=KeywordPreset, 5=MentionSpam, 6=MemberProfile
    triggerMetadata?: {
        keywordFilter?: unknown;     // string[]
        regexPatterns?: unknown;     // string[]
        presets?: unknown;           // number[] (1=Profanity, 2=SexualContent, 3=Slurs)
        allowList?: unknown;         // string[]
        mentionTotalLimit?: unknown; // number
        mentionRaidProtectionEnabled?: unknown; // boolean
    };
    actions?: unknown;         // array of { type, metadata? }
    exemptRoles?: unknown;     // string[]
    exemptChannels?: unknown;  // string[]
    reason?: unknown;
}

function asStringArray(input: unknown): string[] | undefined {
    if (!Array.isArray(input)) return undefined;
    return input.filter((s): s is string => typeof s === 'string');
}
function asNumberArray(input: unknown): number[] | undefined {
    if (!Array.isArray(input)) return undefined;
    return input.filter((n): n is number => typeof n === 'number' && Number.isFinite(n));
}

function parseAutoModBody(body: AutoModRuleBody, partial = false): { value: Record<string, unknown> } | { error: string } {
    const out: Record<string, unknown> = {};
    if (typeof body.name === 'string' && body.name.trim()) out.name = body.name.slice(0, 100);
    else if (!partial) return { error: 'name required' };
    if (typeof body.enabled === 'boolean') out.enabled = body.enabled;
    if (typeof body.eventType === 'number' && Number.isFinite(body.eventType)) out.eventType = body.eventType;
    else if (!partial) out.eventType = 1; // MessageSend
    if (typeof body.triggerType === 'number' && Number.isFinite(body.triggerType)) out.triggerType = body.triggerType;
    else if (!partial) return { error: 'triggerType required' };
    if (body.triggerMetadata) {
        const meta: Record<string, unknown> = {};
        const m = body.triggerMetadata;
        const kw = asStringArray(m.keywordFilter);
        if (kw) meta.keywordFilter = kw;
        const re = asStringArray(m.regexPatterns);
        if (re) meta.regexPatterns = re;
        const pr = asNumberArray(m.presets);
        if (pr) meta.presets = pr;
        const al = asStringArray(m.allowList);
        if (al) meta.allowList = al;
        if (typeof m.mentionTotalLimit === 'number') meta.mentionTotalLimit = m.mentionTotalLimit;
        if (typeof m.mentionRaidProtectionEnabled === 'boolean') meta.mentionRaidProtectionEnabled = m.mentionRaidProtectionEnabled;
        if (Object.keys(meta).length > 0) out.triggerMetadata = meta;
    }
    if (Array.isArray(body.actions)) {
        const actions = (body.actions as Array<{ type?: unknown; metadata?: Record<string, unknown> }>).filter(a =>
            typeof a.type === 'number' && Number.isFinite(a.type)
        ).map(a => ({ type: a.type as number, metadata: a.metadata }));
        if (actions.length > 0) out.actions = actions;
    } else if (!partial) {
        return { error: 'actions required (1+ entry)' };
    }
    const exemptRoles = asStringArray(body.exemptRoles);
    if (exemptRoles) out.exemptRoles = exemptRoles;
    const exemptChannels = asStringArray(body.exemptChannels);
    if (exemptChannels) out.exemptChannels = exemptChannels;
    if (typeof body.reason === 'string') out.reason = body.reason;
    return { value: out };
}

function serializeAutoModRule(rule: import('discord.js').AutoModerationRule) {
    return {
        id: rule.id,
        name: rule.name,
        enabled: rule.enabled,
        eventType: Number(rule.eventType),
        triggerType: Number(rule.triggerType),
        triggerMetadata: {
            keywordFilter: rule.triggerMetadata.keywordFilter,
            regexPatterns: rule.triggerMetadata.regexPatterns,
            presets: rule.triggerMetadata.presets.map(p => Number(p)),
            allowList: rule.triggerMetadata.allowList,
            mentionTotalLimit: rule.triggerMetadata.mentionTotalLimit,
            mentionRaidProtectionEnabled: rule.triggerMetadata.mentionRaidProtectionEnabled
        },
        actions: rule.actions.map(a => ({
            type: Number(a.type),
            metadata: a.metadata
        })),
        exemptRoles: [...rule.exemptRoles.keys()],
        exemptChannels: [...rule.exemptChannels.keys()],
        creatorId: rule.creatorId
    };
}

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

    // ── Message ops (pin, unpin, crosspost, bulk delete) ────────────────

    server.post<{ Params: { guildId: string; channelId: string; messageId: string } }>(
        '/api/guilds/:guildId/text-channels/:channelId/messages/:messageId/pin',
        async (request, reply) => {
            if (!requireGuildCapability(request, reply, request.params.guildId, 'manage')) return;
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
            if (!requireGuildCapability(request, reply, request.params.guildId, 'manage')) return;
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
            if (!requireGuildCapability(request, reply, request.params.guildId, 'manage')) return;
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
            if (!requireGuildCapability(request, reply, request.params.guildId, 'manage')) return;
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
            if (!requireGuildCapability(request, reply, request.params.guildId, 'manage')) return;
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
            if (!requireGuildCapability(request, reply, request.params.guildId, 'manage')) return;
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
            if (!requireGuildCapability(request, reply, request.params.guildId, 'manage')) return;
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
            if (!requireGuildCapability(request, reply, request.params.guildId, 'manage')) return;
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
            if (!requireGuildCapability(request, reply, request.params.guildId, 'manage')) return;
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
            if (!requireGuildCapability(request, reply, request.params.guildId, 'manage')) return;
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
            if (!requireGuildCapability(request, reply, request.params.guildId, 'manage')) return;
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
            if (!requireGuildCapability(request, reply, request.params.guildId, 'manage')) return;
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
            if (!requireGuildCapability(request, reply, request.params.guildId, 'manage')) return;
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
            if (!requireGuildCapability(request, reply, request.params.guildId, 'manage')) return;
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
            if (!requireGuildCapability(request, reply, request.params.guildId, 'manage')) return;
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

    // ── Guild settings (general / moderation / system) ───────────────────

    server.get<{ Params: { guildId: string } }>(
        '/api/guilds/:guildId/settings',
        async (request, reply) => {
            if (!requireGuildCapability(request, reply, request.params.guildId, 'manage')) return;
            const guild = bot.guilds.cache.get(request.params.guildId);
            if (!guild) { reply.code(404).send({ error: 'Unknown guild' }); return; }
            return { settings: serializeGuildSettings(guild) };
        }
    );

    server.patch<{ Params: { guildId: string }; Body: GuildSettingsPatchBody }>(
        '/api/guilds/:guildId/settings',
        async (request, reply) => {
            if (!requireGuildCapability(request, reply, request.params.guildId, 'manage')) return;
            const guild = bot.guilds.cache.get(request.params.guildId);
            if (!guild) { reply.code(404).send({ error: 'Unknown guild' }); return; }
            const body = request.body ?? {};
            const edit: Record<string, unknown> = {};
            if (typeof body.name === 'string' && body.name.trim()) edit.name = body.name.slice(0, 100);
            if (body.description === null) edit.description = null;
            else if (typeof body.description === 'string') edit.description = body.description.slice(0, 300);
            if ('afkChannelId' in body) {
                const v = body.afkChannelId;
                if (v === null) edit.afkChannel = null;
                else if (typeof v === 'string' && isSnowflake(v)) edit.afkChannel = v;
            }
            if (typeof body.afkTimeout === 'number') {
                // Discord only accepts these specific values.
                const allowed = new Set([60, 300, 900, 1800, 3600]);
                if (allowed.has(body.afkTimeout)) edit.afkTimeout = body.afkTimeout;
            }
            if ('systemChannelId' in body) {
                const v = body.systemChannelId;
                if (v === null) edit.systemChannel = null;
                else if (typeof v === 'string' && isSnowflake(v)) edit.systemChannel = v;
            }
            if (body.systemChannelFlags) {
                edit.systemChannelFlags = encodeSystemChannelFlags(body.systemChannelFlags);
            }
            if (typeof body.verificationLevel === 'number') {
                if (body.verificationLevel >= 0 && body.verificationLevel <= 4) edit.verificationLevel = body.verificationLevel;
            }
            if (typeof body.explicitContentFilter === 'number') {
                if (body.explicitContentFilter >= 0 && body.explicitContentFilter <= 2) edit.explicitContentFilter = body.explicitContentFilter;
            }
            if (typeof body.defaultMessageNotifications === 'number') {
                if (body.defaultMessageNotifications === 0 || body.defaultMessageNotifications === 1) {
                    edit.defaultMessageNotifications = body.defaultMessageNotifications;
                }
            }
            if ('rulesChannelId' in body) {
                const v = body.rulesChannelId;
                if (v === null) edit.rulesChannel = null;
                else if (typeof v === 'string' && isSnowflake(v)) edit.rulesChannel = v;
            }
            if ('publicUpdatesChannelId' in body) {
                const v = body.publicUpdatesChannelId;
                if (v === null) edit.publicUpdatesChannel = null;
                else if (typeof v === 'string' && isSnowflake(v)) edit.publicUpdatesChannel = v;
            }
            if (typeof body.premiumProgressBarEnabled === 'boolean') {
                edit.premiumProgressBarEnabled = body.premiumProgressBarEnabled;
            }
            if (Object.keys(edit).length === 0) {
                reply.code(400).send({ error: 'no editable fields supplied' });
                return;
            }
            const reason = typeof body.reason === 'string' ? body.reason : undefined;
            try {
                const updated = await guild.edit({ ...edit, reason });
                return { settings: serializeGuildSettings(updated) };
            } catch (err) {
                request.log.error({ err }, 'failed to edit guild settings');
                reply.code(502).send({ error: 'Failed to edit guild settings' });
            }
        }
    );

    // MFA level lives on its own endpoint — Discord requires the guild
    // owner to make this call, so it commonly returns 403 even for the
    // bot. Surface it separately so a normal settings save doesn't fail
    // the whole transaction when only MFA was rejected.
    server.patch<{ Params: { guildId: string }; Body: { level?: unknown } }>(
        '/api/guilds/:guildId/settings/mfa-level',
        async (request, reply) => {
            if (!requireGuildCapability(request, reply, request.params.guildId, 'manage')) return;
            const guild = bot.guilds.cache.get(request.params.guildId);
            if (!guild) { reply.code(404).send({ error: 'Unknown guild' }); return; }
            const level = request.body?.level;
            if (level !== 0 && level !== 1) {
                reply.code(400).send({ error: 'level must be 0 or 1' });
                return;
            }
            try {
                await guild.setMFALevel(level);
                reply.code(204).send();
            } catch (err) {
                request.log.error({ err }, 'failed to set MFA level');
                reply.code(502).send({ error: 'Failed to set MFA level (owner-only)' });
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

    // ── AutoMod rules ──────────────────────────────────────────────────

    server.get<{ Params: { guildId: string } }>(
        '/api/guilds/:guildId/automod/rules',
        async (request, reply) => {
            if (!requireGuildCapability(request, reply, request.params.guildId, 'manage')) return;
            const guild = bot.guilds.cache.get(request.params.guildId);
            if (!guild) { reply.code(404).send({ error: 'Unknown guild' }); return; }
            try {
                const rules = await guild.autoModerationRules.fetch();
                return { rules: [...rules.values()].map(serializeAutoModRule) };
            } catch (err) {
                request.log.error({ err }, 'failed to list automod rules');
                reply.code(502).send({ error: 'Failed to list AutoMod rules' });
            }
        }
    );

    server.post<{ Params: { guildId: string }; Body: AutoModRuleBody }>(
        '/api/guilds/:guildId/automod/rules',
        async (request, reply) => {
            if (!requireGuildCapability(request, reply, request.params.guildId, 'manage')) return;
            const guild = bot.guilds.cache.get(request.params.guildId);
            if (!guild) { reply.code(404).send({ error: 'Unknown guild' }); return; }
            const opts = parseAutoModBody(request.body ?? {});
            if ('error' in opts) { reply.code(400).send({ error: opts.error }); return; }
            try {
                const rule = await guild.autoModerationRules.create(opts.value as unknown as Parameters<typeof guild.autoModerationRules.create>[0]);
                return { rule: serializeAutoModRule(rule) };
            } catch (err) {
                request.log.error({ err }, 'failed to create automod rule');
                reply.code(502).send({ error: 'Failed to create AutoMod rule' });
            }
        }
    );

    server.patch<{ Params: { guildId: string; ruleId: string }; Body: AutoModRuleBody }>(
        '/api/guilds/:guildId/automod/rules/:ruleId',
        async (request, reply) => {
            if (!requireGuildCapability(request, reply, request.params.guildId, 'manage')) return;
            const { guildId, ruleId } = request.params;
            if (!isSnowflake(ruleId)) { reply.code(400).send({ error: 'invalid ruleId' }); return; }
            const guild = bot.guilds.cache.get(guildId);
            if (!guild) { reply.code(404).send({ error: 'Unknown guild' }); return; }
            const opts = parseAutoModBody(request.body ?? {}, true);
            if ('error' in opts) { reply.code(400).send({ error: opts.error }); return; }
            try {
                const rule = await guild.autoModerationRules.edit(ruleId, opts.value as Parameters<typeof guild.autoModerationRules.edit>[1]);
                return { rule: serializeAutoModRule(rule) };
            } catch (err) {
                request.log.error({ err }, 'failed to edit automod rule');
                reply.code(502).send({ error: 'Failed to edit AutoMod rule' });
            }
        }
    );

    server.delete<{ Params: { guildId: string; ruleId: string }; Body: { reason?: unknown } }>(
        '/api/guilds/:guildId/automod/rules/:ruleId',
        async (request, reply) => {
            if (!requireGuildCapability(request, reply, request.params.guildId, 'manage')) return;
            const { guildId, ruleId } = request.params;
            if (!isSnowflake(ruleId)) { reply.code(400).send({ error: 'invalid ruleId' }); return; }
            const guild = bot.guilds.cache.get(guildId);
            if (!guild) { reply.code(404).send({ error: 'Unknown guild' }); return; }
            const reason = typeof request.body?.reason === 'string' ? request.body.reason : undefined;
            try {
                await guild.autoModerationRules.delete(ruleId, reason);
                reply.code(204).send();
            } catch (err) {
                request.log.error({ err }, 'failed to delete automod rule');
                reply.code(502).send({ error: 'Failed to delete AutoMod rule' });
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
            if (!requireGuildCapability(request, reply, request.params.guildId, 'manage')) return;
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
            if (!requireGuildCapability(request, reply, request.params.guildId, 'manage')) return;
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
            if (!requireGuildCapability(request, reply, request.params.guildId, 'manage')) return;
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
            if (!requireGuildCapability(request, reply, request.params.guildId, 'manage')) return;
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
            if (!requireGuildCapability(request, reply, request.params.guildId, 'manage')) return;
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
            if (!requireGuildCapability(request, reply, request.params.guildId, 'manage')) return;
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
            if (!requireGuildCapability(request, reply, request.params.guildId, 'manage')) return;
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

    // Reject groupIds that aren't a number array, or that reference a
    // group from a different guild. Returns null on validation failure
    // so the caller can short-circuit with a 400; an empty array is a
    // valid input meaning "no pin".
    async function validateGroupIds(raw: unknown, guildId: string): Promise<number[] | null> {
        if (raw === undefined || raw === null) return [];
        if (!Array.isArray(raw)) return null;
        const ids: number[] = [];
        for (const v of raw) {
            const n = typeof v === 'number' ? v : Number(v);
            if (!Number.isFinite(n)) return null;
            ids.push(n);
        }
        if (ids.length === 0) return [];
        const owned = await RoleEmojiGroup.findAll({ where: { guildId, id: ids } });
        if (owned.length !== new Set(ids).size) return null;
        return ids;
    }

    // Role-emoji mapping ────────────────────────────────────────────────
    //
    // The `emoji` body parses with the same regex the slash command uses,
    // so the call site can pass a raw emoji literal (`👍` or `<:foo:123>`)
    // instead of having to mirror the parsing logic. Either branch fills
    // both PK columns (emojiChar / emojiId) so the SQL row is unique.
    const EMOJI_REGEX = /(\u00a9|\u00ae|[\u2000-\u3300]|\ud83c[\ud000-\udfff]|\ud83d[\ud000-\udfff]|\ud83e[\ud000-\udfff])|^<(a?:[^:>]+:)([^>]+)>$/;
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
                await RoleEmoji.create({
                    groupId,
                    roleId: b.roleId,
                    emojiChar: m[1] ?? '',
                    emojiName: m[2] ?? '',
                    emojiId: m[3] ?? ''
                });
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
    server.post<{ Params: { guildId: string }; Body: { channelId?: unknown; messageId?: unknown; groupIds?: unknown } }>(
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
            // Optional pin set — when omitted the message resolves
            // against every group in the guild at runtime.
            const groupIds = await validateGroupIds(b.groupIds, guildId);
            if (groupIds === null) { reply.code(400).send({ error: 'invalid groupIds' }); return; }
            await RoleReceiveMessage.upsert({ guildId, channelId: b.channelId, messageId: b.messageId });
            await setMessageGroups(guildId, b.channelId, b.messageId, groupIds);
            reply.code(204).send();
        }
    );
    server.put<{
        Params: { guildId: string; channelId: string; messageId: string };
        Body: { groupIds?: unknown }
    }>(
        '/api/guilds/:guildId/feature/role-receive-messages/:channelId/:messageId/groups',
        async (request, reply) => {
            if (!requireGuildCapability(request, reply, request.params.guildId, 'manage')) return;
            const { guildId, channelId, messageId } = request.params;
            const existing = await RoleReceiveMessage.findOne({ where: { guildId, channelId, messageId } });
            if (!existing) { reply.code(404).send({ error: 'watched message not found' }); return; }
            const groupIds = await validateGroupIds(request.body?.groupIds, guildId);
            if (groupIds === null) { reply.code(400).send({ error: 'invalid groupIds' }); return; }
            await setMessageGroups(guildId, channelId, messageId, groupIds);
            reply.code(204).send();
        }
    );
    server.delete<{ Params: { guildId: string; channelId: string; messageId: string } }>(
        '/api/guilds/:guildId/feature/role-receive-messages/:channelId/:messageId',
        async (request, reply) => {
            if (!requireGuildCapability(request, reply, request.params.guildId, 'manage')) return;
            const { guildId, channelId, messageId } = request.params;
            await RoleReceiveMessage.destroy({ where: { guildId, channelId, messageId } });
            await removeAllMessageGroups(guildId, channelId, messageId);
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
