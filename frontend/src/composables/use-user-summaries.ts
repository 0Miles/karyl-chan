import { watch, type Ref, type ComputedRef } from 'vue';
import { useUserSummaryStore } from '../modules/discord-chat/stores/userSummaryStore';
import type { DiscordUserSummary } from '../api/discord';

/**
 * Thin reactive wrapper: feeds the user-summary Pinia store from a
 * reactive userIds list. Components should read display names directly
 * via the store (`store.getDisplayName(id)` / `store.getSummary(id)`)
 * to participate in Pinia state reactivity.
 *
 * Returned helpers are convenience accessors that delegate to the store.
 */
export function useUserSummaries(userIds: Ref<string[]> | ComputedRef<string[]>) {
    const store = useUserSummaryStore();

    watch(userIds, ids => {
        if (ids.length > 0) void store.resolve(ids);
    }, { immediate: true });

    function getDisplayName(userId: string): string | null {
        return store.getDisplayName(userId);
    }

    function getSummary(userId: string): DiscordUserSummary | null {
        return store.getSummary(userId);
    }

    return { getDisplayName, getSummary, store };
}
