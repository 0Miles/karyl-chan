import { onBeforeUnmount, watch, type Ref } from 'vue';
import { useUnreadStore } from './stores/unreadStore';

interface ChannelIdentifier { id: string }

export function useUnreadSync(
    selectedChannelId: Ref<string | null>,
    channels: Ref<ChannelIdentifier[]>,
    mode: Ref<string | null> | string,
): void {
    const unreadStore = useUnreadStore();
    const resolveMode = typeof mode === 'string' ? () => mode : () => mode.value;

    watch(selectedChannelId, (id) => {
        const current = resolveMode();
        unreadStore.setCurrentChannel(id);
        if (id && current) unreadStore.registerScope(id, current);
    }, { immediate: true });

    const sources = typeof mode === 'string'
        ? (channels as Ref<unknown>)
        : ([channels, mode] as const);
    watch(sources, () => {
        const current = resolveMode();
        if (!current) return;
        for (const c of channels.value) unreadStore.registerScope(c.id, current);
    }, { immediate: true });

    onBeforeUnmount(() => unreadStore.setCurrentChannel(null));
}
