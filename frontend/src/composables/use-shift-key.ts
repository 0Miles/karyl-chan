import { onMounted, onUnmounted, ref } from 'vue'

export function useShiftKey() {
    const held = ref(false)
    function track(event: KeyboardEvent) { held.value = event.shiftKey }
    function release() { held.value = false }
    onMounted(() => {
        document.addEventListener('keydown', track)
        document.addEventListener('keyup', track)
        window.addEventListener('blur', release)
    })
    onUnmounted(() => {
        document.removeEventListener('keydown', track)
        document.removeEventListener('keyup', track)
        window.removeEventListener('blur', release)
    })
    return held
}
