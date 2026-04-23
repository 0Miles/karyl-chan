import { onBeforeUnmount, ref } from 'vue';

const MOBILE_QUERY = '(max-width: 768px)';

export function useBreakpoint() {
    const mq = window.matchMedia(MOBILE_QUERY);
    const isMobile = ref(mq.matches);
    const update = (e: MediaQueryListEvent) => {
        isMobile.value = e.matches;
    };
    mq.addEventListener('change', update);
    onBeforeUnmount(() => mq.removeEventListener('change', update));
    return { isMobile };
}
