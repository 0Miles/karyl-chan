import { useRoute, useRouter } from 'vue-router';

/**
 * Strip the `?scrollTo=…` query param after a workspace has finished
 * jumping to the linked message. Without this the same jump would
 * re-trigger on every refresh / back-button hit. Used identically by
 * the DM and Guild workspaces; previously copy-pasted into both.
 */
export function useScrollToQuery() {
    const route = useRoute();
    const router = useRouter();

    function clearScrollToQuery(): void {
        if (typeof route.query.scrollTo !== 'string' || !route.query.scrollTo) return;
        const next = { ...route.query };
        delete next.scrollTo;
        router.replace({ query: next });
    }

    return { clearScrollToQuery };
}
