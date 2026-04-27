import { nextTick, onBeforeUnmount, onMounted, watch, type ComponentPublicInstance, type Ref } from 'vue';
import { flashMessage } from '../../libs/messages/scroll-flash';
import { useMessageCacheStore, type ScrollPosition } from './stores/messageCacheStore';
import type { Message } from '../../libs/messages/types';

interface PendingRestore {
    channelId: string;
    position: ScrollPosition | null;
}

export function useScrollMemory(opts: {
    channelId: Ref<string | null>;
    messages: Ref<Message[]>;
    messagesContainer: Ref<HTMLElement | null>;
    scrollerRef: Ref<ComponentPublicInstance | null>;
    plainListRef: Ref<HTMLDivElement | null>;
    onScroll: () => void;
    onChannelSwitch: () => void;
}) {
    const { channelId, messages, messagesContainer, scrollerRef, plainListRef, onScroll, onChannelSwitch } = opts;
    const messageCache = useMessageCacheStore();
    let pendingRestore: PendingRestore | null = null;

    function scrollToBottom() {
        const el = messagesContainer.value;
        if (el) el.scrollTop = el.scrollHeight;
    }

    /**
     * DynamicScroller measures items lazily, so `scrollHeight` right after a
     * fresh render is often an under-estimate — a single `scrollTop = height`
     * lands mid-list instead of bottom. We set a value larger than the doc
     * can hold (browsers clamp to `scrollHeight`) and repeat across a few
     * frames so each measurement pass re-clamps us to the true end.
     */
    function scrollToBottomStable(maxFrames = 6): void {
        let frame = 0;
        const tick = () => {
            const el = messagesContainer.value;
            if (!el) return;
            el.scrollTop = Number.MAX_SAFE_INTEGER;
            frame++;
            if (frame < maxFrames) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    }

    /**
     * Try to land on the given message id. Returns `true` when the target
     * is already in the DOM and we scrolled to it; returns `false` when the
     * message is either out of the virtual-scroller's rendered window (in
     * which case we nudge it in via `scrollToItem` so the next render picks
     * it up) or not in the loaded batch at all.
     */
    function scrollToMessage(messageId: string): boolean {
        const el = messagesContainer.value;
        if (!el) return false;
        const msgEl = el.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(messageId)}"]`);
        if (msgEl) {
            msgEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            flashMessage(messageId);
            return true;
        }
        if (scrollerRef.value) {
            const idx = messages.value.findIndex(m => m.id === messageId);
            if (idx >= 0) {
                (scrollerRef.value as unknown as { scrollToItem?: (i: number) => void }).scrollToItem?.(idx);
            }
        }
        return false;
    }

    function isNearBottom(): boolean {
        const el = messagesContainer.value;
        if (!el) return true;
        return el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    }

    function capturePosition(): ScrollPosition | null {
        const el = messagesContainer.value;
        if (!el) return null;
        // Near-bottom → return null so restore defaults to bottom (keep following).
        if (el.scrollHeight - el.scrollTop - el.clientHeight < 80) return null;
        const containerTop = el.getBoundingClientRect().top;
        // Walk every rendered message; the first whose bottom is below the
        // container top is our topmost visible anchor. `querySelectorAll` returns
        // them in document order, which matches visual top-to-bottom.
        const items = el.querySelectorAll<HTMLElement>('[data-message-id]');
        for (const item of items) {
            const rect = item.getBoundingClientRect();
            if (rect.bottom > containerTop) {
                return {
                    messageId: item.dataset.messageId as string,
                    offset: rect.top - containerTop
                };
            }
        }
        return null;
    }

    /**
     * Apply a saved position. Plain list: find the element and align. Virtual
     * scroller: use `scrollToItem` to bring the anchor into the rendered window
     * first, then re-align once the browser has painted — item heights are only
     * measured after mount, so a single pass lands too early.
     */
    function applyRestore(restore: PendingRestore, attempt = 0): void {
        if (restore.channelId !== channelId.value) return;
        const el = messagesContainer.value;
        if (!el) return;
        const { position } = restore;
        if (!position) {
            scrollToBottomStable();
            return;
        }
        const msgEl = el.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(position.messageId)}"]`);
        if (msgEl) {
            const rect = msgEl.getBoundingClientRect();
            const containerRect = el.getBoundingClientRect();
            el.scrollTop += (rect.top - containerRect.top) - position.offset;
            // Virtual scroller re-measures after paint — one follow-up lands precisely.
            if (attempt < 2) {
                requestAnimationFrame(() => applyRestore(restore, attempt + 1));
            }
            return;
        }
        // Anchor not rendered yet (virtual scroller window). Nudge it in and retry.
        if (scrollerRef.value) {
            const idx = messages.value.findIndex(m => m.id === position.messageId);
            if (idx >= 0) {
                (scrollerRef.value as unknown as { scrollToItem?: (i: number) => void }).scrollToItem?.(idx);
            }
            if (attempt < 10) requestAnimationFrame(() => applyRestore(restore, attempt + 1));
        }
    }

    // flush: 'sync' ensures we read the old DOM before Vue swaps it for the new
    // channel's render. Default 'pre' would also work but sync is defensive.
    watch(channelId, (newId, oldId) => {
        if (oldId) messageCache.saveScrollPosition(oldId, capturePosition());
        onChannelSwitch();
        pendingRestore = newId
            ? { channelId: newId, position: messageCache.getScrollPosition(newId) }
            : null;
    }, { flush: 'sync' });

    // Apply the queued restore once the new channel's messages land in the DOM.
    // Fires both on channel switch (reference change) and on new-message arrival;
    // the `pendingRestore` guard ensures we only replay the first time.
    watch(messages, () => {
        const restore = pendingRestore;
        if (!restore || restore.channelId !== channelId.value || messages.value.length === 0) return;
        pendingRestore = null;
        nextTick().then(() => applyRestore(restore));
    });

    watch([scrollerRef, plainListRef], ([scroller, plain], _prev, onCleanup) => {
        const el = (scroller ? (scroller.$el as HTMLElement) : plain) ?? null;
        messagesContainer.value = el;
        if (!el) return;
        el.addEventListener('scroll', onScroll, { passive: true });
        onCleanup(() => el.removeEventListener('scroll', onScroll));
    }, { immediate: true });

    onMounted(() => {
        // Initial mount: seed a pendingRestore for the current channel so either
        // the messages watcher (async arrival) or a direct applyRestore here
        // (messages already cached) puts the user back where they left off.
        if (!channelId.value) {
            scrollToBottom();
            return;
        }
        pendingRestore = {
            channelId: channelId.value,
            position: messageCache.getScrollPosition(channelId.value)
        };
        if (messages.value.length > 0) {
            const restore = pendingRestore;
            pendingRestore = null;
            nextTick().then(() => applyRestore(restore));
        }
    });

    onBeforeUnmount(() => {
        // Component tear-down (e.g., navigating away) — capture one last time so
        // returning to this route finds the user where they left off.
        if (channelId.value) {
            messageCache.saveScrollPosition(channelId.value, capturePosition());
        }
    });

    return {
        scrollToBottom,
        scrollToBottomStable,
        scrollToMessage,
        isNearBottom,
        capturePosition,
        applyRestore,
    };
}
