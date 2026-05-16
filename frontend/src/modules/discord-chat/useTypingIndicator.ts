import { computed, onBeforeUnmount, ref, watch, type Ref } from 'vue';
import { useTypingStore } from './stores/typingStore';
import { useI18n } from 'vue-i18n';

export function useTypingIndicator(channelId: Ref<string | null>) {
    const { t: $t } = useI18n();
    const typingStore = useTypingStore();

    const typingNames = computed<string[]>(() => {
        if (!channelId.value) return [];
        return typingStore.activeIn(channelId.value).map(t => t.userName);
    });

    // `now` ticks every second while at least one typer is active so
    // `typingLabel` re-evaluates and stale typers fade out without
    // further server input. When nobody is typing the timer is idle —
    // it used to fire every second in every open conversation forever.
    const typingNow = ref(Date.now());
    let typingTicker: ReturnType<typeof setInterval> | null = null;
    function stopTicker(): void {
        if (typingTicker !== null) {
            clearInterval(typingTicker);
            typingTicker = null;
        }
    }
    watch(typingNames, (names) => {
        if (names.length > 0 && typingTicker === null) {
            typingTicker = setInterval(() => { typingNow.value = Date.now(); }, 1000);
        } else if (names.length === 0) {
            stopTicker();
        }
    }, { immediate: true });
    onBeforeUnmount(stopTicker);

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
