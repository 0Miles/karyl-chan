import { defineConfig } from 'vitest/config';

/**
 * Backend vitest config. Scopes the test runner to /tests so it
 * doesn't accidentally pick up the frontend's *.test.ts files (those
 * live under frontend/ with their own jsdom-based vitest config and
 * would explode here without localStorage / window).
 */
export default defineConfig({
    test: {
        environment: 'node',
        include: ['tests/**/*.test.ts']
    }
});
