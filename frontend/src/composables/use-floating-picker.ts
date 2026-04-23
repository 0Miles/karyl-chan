import { onUnmounted, ref, watch } from 'vue'

export interface FloatingPickerPosition {
    top: number
    left: number
}

/**
 * Tracks a single floating popup keyed by an id (e.g. message id) and computes
 * an anchored fixed position from the trigger button's bounding rect, clamped
 * into the viewport. Click-outside closes the popup; the consumer renders the
 * popup with a `data-floating-picker` attribute so the outside-click matcher
 * can identify it.
 */
export function useFloatingPicker(opts: { width: number; height: number }) {
    const openId = ref<string | null>(null)
    const position = ref<FloatingPickerPosition | null>(null)

    function close() {
        openId.value = null
        position.value = null
    }

    function openAt(id: string, event: MouseEvent) {
        if (openId.value === id) { close(); return }
        const target = event.currentTarget as HTMLElement | null
        const rect = target?.getBoundingClientRect()
        if (!rect) {
            openId.value = id
            return
        }
        let top = rect.bottom + 4
        if (top + opts.height > window.innerHeight - 8) top = Math.max(8, rect.top - opts.height - 4)
        let left = rect.right - opts.width
        if (left < 8) left = 8
        if (left + opts.width > window.innerWidth - 8) left = window.innerWidth - opts.width - 8
        position.value = { top, left }
        openId.value = id
    }

    function onOutsideClick(event: MouseEvent) {
        if (!openId.value) return
        const target = event.target as Node | null
        if (!target) return
        const popup = document.querySelector('[data-floating-picker]')
        if (popup?.contains(target)) return
        close()
    }

    watch(openId, (val) => {
        if (val) document.addEventListener('mousedown', onOutsideClick)
        else document.removeEventListener('mousedown', onOutsideClick)
    })

    onUnmounted(() => {
        document.removeEventListener('mousedown', onOutsideClick)
    })

    return { openId, position, openAt, close }
}
