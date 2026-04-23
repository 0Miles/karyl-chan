import { onBeforeUnmount, watch, type Ref } from 'vue';
import { useEscapeStack } from './use-escape-stack';

export type DrawerPlacement = 'bottom' | 'top' | 'left' | 'right';

export interface UseDrawerOptions {
    /** Reactive flag controlling the drawer's mounted/open state. */
    visible: Ref<boolean>;
    /** Edge the panel is anchored to and slides in from. Default: 'bottom'. */
    placement?: DrawerPlacement;
    /** Called when the user dismisses the drawer (backdrop click / Escape). */
    onClose?: () => void;
    /** Escape closes the drawer. Default: true. */
    closeOnEscape?: boolean;
}

export interface UseDrawerReturn {
    placement: DrawerPlacement;
    backdropClass: string;
    panelClass: string;
    backdropTransition: string;
    panelTransition: string;
    close: () => void;
}

let styleInjected = false;

// Shared drawer styles. Backdrop + panel anchoring + slide/fade transitions only.
// Per-drawer sizing/chrome (radius, max-width, padding) belongs in the caller.
const DRAWER_CSS = `
.drawer-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    z-index: 1000;
}
.drawer-panel {
    position: fixed;
    z-index: 1001;
    display: flex;
    flex-direction: column;
    background: var(--bg-surface);
    overflow: hidden;
}
.drawer-panel[data-placement="bottom"] { bottom: 0; left: 0; right: 0; }
.drawer-panel[data-placement="top"] { top: 0; left: 0; right: 0; }
.drawer-panel[data-placement="left"] { top: 0; bottom: 0; left: 0; }
.drawer-panel[data-placement="right"] { top: 0; bottom: 0; right: 0; }

.drawer-fade-enter-active,
.drawer-fade-leave-active { transition: opacity 0.2s; }
.drawer-fade-enter-from,
.drawer-fade-leave-to { opacity: 0; }

.drawer-slide-bottom-enter-active,
.drawer-slide-bottom-leave-active,
.drawer-slide-top-enter-active,
.drawer-slide-top-leave-active,
.drawer-slide-left-enter-active,
.drawer-slide-left-leave-active,
.drawer-slide-right-enter-active,
.drawer-slide-right-leave-active { transition: transform 0.22s cubic-bezier(0.4, 0, 0.2, 1); }
.drawer-slide-bottom-enter-from,
.drawer-slide-bottom-leave-to { transform: translateY(100%); }
.drawer-slide-top-enter-from,
.drawer-slide-top-leave-to { transform: translateY(-100%); }
.drawer-slide-left-enter-from,
.drawer-slide-left-leave-to { transform: translateX(-100%); }
.drawer-slide-right-enter-from,
.drawer-slide-right-leave-to { transform: translateX(100%); }
`.trim();

function ensureDrawerStyle() {
    if (styleInjected || typeof document === 'undefined') return;
    styleInjected = true;
    const s = document.createElement('style');
    s.textContent = DRAWER_CSS;
    document.head.appendChild(s);
}

/**
 * Generic drawer behavior: escape-stack registration, placement-driven
 * transition class names, and shared backdrop/panel styles. The caller
 * owns the Teleport + <Transition> + DOM, so drawers can live inline
 * without a one-size-fits-all wrapper component.
 */
export function useDrawer(options: UseDrawerOptions): UseDrawerReturn {
    ensureDrawerStyle();

    const placement: DrawerPlacement = options.placement ?? 'bottom';
    const closeOnEscape = options.closeOnEscape !== false;
    const { register, unregister } = useEscapeStack();

    const close = () => options.onClose?.();

    watch(options.visible, (v) => {
        if (v) register(closeOnEscape ? close : null);
        else unregister();
    }, { immediate: true });

    onBeforeUnmount(unregister);

    return {
        placement,
        backdropClass: 'drawer-backdrop',
        panelClass: 'drawer-panel',
        backdropTransition: 'drawer-fade',
        panelTransition: `drawer-slide-${placement}`,
        close
    };
}
