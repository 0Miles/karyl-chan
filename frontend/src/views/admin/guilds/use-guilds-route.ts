import { ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

/**
 * Two-way binds the GuildsPage's selected guild to the `?guild=<id>`
 * URL query param so deep-links open the right guild on first load.
 *
 * Tab + sub-tab routing lives on `<AppTabs routed>` itself, keyed by
 * the `name` prop, so the responsibility for that part of the URL sits
 * next to the component that owns the tab state.
 *
 * URL pushes use `router.replace` so flipping guilds doesn't fill the
 * browser back stack.
 */
export function useGuildsRoute() {
    const route = useRoute();
    const router = useRouter();

    const selectedId = ref<string | null>(null);

    function readFromRoute() {
        const raw = route.query.guild;
        const next = typeof raw === 'string' ? raw : null;
        if (next !== selectedId.value) selectedId.value = next;
    }

    function syncToRoute() {
        const next = { ...route.query };
        if (selectedId.value) next.guild = selectedId.value;
        else delete next.guild;
        if ((route.query.guild ?? null) === (next.guild ?? null)) return;
        router.replace({ query: next });
    }

    // Seed from the URL on mount before any state→URL watcher fires —
    // otherwise the initial sync would clobber the deep-link.
    readFromRoute();

    watch(selectedId, syncToRoute);
    watch(() => route.query.guild, () => readFromRoute());

    return { selectedId };
}
