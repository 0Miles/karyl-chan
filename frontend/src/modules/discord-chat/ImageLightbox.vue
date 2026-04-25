<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue';
import { Icon } from '@iconify/vue';
import { useLightboxStore } from './stores/lightboxStore';

/**
 * Fullscreen image viewer. Visible whenever the lightboxStore has
 * images queued up. Keys: ←/→ navigate, Esc closes. Click outside
 * the image (on the backdrop) also closes; click on the image itself
 * is captured so navigation buttons can sit on top without dismissing.
 *
 * Mounted once globally — sized to the viewport and not the message
 * column so the largest possible canvas is available.
 */

const store = useLightboxStore();
const visible = computed(() => store.images.length > 0);
const current = computed(() => store.images[store.index] ?? null);

function onKey(event: KeyboardEvent) {
    if (!visible.value) return;
    if (event.key === 'Escape') {
        event.preventDefault();
        store.close();
        return;
    }
    if (event.key === 'ArrowLeft') {
        event.preventDefault();
        store.prev();
        return;
    }
    if (event.key === 'ArrowRight') {
        event.preventDefault();
        store.next();
    }
}

onMounted(() => window.addEventListener('keydown', onKey));
onUnmounted(() => window.removeEventListener('keydown', onKey));
</script>

<template>
    <Teleport to="body">
        <div v-if="visible" class="lb-backdrop" @click.self="store.close">
            <button
                v-if="store.images.length > 1"
                type="button"
                class="lb-nav lb-prev"
                :aria-label="$t('messages.lightboxPrev')"
                @click="store.prev"
            >
                <Icon icon="material-symbols:chevron-left-rounded" width="32" height="32" />
            </button>
            <figure class="lb-frame" @click.stop>
                <img
                    v-if="current"
                    :src="current.url"
                    :alt="current.filename ?? ''"
                    class="lb-image"
                />
                <figcaption v-if="current?.filename || store.images.length > 1" class="lb-caption">
                    <span v-if="current?.filename">{{ current.filename }}</span>
                    <span v-if="store.images.length > 1" class="lb-counter">
                        {{ store.index + 1 }} / {{ store.images.length }}
                    </span>
                </figcaption>
            </figure>
            <button
                v-if="store.images.length > 1"
                type="button"
                class="lb-nav lb-next"
                :aria-label="$t('messages.lightboxNext')"
                @click="store.next"
            >
                <Icon icon="material-symbols:chevron-right-rounded" width="32" height="32" />
            </button>
            <button
                type="button"
                class="lb-close"
                :aria-label="$t('common.close')"
                @click="store.close"
            >
                <Icon icon="material-symbols:close-rounded" width="22" height="22" />
            </button>
        </div>
    </Teleport>
</template>

<style scoped>
.lb-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.86);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
    padding: 2rem;
}
.lb-frame {
    margin: 0;
    max-width: 100%;
    max-height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
}
.lb-image {
    max-width: min(92vw, 1400px);
    max-height: 82vh;
    object-fit: contain;
    border-radius: 4px;
    background: #000;
}
.lb-caption {
    color: #ddd;
    font-size: 0.78rem;
    display: flex;
    align-items: center;
    gap: 0.6rem;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
}
.lb-counter {
    background: rgba(255, 255, 255, 0.12);
    padding: 0 0.45rem;
    border-radius: 999px;
}
.lb-nav, .lb-close {
    background: rgba(255, 255, 255, 0.08);
    color: white;
    border: none;
    border-radius: 50%;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
}
.lb-nav { width: 44px; height: 44px; flex-shrink: 0; margin: 0 0.5rem; }
.lb-nav:hover { background: rgba(255, 255, 255, 0.18); }
.lb-close {
    position: absolute;
    top: 1rem;
    right: 1rem;
    width: 36px;
    height: 36px;
}
.lb-close:hover { background: rgba(255, 255, 255, 0.18); }
@media (max-width: 768px) {
    .lb-backdrop { padding: 0.5rem; }
    .lb-nav { width: 36px; height: 36px; }
}
</style>
