import { defineStore } from 'pinia';
import { ref } from 'vue';
import { getCurrentUser, type CurrentUser } from '../api/admin';

/**
 * Cached identity of the logged-in admin user — avatar, role, capability
 * set. App.vue refreshes this on auth transitions so the nav bar has
 * something to render without every component hitting /api/admin/me.
 */
export const useCurrentUserStore = defineStore('current-user', () => {
    const user = ref<CurrentUser | null>(null);
    const loading = ref(false);

    async function refresh(): Promise<void> {
        loading.value = true;
        try {
            user.value = await getCurrentUser();
        } catch {
            // Stale token / network blip — let the access-token plumbing
            // react to 401; we just null-out the cached identity.
            user.value = null;
        } finally {
            loading.value = false;
        }
    }

    function clear(): void {
        user.value = null;
    }

    return { user, loading, refresh, clear };
});
