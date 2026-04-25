import { ApiError } from '../../api/client';

export interface AuthErrorBailOptions {
    /** Caller-supplied navigation (e.g. router.replace({ name: 'auth' })). */
    onAuthError?: () => void;
    /** Cleanup to run on 401 — typically closes SSE streams. */
    onBail?: () => void;
    /** Called on 403 so the workspace can swap in an access-denied view
     *  instead of surfacing a raw error. Distinct from onAuthError
     *  because 403 is recoverable (the user's role might be granted
     *  back) and we don't want to redirect away from the page. */
    onForbidden?: () => void;
}

/**
 * Returns a predicate that detects 401/403s from `api/client`, runs the
 * caller's cleanup + navigation, and signals that the error was
 * handled. Both DM and guild workspaces can share this so every API
 * call gets the same bail-out.
 */
export function createAuthErrorBail(opts: AuthErrorBailOptions) {
    return function bail(err: unknown): boolean {
        if (!(err instanceof ApiError)) return false;
        if (err.status === 401) {
            opts.onBail?.();
            opts.onAuthError?.();
            return true;
        }
        if (err.status === 403) {
            opts.onBail?.();
            opts.onForbidden?.();
            return true;
        }
        return false;
    };
}
