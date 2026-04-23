import { ApiError } from '../../api/client';

export interface AuthErrorBailOptions {
    /** Caller-supplied navigation (e.g. router.replace({ name: 'auth' })). */
    onAuthError?: () => void;
    /** Extra cleanup to run before navigation — typically closes SSE streams. */
    onBail?: () => void;
}

/**
 * Returns a predicate that detects 401s from `api/client`, runs the caller's
 * cleanup + navigation, and signals that the error was handled. Both DM and
 * guild workspaces can share this so every API call gets the same bail-out.
 */
export function createAuthErrorBail(opts: AuthErrorBailOptions) {
    return function bail(err: unknown): boolean {
        if (err instanceof ApiError && err.status === 401) {
            opts.onBail?.();
            opts.onAuthError?.();
            return true;
        }
        return false;
    };
}
