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


/**
 * Generic drawer behavior: escape-stack registration, placement-driven
 * transition class names, and shared backdrop/panel styles. The caller
 * owns the Teleport + <Transition> + DOM, so drawers can live inline
 * without a one-size-fits-all wrapper component.
 */
export function useDrawer(options: UseDrawerOptions): UseDrawerReturn {
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
