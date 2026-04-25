import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';

/**
 * Vitest config for the frontend. jsdom is the default so the same
 * test file can exercise pure logic modules and Vue components — the
 * cost of jsdom for purely-Node tests is small enough that the
 * convenience of one config wins. Plain logic modules can override
 * with `// @vitest-environment node` if hot-paths matter.
 *
 * The Vue plugin is needed for any future *.vue test imports;
 * currently no component tests exist but pre-wiring it is cheap.
 */
export default defineConfig({
    plugins: [vue()],
    test: {
        environment: 'jsdom',
        globals: false,
        // localStorage is a JSDOM API, but Pinia's setup-store helpers
        // create stores lazily. Tests instantiate via createPinia() to
        // keep state isolated.
        include: ['src/**/*.test.ts'],
        // Limit by default — tests live alongside source modules.
        css: false
    }
});
