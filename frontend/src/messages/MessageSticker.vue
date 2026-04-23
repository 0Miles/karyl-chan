<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { MessageSticker } from './types';

const props = defineProps<{ sticker: MessageSticker }>();

const containerRef = ref<HTMLDivElement | null>(null);
let lottieAnim: { destroy: () => void } | null = null;

function imageUrl(): string {
    const ext = props.sticker.formatType === 4 ? 'gif' : 'png';
    return `https://cdn.discordapp.com/stickers/${props.sticker.id}.${ext}`;
}

async function loadLottie() {
    if (!containerRef.value) return;
    const lottie = (await import('lottie-web')).default;
    lottieAnim?.destroy();
    lottieAnim = lottie.loadAnimation({
        container: containerRef.value,
        renderer: 'svg',
        loop: true,
        autoplay: true,
        path: `https://cdn.discordapp.com/stickers/${props.sticker.id}.json`
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
