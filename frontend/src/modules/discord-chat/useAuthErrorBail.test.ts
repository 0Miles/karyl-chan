import { describe, it, expect, vi } from 'vitest';
import { ApiError } from '../../api/client';
import { createAuthErrorBail } from './useAuthErrorBail';

describe('createAuthErrorBail', () => {
    it('returns false (and calls nothing) for non-ApiError values', () => {
        const onAuthError = vi.fn();
        const onForbidden = vi.fn();
        const onBail = vi.fn();
        const bail = createAuthErrorBail({ onAuthError, onForbidden, onBail });
        expect(bail(new Error('network down'))).toBe(false);
        expect(bail('string')).toBe(false);
        expect(bail(null)).toBe(false);
        expect(bail(undefined)).toBe(false);
        expect(onAuthError).not.toHaveBeenCalled();
        expect(onForbidden).not.toHaveBeenCalled();
        expect(onBail).not.toHaveBeenCalled();
    });

    it('returns false for ApiErrors with non-401/403 status', () => {
        const onAuthError = vi.fn();
        const onForbidden = vi.fn();
        const onBail = vi.fn();
        const bail = createAuthErrorBail({ onAuthError, onForbidden, onBail });
        expect(bail(new ApiError(500, 'boom'))).toBe(false);
        expect(bail(new ApiError(404, 'missing'))).toBe(false);
        expect(onAuthError).not.toHaveBeenCalled();
        expect(onBail).not.toHaveBeenCalled();
    });

    it('on 401 fires onBail then onAuthError and returns true', () => {
        const onAuthError = vi.fn();
        const onForbidden = vi.fn();
        const onBail = vi.fn();
        const bail = createAuthErrorBail({ onAuthError, onForbidden, onBail });
        expect(bail(new ApiError(401, 'expired'))).toBe(true);
        expect(onBail).toHaveBeenCalledOnce();
        expect(onAuthError).toHaveBeenCalledOnce();
        expect(onForbidden).not.toHaveBeenCalled();
        // Order matters — cleanup before navigation, otherwise the SSE
        // close races with the route change.
        expect(onBail.mock.invocationCallOrder[0]).toBeLessThan(onAuthError.mock.invocationCallOrder[0]);
    });

    it('on 403 fires onBail then onForbidden and returns true', () => {
        const onAuthError = vi.fn();
        const onForbidden = vi.fn();
        const onBail = vi.fn();
        const bail = createAuthErrorBail({ onAuthError, onForbidden, onBail });
        expect(bail(new ApiError(403, 'no perm'))).toBe(true);
        expect(onBail).toHaveBeenCalledOnce();
        expect(onForbidden).toHaveBeenCalledOnce();
        expect(onAuthError).not.toHaveBeenCalled();
    });

    it('all three callbacks are optional', () => {
        const bail = createAuthErrorBail({});
        expect(() => bail(new ApiError(401, 'x'))).not.toThrow();
        expect(() => bail(new ApiError(403, 'x'))).not.toThrow();
        expect(bail(new ApiError(401, 'x'))).toBe(true);
    });
});
