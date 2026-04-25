import { onBeforeUnmount } from 'vue';

export interface UseLongPressOptions {
    /** Hold duration before the action fires. Default 450 ms — matches
     *  the timer used by the chat conversation's message long-press. */
    ms?: number;
}

export interface LongPressInfo {
    /** Viewport-relative coordinates of the touch. Suitable for
     *  positioning a context menu via clientX/clientY semantics. */
    x: number;
    y: number;
    /** The element the touch started on. Captured at touchstart because
     *  `event.currentTarget` is null by the time the timer fires. */
    target: HTMLElement;
}

export interface LongPressBinding {
    start: (event: TouchEvent, action: (info: LongPressInfo) => void) => void;
    cancel: () => void;
}

/**
 * Touch long-press helper. Returns `start` (call from `@touchstart`) and
 * `cancel` (call from `@touchend` / `@touchmove` / `@touchcancel`).
 * `start` snapshots the touch coordinates and `currentTarget` synchronously
 * so the action closure can use them after the setTimeout — `event.currentTarget`
 * is reset to null once event handling completes.
 *
 * `contextmenu` events fire reliably on right-click but not on touch
 * (especially Safari on iOS). This helper supplies the missing path
 * for any sidebar row / chip / button that wants to surface a context
 * menu under both pointer and touch input.
 */
export function useLongPress(options: UseLongPressOptions = {}): LongPressBinding {
    const ms = options.ms ?? 450;
    let timer: ReturnType<typeof setTimeout> | null = null;

    function start(event: TouchEvent, action: (info: LongPressInfo) => void) {
        if (event.touches.length !== 1) return;
        const touch = event.touches[0];
        const target = event.currentTarget as HTMLElement | null;
        if (!target) return;
        const info: LongPressInfo = { x: touch.clientX, y: touch.clientY, target };
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
            timer = null;
            action(info);
        }, ms);
    }
    function cancel() {
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }
    }

    onBeforeUnmount(cancel);

    return { start, cancel };
}
