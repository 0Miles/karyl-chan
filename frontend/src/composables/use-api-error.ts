import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { ApiError } from '../api/client';

/**
 * Page-level error normalisation for the admin surface. Returns an
 * `accessDenied` ref the page can bind to and a `handle(err)` helper
 * that catches the two terminal auth states uniformly:
 *
 *   - 401 → token gone / refresh failed → push to /admin/auth (returns
 *     `'redirected'` so the caller can stop further work).
 *   - 403 → authenticated but missing the required capability → flips
 *     `accessDenied` so the page can swap in a friendly "no access"
 *     view instead of a raw error banner (returns `'denied'`).
 *   - anything else → returns `'unhandled'`; the caller is responsible
 *     for showing the message.
 *
 * Mirrors the inline 401/403 handling that UsersPage had before — kept
 * as a hook so every admin page gets the same behaviour without
 * copy-pasting the conditional ladder.
 */
export type ApiErrorOutcome = 'redirected' | 'denied' | 'unhandled';

export function useApiError() {
    const router = useRouter();
    const accessDenied = ref(false);
    function reset() {
        accessDenied.value = false;
    }
    function handle(err: unknown): ApiErrorOutcome {
        if (err instanceof ApiError) {
            if (err.status === 401) {
                router.replace({ name: 'auth' });
                return 'redirected';
            }
            if (err.status === 403) {
                accessDenied.value = true;
                return 'denied';
            }
        }
        return 'unhandled';
    }
    return { accessDenied, reset, handle };
}
