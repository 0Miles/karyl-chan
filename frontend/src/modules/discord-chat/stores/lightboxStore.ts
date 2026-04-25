import { defineStore } from 'pinia';
import { ref } from 'vue';

/**
 * Global image lightbox state. Any component (currently
 * MessageAttachment) can call `open(images, startIndex)` to surface
 * the overlay; the host (the app shell or each workspace) renders the
 * lightbox component once and reads from this store.
 *
 * Centralising the state means we don't need to thread sibling-
 * attachment lists through MessageView → MessageAttachment props just
 * to support arrow-key navigation between images in the same message.
 */

export interface LightboxImage {
    /** Image URL (proxyUrl preferred so the CDN handles caching). */
    url: string;
    /** Filename for the title; falls back to a counter if absent. */
    filename?: string;
    /** Discord-supplied dimensions, used to set an aspect-ratio
     *  placeholder so the layout doesn't reflow when the image
     *  decodes. */
    width?: number | null;
    height?: number | null;
}

export const useLightboxStore = defineStore('lightbox', () => {
    const images = ref<LightboxImage[]>([]);
    const index = ref(0);

    function open(list: LightboxImage[], startIndex = 0): void {
        if (list.length === 0) return;
        images.value = list;
        index.value = Math.max(0, Math.min(startIndex, list.length - 1));
    }

    function close(): void {
        images.value = [];
        index.value = 0;
    }

    function next(): void {
        if (images.value.length === 0) return;
        index.value = (index.value + 1) % images.value.length;
    }

    function prev(): void {
        if (images.value.length === 0) return;
        index.value = (index.value - 1 + images.value.length) % images.value.length;
    }

    return { images, index, open, close, next, prev };
});
