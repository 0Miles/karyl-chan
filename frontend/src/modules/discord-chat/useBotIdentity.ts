import { computed, onMounted } from 'vue';
import { useBotStore } from './stores/botStore';

export function useBotIdentity() {
    const botStore = useBotStore();

    onMounted(() => botStore.init());

    return {
        botUserId: computed(() => botStore.userId),
        botUserTag: computed(() => botStore.userTag),
        displayName: () => botStore.displayName(),
    };
}
