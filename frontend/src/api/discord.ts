import { ApiError, authedFetch, jsonOrThrow } from "./client";
import type {
  CustomEmoji,
  GuildBucket,
  GuildSticker,
} from "../libs/messages/types";
import type { DiscordUserSummary } from "./types";

export type { CustomEmoji, GuildBucket, GuildSticker, DiscordUserSummary };

export async function listEmojis(): Promise<GuildBucket<CustomEmoji>[]> {
  const response = await authedFetch("/api/discord/emojis");
  const body = await jsonOrThrow<{ guilds: GuildBucket<CustomEmoji>[] }>(
    response,
  );
  return body.guilds;
}

export async function listStickers(): Promise<GuildBucket<GuildSticker>[]> {
  const response = await authedFetch("/api/discord/stickers");
  const body = await jsonOrThrow<{ guilds: GuildBucket<GuildSticker>[] }>(
    response,
  );
  return body.guilds;
}

export async function loadStickerLottie(
  stickerId: string,
): Promise<unknown | null> {
  const response = await authedFetch(
    `/api/discord/stickers/${encodeURIComponent(stickerId)}/lottie`,
  );
  if (!response.ok) return null;
  return await response.json();
}

export interface DiscordUserProfileDetail {
  user: {
    id: string;
    username: string;
    globalName: string | null;
    discriminator: string | null;
    avatarUrl: string;
    bannerUrl: string | null;
    accentColor: number | null;
    bot: boolean;
  };
  member: {
    nickname: string | null;
    joinedAt: string | null;
    avatarUrl: string | null;
    bannerUrl: string | null;
    roles: Array<{
      id: string;
      name: string;
      color: string | null;
      position: number;
    }>;
  } | null;
}

/**
 * Profile lookup for the user-card popover. Returns the user + their
 * per-guild member info when `guildId` is supplied. Surfaces ApiError
 * on non-OK responses so callers can distinguish a transient failure
 * from a "user not found" / no-access result.
 */
export async function fetchUserProfile(
  userId: string,
  guildId: string | null,
): Promise<DiscordUserProfileDetail> {
  const url = guildId
    ? `/api/discord/users/${encodeURIComponent(userId)}?guildId=${encodeURIComponent(guildId)}`
    : `/api/discord/users/${encodeURIComponent(userId)}`;
  return jsonOrThrow<DiscordUserProfileDetail>(await authedFetch(url));
}

export interface DiscordMessageLinkInfo {
  guildId: string | null;
  guildName: string | null;
  guildIconUrl: string | null;
  channelId: string;
  channelName: string;
  /** Null when the URL is a channel-only link (no trailing message id). */
  messageId: string | null;
  /** Null for channel-only links; populated for message links. */
  preview: string | null;
}

/**
 * Batch-resolve lightweight user summaries (username + globalName + avatar)
 * for a list of user ids. Uses the bot's internal cache; no force-fetch.
 * Unknown ids map to null. Caller should chunk to ≤50 ids per call if
 * needed — the backend rejects larger batches with 400.
 */
export async function fetchUserSummaries(
  ids: string[],
): Promise<Record<string, DiscordUserSummary | null>> {
  if (ids.length === 0) return {};
  const response = await authedFetch(
    `/api/discord/users/bulk?ids=${ids.map(encodeURIComponent).join(",")}`,
  );
  if (!response.ok) {
    // Non-fatal for name resolution — return empty so callers fall back
    // to the raw userId display.
    return {};
  }
  const body = (await response.json()) as {
    users: Record<string, DiscordUserSummary | null>;
  };
  return body.users;
}

/**
 * Resolve metadata for a Discord permalink. Accepts either message links
 * (with `messageId`) or channel links (without). Returns `null` when the
 * target is unreachable — bot not in guild, channel not visible, message
 * deleted — so the caller can render an "unknown" chip instead of an
 * error toast.
 */
export async function fetchMessageLink(
  guildId: string | null,
  channelId: string,
  messageId: string | null,
): Promise<DiscordMessageLinkInfo | null> {
  const params = new URLSearchParams();
  if (guildId) params.set("guild", guildId);
  params.set("channel", channelId);
  if (messageId) params.set("message", messageId);
  const response = await authedFetch(
    `/api/discord/message-link?${params.toString()}`,
  );
  if (response.status === 404) return null;
  if (!response.ok)
    throw new ApiError(
      response.status,
      `${response.status} ${response.statusText}`,
    );
  return (await response.json()) as DiscordMessageLinkInfo;
}
