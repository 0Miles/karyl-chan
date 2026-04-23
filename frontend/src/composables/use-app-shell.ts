import { computed, inject, onBeforeUnmount, provide, ref, type InjectionKey, type Ref } from 'vue';

type OverlayView = 'nav' | 'extras';

interface AppShellContext {
    overlayOpen: Ref<boolean>;
    openOverlay(): void;
    closeOverlay(): void;
    flushMain: Ref<boolean>;
    setFlushMain(value: boolean): void;
    hasExtras: Ref<boolean>;
    overlayView: Ref<OverlayView>;
    toggleOverlayView(): void;
    registerExtras(): void;
    unregisterExtras(): void;
}

const key: InjectionKey<AppShellContext> = Symbol('app-shell');

export function provideAppShell(): AppShellContext {
    const overlayOpen = ref(false);
    const flushMain = ref(false);
    const extrasCount = ref(0);
    const hasExtras = computed(() => extrasCount.value > 0);
    const overlayView = ref<OverlayView>('nav');

    const ctx: AppShellContext = {
        overlayOpen,
        openOverlay: () => {
            overlayOpen.value = true;
            overlayView.value = hasExtras.value ? 'extras' : 'nav';
        },
        closeOverlay: () => { overlayOpen.value = false; },
        flushMain,
        setFlushMain: (v: boolean) => { flushMain.value = v; },
        hasExtras,
        overlayView,
        toggleOverlayView: () => {
            overlayView.value = overlayView.value === 'nav' ? 'extras' : 'nav';
        },
        registerExtras: () => { extrasCount.value++; },
        unregisterExtras: () => { extrasCount.value = Math.max(0, extrasCount.value - 1); }
    };

    provide(key, ctx);
    return ctx;
}

export function useAppShell(): AppShellContext {
    const ctx = inject(key);
    if (!ctx) throw new Error('useAppShell must be called within App shell');
    return ctx;
}

export function useFlushMain(): void {
    const { setFlushMain } = useAppShell();
    setFlushMain(true);
    onBeforeUnmount(() => setFlushMain(false));
}

export function useOverlayExtras(): void {
    const { registerExtras, unregisterExtras } = useAppShell();
    registerExtras();
    onBeforeUnmount(unregisterExtras);
}
