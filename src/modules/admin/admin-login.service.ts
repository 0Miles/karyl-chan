import type { ChatInputCommandInteraction, Message } from "discord.js";
import { jwtService } from "../web-core/jwt.service.js";
import { resolveLoginRole } from "./authorized-user.service.js";
import { botEventLog } from "../bot-events/bot-event-log.js";
import { config } from "../../config.js";

/**
 * Admin login link issuance, factored out of the old
 * admin-login-dm.events.ts `@On()` handler so it can be invoked from
 * the unified behavior dispatcher (type='system' rows route here
 * instead of POSTing to a webhook / plugin) and from interactionCreate
 * when the system behavior's trigger type is 'slash_command'.
 *
 * `mintLoginLink` is the pure core (resolveRole → token → URL). The
 * two delivery wrappers — Message DM reply and Slash command
 * interaction reply — share that core but differ in how they hand
 * the URL back to the user.
 */

function buildBaseUrl(): string {
  if (config.web.baseUrl) return config.web.baseUrl.replace(/\/+$/, "");
  return `http://localhost:${config.web.port}`;
}

export type LoginLinkResult =
  | { ok: false; reason: string }
  | { ok: true; url: string; minutesUntilExpiry: number; role: string };

interface ContextRefs {
  guildId: string | null;
  channelId: string;
  /** Source message id, when triggered from a chat message; null for slash. */
  messageId: string | null;
}

async function mintLoginLink(
  userId: string,
  ctx: ContextRefs,
): Promise<LoginLinkResult> {
  // Owner OR anyone listed in authorized_users with at least one
  // active capability. Strip-of-all-capabilities is treated as
  // "deauthorized" — caller stays silent rather than tipping off
  // the sender that their userId is in the table.
  const role = await resolveLoginRole(userId);
  if (!role) return { ok: false, reason: "not authorized" };
  const { token, expiresAt } = jwtService.sign({
    purpose: "login",
    userId,
    guildId: ctx.guildId,
    channelId: ctx.channelId,
    // jwt.service.sign requires messageId — for slash-command
    // invocations there's no source message, so use the interaction
    // id (also stored on ctx.channelId? no — interaction-route caller
    // passes interaction.id semantically here via the channelId
    // shouldn't conflate). Easiest fix: synthesize a stable sentinel
    // so the audit trail still has SOMETHING the verify side accepts.
    messageId: ctx.messageId ?? `slash:${ctx.channelId}:${userId}`,
  });
  const url = `${buildBaseUrl()}/admin/auth?token=${encodeURIComponent(token)}`;
  const minutesUntilExpiry = Math.max(
    1,
    Math.round((expiresAt - Date.now()) / 60_000),
  );
  botEventLog.record(
    "info",
    "feature",
    `Admin login link issued to ${userId}`,
    {
      userId,
      role,
      expiresAt,
      guildId: ctx.guildId,
      channelId: ctx.channelId,
    },
  );
  return { ok: true, url, minutesUntilExpiry, role };
}

function formatLoginReply(
  result: Extract<LoginLinkResult, { ok: true }>,
): string {
  return `Login link (role: ${result.role}, expires in ~${result.minutesUntilExpiry} min):\n${result.url}`;
}

/**
 * DM-message-driven flow: invoked when a system behavior row with a
 * text-based triggerType (startswith / endswith / regex) matches a
 * user's DM. Replies in the same DM channel.
 */
export async function issueLoginLinkAndReply(
  message: Message,
): Promise<boolean> {
  try {
    const result = await mintLoginLink(message.author.id, {
      guildId: message.guild?.id ?? null,
      channelId: message.channel.id,
      messageId: message.id,
    });
    if (!result.ok) return false;
    await message.reply(formatLoginReply(result));
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("admin-login issue failed (message):", err);
    botEventLog.record("error", "feature", `Admin login DM failed: ${msg}`, {
      userId: message.author.id,
    });
    return false;
  }
}

/**
 * Slash-command flow: invoked when a system behavior row with
 * triggerType='slash_command' matches an inbound interaction. Reply
 * is ephemeral so the link doesn't leak into a shared channel even
 * if the slash command was invoked outside a DM (defensive — DM-only
 * registration on the Discord side already restricts visibility).
 *
 * Returns true when a reply was sent (whether authorized or not),
 * false only when something completely unexpected blew up. The caller
 * shouldn't fall through to the normal dispatcher either way.
 */
export async function issueLoginLinkForInteraction(
  interaction: ChatInputCommandInteraction,
): Promise<boolean> {
  try {
    const result = await mintLoginLink(interaction.user.id, {
      guildId: interaction.guildId,
      channelId: interaction.channelId,
      messageId: null,
    });
    if (!result.ok) {
      await interaction
        .reply({
          content: "你目前不在授權清單,請聯絡管理員。",
          ephemeral: true,
        })
        .catch(() => {});
      return true;
    }
    await interaction.reply({
      content: formatLoginReply(result),
      ephemeral: true,
    });
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("admin-login issue failed (interaction):", err);
    botEventLog.record("error", "feature", `Admin login slash failed: ${msg}`, {
      userId: interaction.user.id,
    });
    return false;
  }
}
