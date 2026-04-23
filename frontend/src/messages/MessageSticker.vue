<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { authedFetch } from '../api/client';
import { stickerImageUrl } from './sticker-url';
import type { MessageSticker } from './types';

const props = defineProps<{ sticker: MessageSticker }>();

const containerRef = ref<HTMLDivElement | null>(null);
let lottieAnim: { destroy: () => void } | null = null;

function imageUrl(): string {
    return stickerImageUrl(props.sticker.id, props.sticker.formatType);
}

async function loadLottie() {
    if (!containerRef.value) return;
    // cdn.discordapp.com doesn't send CORS headers for Lottie JSON, so go
    // through our backend proxy at /api/dm/stickers/:id and hand the parsed
    // animationData to lottie.loadAnimation.
    const response = await authedFetch(`/api/dm/stickers/${encodeURIComponent(props.sticker.id)}`);
    if (!response.ok) return;
    const animationData = await response.json();
    const lottie = (await import('lottie-web')).default;
    lottieAnim?.destroy();
    if (!containerRef.value) return;
    lottieAnim = lottie.loadAnimation({
        container: containerRef.value,
        renderer: 'svg',
        loop: true,
        autoplay: true,
        animationData
    });
}

onMounted(() => {
    if (props.sticker.formatType === 3) loadLottie();
});

watch(() => props.sticker.id, (id, prev) => {
    if (id !== prev && props.sticker.formatType === 3) loadLottie();
});

onBeforeUnmount(() => {
    lottieAnim?.destroy();
});
</script>

<template>
    <div class="sticker" :title="sticker.name">
        <div v-if="sticker.formatType === 3" ref="containerRef" class="lottie" />
        <img v-else :src="imageUrl()" :alt="sticker.name" class="image" loading="lazy" />
    </div>
</template>

<style scoped>
.sticker {
    margin-top: 0.4rem;
    width: 160px;
    height: 160px;
}
.lottie,
.image {
    width: 100%;
    height: 100%;
    object-fit: contain;
}
</style>
