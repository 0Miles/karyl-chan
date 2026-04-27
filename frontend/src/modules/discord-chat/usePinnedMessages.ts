import { ref, watch, type Ref } from 'vue';
import type { Message } from '../../libs/messages/types';

type PinFetcher = (channelId: string) => Promise<Message[]>;

export function usePinnedMessages(opts: {
    channelId: Ref<string | null>;
    pinFetcher: Ref<PinFetcher | null | undefined>;
    emit: (event: 'jump-to-message', id: string) => void;
}) {
    const { channelId, pinFetcher, emit } = opts;

    const pinsOpen = ref(false);
    const pinsLoading = ref(false);
    const pinsError = ref<string | null>(null);
    const pinsList = ref<Message[]>([]);
    const pinsFetchedFor = ref<string | null>(null);

    async function loadPins() {
        if (!channelId.value || !pinFetcher.value) return;
        if (pinsFetchedFor.value === channelId.value) return;
        pinsLoading.value = true;
        pinsError.value = null;
        const id = channelId.value;
        try {
            const messages = await pinFetcher.value(id);
            // Guard against a stale response after the user already swapped
            // channels — without this we'd flash the previous channel's
            // pins for one frame.
            if (channelId.value !== id) return;
            pinsList.value = messages;
            pinsFetchedFor.value = id;
        } catch (err) {
            if (channelId.value !== id) return;
            pinsError.value = err instanceof Error ? err.message : 'Failed to load pins';
        } finally {
            pinsLoading.value = false;
        }
    }

    function togglePins() {
        pinsOpen.value = !pinsOpen.value;
        if (pinsOpen.value) void loadPins();
    }

    function onPinJump(messageId: string) {
        pinsOpen.value = false;
        emit('jump-to-message', messageId);
    }

    // New channel? Wipe the cache so the next pin-button click refetches.
    watch(channelId, () => {
        pinsOpen.value = false;
        pinsList.value = [];
        pinsError.value = null;
        pinsFetchedFor.value = null;
    });

    return { pinsOpen, pinsLoading, pinsError, pinsList, togglePins, onPinJump };
}
