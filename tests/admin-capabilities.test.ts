import { describe, expect, it } from 'vitest';
import {
    hasAdminCapability,
    isAdminCapability,
    ADMIN_CAPABILITY_KEYS
} from '../src/permission/admin-capabilities.js';

describe('admin capabilities', () => {
    describe('isAdminCapability', () => {
        it('returns true for known tokens', () => {
            for (const key of ADMIN_CAPABILITY_KEYS) {
                expect(isAdminCapability(key)).toBe(true);
            }
        });
        it('returns false for unknown tokens', () => {
            expect(isAdminCapability('')).toBe(false);
            expect(isAdminCapability('not-a-real-capability')).toBe(false);
        });
    });

    describe('hasAdminCapability', () => {
        it('grants everything when the user has the admin token', () => {
            expect(hasAdminCapability(['admin'], 'admin')).toBe(true);
        });

        it('returns true when the required token is directly granted', () => {
            expect(hasAdminCapability(['admin'], 'admin')).toBe(true);
        });

        it('returns false when neither admin nor the required token is present', () => {
            // Today's universe only has `admin`, but the evaluator must still
            // refuse when the granted set is empty — locking down future
            // tokens by default.
            expect(hasAdminCapability([] as never, 'admin')).toBe(false);
        });

        it('accepts a Set as input', () => {
            expect(hasAdminCapability(new Set(['admin']), 'admin')).toBe(true);
        });
    });
});
