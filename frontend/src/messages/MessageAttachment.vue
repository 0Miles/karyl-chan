<script setup lang="ts">
import { computed } from 'vue';
import { useMessageContext } from './context';
import type { MessageAttachment } from './types';

const props = defineProps<{ attachment: MessageAttachment }>();

const ctx = useMessageContext();

const kind = computed<'image' | 'video' | 'audio' | 'file'>(() => {
    const ct = props.attachment.contentType ?? '';
    if (ct.startsWith('image/')) return 'image';
    if (ct.startsWith('video/')) return 'video';
    if (ct.startsWith('audio/')) return 'audio';
    return 'file';
});

const sizeLabel = computed(() => {
    const bytes = props.attachment.size;
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
});

function open() {
    ctx.onAttachmentOpen?.(props.attachment.id);
}
</script>

<template>
    <div class="attachment" :data-kind="kind">
        <img
            v-if="kind === 'image'"
            :src="attachment.proxyUrl ?? attachment.url"
            :alt="attachment.description ?? attachment.filename"
            :width="attachment.width ?? undefined"
            :height="attachment.height ?? undefined"
            class="image"
            loading="lazy"
            @click="open"
        />
        <video v-else-if="kind === 'video'" :src="attachment.url" controls preload="metadata" class="video" />
        <audio v-else-if="kind === 'audio'" :src="attachment.url" controls class="audio" />
        <a v-else :href="attachment.url" target="_blank" rel="noopener noreferrer" class="file">
            <span class="filename">{{ attachment.filename }}</span>
            <span class="size">{{ sizeLabel }}</span>
        </a>
    </div>
</template>

<style scoped>
.attachment {
    margin-top: 0.4rem;
    max-width: 100%;
}
.image {
    max-width: min(360px, 100%);
    max-height: 360px;
    border-radius: 6px;
    cursor: zoom-in;
    display: block;
}
.video {
    max-width: min(420px, 100%);
    max-height: 320px;
    border-radius: 6px;
}
.audio {
    width: 320px;
    max-width: 100%;
}
.file {
    display: inline-flex;
    flex-direction: column;
    padding: 0.5rem 0.75rem;
    border: 1px solid var(--border);
    border-radius: 6px;
    text-decoration: none;
    color: var(--text);
    background: var(--bg-surface-2);
}
.filename {
    font-weight: 500;
}
.size {
    font-size: 0.8rem;
    color: var(--text-muted);
}
</style>
