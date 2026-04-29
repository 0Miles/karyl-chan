import type { FastifyInstance } from "fastify";
import { GuildSystemChannelFlags } from "discord.js";
import { requireGuildCapability } from "../web-core/route-guards.js";
import { isSnowflake } from "../web-core/validators.js";
import type { GuildManagementRoutesOptions } from "./guild-management-shared.js";

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

function serializeGuildSettings(guild: import("discord.js").Guild) {
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
      suppressJoinNotifications: flags.has(
        GuildSystemChannelFlags.SuppressJoinNotifications,
      ),
      suppressPremiumSubscriptions: flags.has(
        GuildSystemChannelFlags.SuppressPremiumSubscriptions,
      ),
      suppressGuildReminderNotifications: flags.has(
        GuildSystemChannelFlags.SuppressGuildReminderNotifications,
      ),
      suppressJoinNotificationReplies: flags.has(
        GuildSystemChannelFlags.SuppressJoinNotificationReplies,
      ),
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
    features: [...guild.features],
  };
}

function encodeSystemChannelFlags(payload: SystemChannelFlagsPayload): number {
  let bits = 0;
  if (payload.suppressJoinNotifications)
    bits |= GuildSystemChannelFlags.SuppressJoinNotifications;
  if (payload.suppressPremiumSubscriptions)
    bits |= GuildSystemChannelFlags.SuppressPremiumSubscriptions;
  if (payload.suppressGuildReminderNotifications)
    bits |= GuildSystemChannelFlags.SuppressGuildReminderNotifications;
  if (payload.suppressJoinNotificationReplies)
    bits |= GuildSystemChannelFlags.SuppressJoinNotificationReplies;
  return bits;
}

export async function registerGuildSettingsRoutes(
  server: FastifyInstance,
  options: GuildManagementRoutesOptions,
): Promise<void> {
  const { bot } = options;

  // ── Guild settings (general / moderation / system) ───────────────────

  server.get<{ Params: { guildId: string } }>(
    "/api/guilds/:guildId/settings",
    async (request, reply) => {
      if (
        !requireGuildCapability(
          request,
          reply,
          request.params.guildId,
          "manage",
        )
      )
        return;
      const guild = bot.guilds.cache.get(request.params.guildId);
      if (!guild) {
        reply.code(404).send({ error: "Unknown guild" });
        return;
      }
      return { settings: serializeGuildSettings(guild) };
    },
  );

  server.patch<{ Params: { guildId: string }; Body: GuildSettingsPatchBody }>(
    "/api/guilds/:guildId/settings",
    async (request, reply) => {
      if (
        !requireGuildCapability(
          request,
          reply,
          request.params.guildId,
          "manage",
        )
      )
        return;
      const guild = bot.guilds.cache.get(request.params.guildId);
      if (!guild) {
        reply.code(404).send({ error: "Unknown guild" });
        return;
      }
      const body = request.body ?? {};
      const edit: Record<string, unknown> = {};
      if (typeof body.name === "string" && body.name.trim())
        edit.name = body.name.slice(0, 100);
      if (body.description === null) edit.description = null;
      else if (typeof body.description === "string")
        edit.description = body.description.slice(0, 300);
      if ("afkChannelId" in body) {
        const v = body.afkChannelId;
        if (v === null) edit.afkChannel = null;
        else if (typeof v === "string" && isSnowflake(v)) edit.afkChannel = v;
      }
      if (typeof body.afkTimeout === "number") {
        // Discord only accepts these specific values.
        const allowed = new Set([60, 300, 900, 1800, 3600]);
        if (allowed.has(body.afkTimeout)) edit.afkTimeout = body.afkTimeout;
      }
      if ("systemChannelId" in body) {
        const v = body.systemChannelId;
        if (v === null) edit.systemChannel = null;
        else if (typeof v === "string" && isSnowflake(v))
          edit.systemChannel = v;
      }
      if (body.systemChannelFlags) {
        edit.systemChannelFlags = encodeSystemChannelFlags(
          body.systemChannelFlags,
        );
      }
      if (typeof body.verificationLevel === "number") {
        if (body.verificationLevel >= 0 && body.verificationLevel <= 4)
          edit.verificationLevel = body.verificationLevel;
      }
      if (typeof body.explicitContentFilter === "number") {
        if (body.explicitContentFilter >= 0 && body.explicitContentFilter <= 2)
          edit.explicitContentFilter = body.explicitContentFilter;
      }
      if (typeof body.defaultMessageNotifications === "number") {
        if (
          body.defaultMessageNotifications === 0 ||
          body.defaultMessageNotifications === 1
        ) {
          edit.defaultMessageNotifications = body.defaultMessageNotifications;
        }
      }
      if ("rulesChannelId" in body) {
        const v = body.rulesChannelId;
        if (v === null) edit.rulesChannel = null;
        else if (typeof v === "string" && isSnowflake(v)) edit.rulesChannel = v;
      }
      if ("publicUpdatesChannelId" in body) {
        const v = body.publicUpdatesChannelId;
        if (v === null) edit.publicUpdatesChannel = null;
        else if (typeof v === "string" && isSnowflake(v))
          edit.publicUpdatesChannel = v;
      }
      if (typeof body.premiumProgressBarEnabled === "boolean") {
        edit.premiumProgressBarEnabled = body.premiumProgressBarEnabled;
      }
      if (Object.keys(edit).length === 0) {
        reply.code(400).send({ error: "no editable fields supplied" });
        return;
      }
      const reason = typeof body.reason === "string" ? body.reason : undefined;
      try {
        const updated = await guild.edit({ ...edit, reason });
        return { settings: serializeGuildSettings(updated) };
      } catch (err) {
        request.log.error({ err }, "failed to edit guild settings");
        reply.code(502).send({ error: "Failed to edit guild settings" });
      }
    },
  );

  // MFA level lives on its own endpoint — Discord requires the guild
  // owner to make this call, so it commonly returns 403 even for the
  // bot. Surface it separately so a normal settings save doesn't fail
  // the whole transaction when only MFA was rejected.
  server.patch<{ Params: { guildId: string }; Body: { level?: unknown } }>(
    "/api/guilds/:guildId/settings/mfa-level",
    async (request, reply) => {
      if (
        !requireGuildCapability(
          request,
          reply,
          request.params.guildId,
          "manage",
        )
      )
        return;
      const guild = bot.guilds.cache.get(request.params.guildId);
      if (!guild) {
        reply.code(404).send({ error: "Unknown guild" });
        return;
      }
      const level = request.body?.level;
      if (level !== 0 && level !== 1) {
        reply.code(400).send({ error: "level must be 0 or 1" });
        return;
      }
      try {
        await guild.setMFALevel(level);
        reply.code(204).send();
      } catch (err) {
        request.log.error({ err }, "failed to set MFA level");
        reply.code(502).send({ error: "Failed to set MFA level (owner-only)" });
      }
    },
  );
}
