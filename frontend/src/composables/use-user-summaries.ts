import { ref, watch, type Ref, type ComputedRef } from 'vue';
import { fetchUserSummaries, type DiscordUserSummary } from '../api/discord';

const TTL_MS = 5 * 60 * 1000; // 5 minutes, aligned with userProfileStore

interface CacheEntry {
    value: DiscordUserSummary | null;
    expiresAt: number;
}

// Module-level cache shared across all composable instances on this page.
// Key is userId. Different from userProfileStore (which keys by userId@guildId)
// because bulk summaries are cross-guild.
const cache = new Map<string, CacheEntry>();
const inflight = new Set<string>();

function isFresh(entry: CacheEntry, now = Date.now()): boolean {
    return entry.expiresAt > now;
}

function getCached(userId: string, now = Date.now()): DiscordUserSummary | null | undefined {
    const entry = cache.get(userId);
    if (!entry) return undefined; // not in cache
    if (!isFresh(entry, now)) return undefined; // expired
    return entry.value; // may be null (user not found)
}

/**
 * Composable for resolving Discord user display names in bulk.
 *
 * Accepts a reactive list of user IDs, watches for changes, and fetches
 * only IDs that are not already cached. Uses a shared module-level cache
 * with a 5-minute TTL. In-flight dedup is handled at the batch level
 * (ids already queued in the current batch won't be re-fetched).
 *
 * Dashboard is cross-guild — no guildId param.
 */
export function useUserSummaries(userIds: Ref<string[]> | ComputedRef<string[]>) {
    const summaries = ref<Map<string, DiscordUserSummary | null>>(new Map());

    async function fetchMissing(ids: string[]) {
        const now = Date.now();
        const missing = ids.filter(id => {
            const cached = getCached(id, now);
            if (cached !== undefined) {
                // Populate local map from cache
                summaries.value.set(id, cached);
                return false;
            }
            // Skip ids already being fetched
            return !inflight.has(id);
        });

        if (missing.length === 0) return;

        // Mark as in-flight
        for (const id of missing) inflight.add(id);

        try {
            // Backend accepts max 50 per request
            const CHUNK = 50;
            for (let i = 0; i < missing.length; i += CHUNK) {
                const chunk = missing.slice(i, i + CHUNK);
                const result = await fetchUserSummaries(chunk);
                const expiresAt = Date.now() + TTL_MS;
                const next = new Map(summaries.value);
                for (const id of chunk) {
                    const val = result[id] ?? null;
                    cache.set(id, { value: val, expiresAt });
                    next.set(id, val);
                }
                summaries.value = next;
            }
        } finally {
            for (const id of missing) inflight.delete(id);
        }
    }

    watch(
        userIds,
        (ids) => {
            if (ids.length > 0) void fetchMissing(ids);
        },
        { immediate: true }
    );

    /** Preferred display name: globalName → username → null */
    function getDisplayName(userId: string): string | null {
        const s = summaries.value.get(userId);
        if (!s) return null;
        return s.globalName ?? s.username;
    }

    function getSummary(userId: string): DiscordUserSummary | null {
        return summaries.value.get(userId) ?? null;
    }

    return { getDisplayName, getSummary };
}
