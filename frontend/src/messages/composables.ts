import { onMounted, onUnmounted, ref, watch } from 'vue';

export function useShiftKey() {
    const held = ref(false);
    function track(event: KeyboardEvent) { held.value = event.shiftKey; }
    function release() { held.value = false; }
    onMounted(() => {
        document.addEventListener('keydown', track);
        document.addEventListener('keyup', track);
        window.addEventListener('blur', release);
    });
    onUnmounted(() => {
        document.removeEventListener('keydown', track);
        document.removeEventListener('keyup', track);
        window.removeEventListener('blur', release);
    });
    return held;
}

export interface FileDropHandlers {
    isDragging: ReturnType<typeof ref<boolean>>;
    onDragEnter: (event: DragEvent) => void;
    onDragOver: (event: DragEvent) => void;
    onDragLeave: () => void;
    onDrop: (event: DragEvent) => void;
}

export function useFileDrop(onFiles: (files: File[]) => void): FileDropHandlers {
    const isDragging = ref(false);
    let counter = 0;

    function isFileDrag(event: DragEvent): boolean {
        const types = event.dataTransfer?.types;
        if (!types) return false;
        for (let i = 0; i < types.length; i++) if (types[i] === 'Files') return true;
        return false;
    }

    return {
        isDragging,
        onDragEnter(event) {
            if (!isFileDrag(event)) return;
            event.preventDefault();
            counter++;
            isDragging.value = true;
        },
        onDragOver(event) {
            if (!isFileDrag(event)) return;
            event.preventDefault();
        },
        onDragLeave() {
            counter = Math.max(0, counter - 1);
            if (counter === 0) isDragging.value = false;
        },
        onDrop(event) {
            event.preventDefault();
            counter = 0;
            isDragging.value = false;
            const files = event.dataTransfer?.files;
            if (!files || files.length === 0) return;
            onFiles(Array.from(files));
        }
    };
}

export interface FloatingPickerPosition {
    top: number;
    left: number;
}

export function useFloatingPicker(opts: { width: number; height: number }) {
    const openId = ref<string | null>(null);
    const position = ref<FloatingPickerPosition | null>(null);

    function close() {
        openId.value = null;
        position.value = null;
    }

    function openAt(id: string, event: MouseEvent) {
        if (openId.value === id) { close(); return; }
        const target = event.currentTarget as HTMLElement | null;
        const rect = target?.getBoundingClientRect();
        if (!rect) {
            openId.value = id;
            return;
        }
        let top = rect.bottom + 4;
        if (top + opts.height > window.innerHeight - 8) top = Math.max(8, rect.top - opts.height - 4);
        let left = rect.right - opts.width;
        if (left < 8) left = 8;
        if (left + opts.width > window.innerWidth - 8) left = window.innerWidth - opts.width - 8;
        position.value = { top, left };
        openId.value = id;
    }

    function onOutsideClick(event: MouseEvent) {
        if (!openId.value) return;
        const target = event.target as Node | null;
        if (!target) return;
        const popup = document.querySelector('[data-floating-picker]');
        if (popup?.contains(target)) return;
        close();
    }

    watch(openId, (val) => {
        if (val) document.addEventListener('mousedown', onOutsideClick);
        else document.removeEventListener('mousedown', onOutsideClick);
    });

    onUnmounted(() => {
        document.removeEventListener('mousedown', onOutsideClick);
    });

    return { openId, position, openAt, close };
}

export function useAutoFill(opts: { container: () => HTMLElement | null; fetchOlder: () => Promise<void> | void; hasMore: () => boolean; loading: () => boolean }) {
    async function fill() {
        const el = opts.container();
        if (!el) return;
        if (el.scrollHeight <= el.clientHeight && opts.hasMore() && !opts.loading()) {
            await opts.fetchOlder();
        }
    }
    return { fill };
}
