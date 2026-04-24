import { defineStore } from 'pinia';
import { fetchMessageLink, type DiscordMessageLinkInfo } from '../../../api/discord';

// Mirrors the matcher in `discord-link-handler.ts` — kept local to the
// store to avoid a circular import (the handler depends on this store).
// Tolerates ptb/canary subdomains and any trailing query/fragment; the
// message id is optional so channel-only links resolve too.
const MSG_LINK_RE = /^https?:\/\/(?:www\.|ptb\.|canary\.)?discord(?:app)?\.com\/channels\/(@me|\d+)\/(\d+)(?:\/(\d+))?(?:[/?#].*)?$/;

function parseMessageLink(url: string): { guildId: string | null; channelId: string; messageId: string | null } | null {
    const m = MSG_LINK_RE.exec(url);
    if (!m) return null;
    return { guildId: m[1] === '@me' ? null : m[1], channelId: m[2], messageId: m[3] ?? null };
}

type CachedValue = DiscordMessageLinkInfo | null;

/**
 * Per-session cache for Discord message-link metadata. Each URL resolves
 * to either a populated record or an "unresolvable" sentinel (null) so
 * a failed lookup doesn't get retried on every render of the chip. The
 * cache is cleared on reload since the underlying permissions and
 * channel names can drift over time.
 */
export const useMessageLinkStore = defineStore('discord-message-link', () => {
    const cache = new Map<string, CachedValue>();
    const inflight = new Map<string, Promise<CachedValue>>();

    async function resolve(url: string): Promise<CachedValue> {
        const parsed = parseMessageLink(url);
        if (!parsed) return null;
        if (cache.has(url)) return cache.get(url) ?? null;
        const pending = inflight.get(url);
        if (pending) return pending;
        const task = fetchMessageLink(parsed.guildId, parsed.channelId, parsed.messageId)
            .catch(() => null)
            .then(result => {
                cache.set(url, result);
                return result;
            })
            .finally(() => { inflight.delete(url); });
        inflight.set(url, task);
        return task;
    }

    return { resolve };
});
