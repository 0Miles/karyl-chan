import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
    plugins: [vue()],
    server: {
        port: 5173,
        proxy: {
            '/api': { target: 'http://localhost:3000', changeOrigin: false }
        }
    },
    build: {
        outDir: 'dist',
        emptyOutDir: true,
        rollupOptions: {
            output: {
                // Pin heavyweight runtime deps to their own chunks so a
                // route-only change doesn't bust the framework cache,
                // and the framework bundle isn't refetched on first
                // load of every additional admin route.
                manualChunks: {
                    'vendor-vue': ['vue', 'vue-router', 'pinia'],
                    'vendor-i18n': ['vue-i18n'],
                    'vendor-scroller': ['vue-virtual-scroller'],
                }
            }
        }
    }
});
