import { describe, it, expect, vi, beforeEach } from 'vitest';
import { defineComponent, h } from 'vue';
import { mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { useApiError } from './use-api-error';
import { ApiError } from '../api/client';

function withRouter<T>(fn: () => T): { result: T; router: ReturnType<typeof createRouter> } {
    const router = createRouter({
        history: createMemoryHistory(),
        routes: [
            { path: '/admin/auth', name: 'auth', component: { render: () => h('div') } },
            { path: '/admin', name: 'home', component: { render: () => h('div') } }
        ]
    });
    let result!: T;
    const Host = defineComponent({
        setup() {
            result = fn();
            return () => h('div');
        }
    });
    mount(Host, { global: { plugins: [router] } });
    return { result, router };
}

describe('useApiError.handle', () => {
    beforeEach(() => {
        // Each test installs its own router; nothing global to reset.
    });

    it('returns "redirected" and pushes to /admin/auth on a 401', async () => {
        const { result, router } = withRouter(() => useApiError());
        await router.push('/admin');
        const replaceSpy = vi.spyOn(router, 'replace');
        const outcome = result.handle(new ApiError(401, 'expired'));
        expect(outcome).toBe('redirected');
        expect(replaceSpy).toHaveBeenCalledWith({ name: 'auth' });
    });

    it('returns "denied" and flips accessDenied on a 403', () => {
        const { result } = withRouter(() => useApiError());
        const outcome = result.handle(new ApiError(403, 'forbidden'));
        expect(outcome).toBe('denied');
        expect(result.accessDenied.value).toBe(true);
    });

    it('returns "unhandled" for non-401/403 ApiErrors', () => {
        const { result } = withRouter(() => useApiError());
        const outcome = result.handle(new ApiError(500, 'boom'));
        expect(outcome).toBe('unhandled');
        expect(result.accessDenied.value).toBe(false);
    });

    it('returns "unhandled" for non-ApiError values', () => {
        const { result } = withRouter(() => useApiError());
        expect(result.handle(new Error('network'))).toBe('unhandled');
        expect(result.handle('plain string')).toBe('unhandled');
        expect(result.handle(null)).toBe('unhandled');
    });

    it('reset() clears a previously set accessDenied flag', () => {
        const { result } = withRouter(() => useApiError());
        result.handle(new ApiError(403, 'forbidden'));
        expect(result.accessDenied.value).toBe(true);
        result.reset();
        expect(result.accessDenied.value).toBe(false);
    });
});
