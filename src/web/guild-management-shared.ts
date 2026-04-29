import type { Client } from "discord.js";
import { ChannelType, PermissionsBitField } from "discord.js";
import type { GuildChannelEventBus } from "./guild-channel-event-bus.js";

export interface GuildManagementRoutesOptions {
  bot: Client;
  eventBus?: GuildChannelEventBus;
}

/**
 * Validate and normalize a role create/edit body. Discord accepts
 * `permissions` either as a bitfield bigint string or as an array of
 * permission names; we always convert to a `PermissionsBitField` so the
 * route handlers can pass it straight to discord.js.
 */
export function parseRoleBody(body: {
  name?: unknown;
  color?: unknown;
  hoist?: unknown;
  mentionable?: unknown;
  permissions?: unknown;
  reason?: unknown;
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
  if (typeof body.name === "string") {
    const trimmed = body.name.trim();
    if (trimmed.length > 100) return { error: "name must be ≤100 chars" };
    if (trimmed.length > 0) out.name = trimmed;
  }
  if (typeof body.color === "number" && Number.isFinite(body.color)) {
    const c = Math.floor(body.color);
    if (c < 0 || c > 0xffffff)
      return { error: "color must be a 24-bit RGB int" };
    out.color = c;
  } else if (typeof body.color === "string" && body.color) {
    // Accept "#rrggbb" / "rrggbb" so the colour input on the form
    // doesn't need to convert client-side.
    const hex = body.color.replace(/^#/, "");
    if (!/^[0-9a-fA-F]{6}$/.test(hex))
      return { error: "color must be #RRGGBB" };
    out.color = parseInt(hex, 16);
  }
  if (typeof body.hoist === "boolean") out.hoist = body.hoist;
  if (typeof body.mentionable === "boolean") out.mentionable = body.mentionable;
  if (typeof body.permissions === "string") {
    try {
      out.permissions = new PermissionsBitField(BigInt(body.permissions));
    } catch {
      return { error: "permissions must be a bigint string" };
    }
  }
  if (typeof body.reason === "string") out.reason = body.reason;
  return out;
}

/**
 * Same widening as guild-channel-routes' fetchTextChannel — a thin local
 * copy so this file doesn't import the route module just for a helper.
 */
export function fetchTextLike(bot: Client, guildId: string, channelId: string) {
  const guild = bot.guilds.cache.get(guildId);
  if (!guild) return null;
  const channel = guild.channels.cache.get(channelId);
  if (!channel) return null;
  if (
    channel.type === ChannelType.GuildText ||
    channel.type === ChannelType.GuildAnnouncement ||
    channel.type === ChannelType.PublicThread ||
    channel.type === ChannelType.PrivateThread ||
    channel.type === ChannelType.AnnouncementThread ||
    channel.type === ChannelType.GuildVoice ||
    channel.type === ChannelType.GuildStageVoice
  ) {
    // The members of this union all expose `.messages.fetch` /
    // `.bulkDelete` at runtime; the cast is a typing convenience.
    return channel as unknown as import("discord.js").TextChannel;
  }
  return null;
}
