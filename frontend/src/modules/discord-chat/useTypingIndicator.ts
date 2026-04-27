import { computed, onBeforeUnmount, onMounted, ref, type Ref } from 'vue';
import { useTypingStore } from './stores/typingStore';
import { useI18n } from 'vue-i18n';

export function useTypingIndicator(channelId: Ref<string | null>) {
    const { t: $t } = useI18n();
    const typingStore = useTypingStore();

    const typingNames = computed<string[]>(() => {
        if (!channelId.value) return [];
        return typingStore.activeIn(channelId.value).map(t => t.userName);
    });

    // `now` ticks every second so activeIn is re-evaluated and stale
    // typers fade out without further server input.
    const typingNow = ref(Date.now());
    let typingTicker: ReturnType<typeof setInterval> | null = null;
    onMounted(() => { typingTicker = setInterval(() => { typingNow.value = Date.now(); }, 1000); });
    onBeforeUnmount(() => { if (typingTicker) clearInterval(typingTicker); });

    // Force computed re-eval by reading typingNow inside.
    const typingLabel = computed<string | null>(() => {
        void typingNow.value;
        const names = typingNames.value;
        if (names.length === 0) return null;
        if (names.length === 1) return $t('messages.typingOne', { name: names[0] });
        if (names.length === 2) return $t('messages.typingTwo', { a: names[0], b: names[1] });
        return $t('messages.typingMany', { name: names[0], count: names.length - 1 });
    });

    return { typingLabel };
}
