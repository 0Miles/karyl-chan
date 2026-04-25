<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useMessageContext } from './context';
import type { MessageSticker } from './types';

const props = defineProps<{ sticker: MessageSticker }>();
const ctx = useMessageContext();

const containerRef = ref<HTMLDivElement | null>(null);
let lottieAnim: { destroy: () => void } | null = null;

function imageUrl(): string {
    return ctx.mediaProvider?.stickerUrl({ id: props.sticker.id, formatType: props.sticker.formatType }) ?? '';
}

async function loadLottie() {
    if (!containerRef.value) return;
    // Lottie JSON has to go through whatever fetcher the host app supplies
    // (Discord's CDN doesn't send CORS headers, so the consumer typically
    // proxies it server-side). Skip Lottie when no provider is wired.
    const animationData = await ctx.mediaProvider?.loadLottieSticker(props.sticker.id);
    if (!animationData || !containerRef.value) return;
    // Use the `_light` build so the bundle doesn't pull in lottie's
    // expressions evaluator — the only piece of lottie-web that uses
    // `new Function`. Dropping it lets the server CSP remove
    // `unsafe-eval` from script-src. Discord stickers don't ship
    // expressions so the visible output is identical.
    const lottie = (await import('lottie-web/build/player/lottie_light')).default;
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
