import { onBeforeUnmount, watch, type Ref } from 'vue';
import { useUnreadStore } from './stores/unreadStore';

export interface UnreadSyncChannel {
    id: string;
    /** Latest message marker (timestamp or snowflake). Used to detect
     *  unreads that arrived while the app was closed. `null` skips. */
    lastMarker?: string | null;
}

export function useUnreadSync(
    selectedChannelId: Ref<string | null>,
    channels: Ref<UnreadSyncChannel[]>,
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
        for (const c of channels.value) {
            unreadStore.registerScope(c.id, current);
            if (c.lastMarker) unreadStore.noteLatest(c.id, current, c.lastMarker);
        }
    }, { immediate: true });

    onBeforeUnmount(() => unreadStore.setCurrentChannel(null));
}
