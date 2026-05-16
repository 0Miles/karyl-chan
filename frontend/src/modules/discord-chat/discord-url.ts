/**
 * Discord permalink URL parser shared by the link handler and the
 * message-link store. Recognises:
 *
 *   https://discord.com/channels/<guildId>/<channelId>/<messageId>   (message)
 *   https://discord.com/channels/<guildId>/<channelId>               (channel)
 *   https://discord.com/channels/@me/<channelId>[/<messageId>]       (DM variants)
 *   https://ptb.discord.com/... / canary.discord.com/... / discordapp.com
 *
 * `@me` maps to `guildId === null`; omitting the trailing id makes it
 * a channel-only link. A trailing slash, query string, or fragment is
 * tolerated so users can paste URLs that carry tracking params.
 *
 * Originally duplicated in `discord-link-handler.ts` and
 * `stores/messageLinkStore.ts` to avoid a circular import (the
 * handler depended on the store); extracted here so neither file has
 * to import the other.
 */

export interface ParsedDiscordLink {
    guildId: string | null;
    channelId: string;
    messageId: string | null;
}

const DISCORD_LINK_RE = /^https?:\/\/(?:www\.|ptb\.|canary\.)?discord(?:app)?\.com\/channels\/(@me|\d+)\/(\d+)(?:\/(\d+))?(?:[/?#].*)?$/;

export function parseDiscordLink(url: string): ParsedDiscordLink | null {
    const m = DISCORD_LINK_RE.exec(url);
    if (!m) return null;
    return {
        guildId: m[1] === '@me' ? null : m[1],
        channelId: m[2],
        messageId: m[3] ?? null,
    };
}
