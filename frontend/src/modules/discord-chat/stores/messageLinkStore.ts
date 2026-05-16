import { defineStore } from 'pinia';
import { fetchMessageLink, type DiscordMessageLinkInfo } from '../../../api/discord';
import { parseDiscordLink } from '../discord-url';

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
        const parsed = parseDiscordLink(url);
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
