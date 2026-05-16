/**
 * Map a thrown discord.js / Discord REST error to the right HTTP
 * status for the route's response. The Discord side's `code` (raw
 * Discord API code) and `status` (HTTP) are duck-typed off the
 * thrown error so we don't have to import DiscordAPIError into
 * every catch block.
 *
 *   50013 / 50001                                → 403 Missing Permission / Access
 *   10003 / 10007 / 10008 / 10013 / 10014        → 404 Unknown {channel, guild, message, user, emoji}
 *   HTTP 429                                     → 429 Rate-limited
 *   HTTP ≥ 500                                   → 502 Upstream (Discord outage)
 *   everything else                              → 400 (caller bug)
 *
 * Originally lived in `plugin-system/plugin-rpc-routes.ts`; shared
 * here so the guild + DM reaction routes can use the same mapping
 * without duplicating the table.
 */
export function discordErrorStatus(err: unknown): number {
  if (!err || typeof err !== "object") return 400;
  const e = err as { code?: unknown; status?: unknown };
  const code = typeof e.code === "number" ? e.code : null;
  const status = typeof e.status === "number" ? e.status : null;
  if (code === 50013 || code === 50001) return 403;
  if (
    code === 10003 ||
    code === 10007 ||
    code === 10008 ||
    code === 10013 ||
    code === 10014
  )
    return 404;
  if (status === 429) return 429;
  if (status !== null && status >= 500) return 502;
  return 400;
}
