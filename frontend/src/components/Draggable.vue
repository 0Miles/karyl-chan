<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'

interface Props {
    /** 邊界元素（預設為父元素） */
    bounds?: HTMLElement | null
    /** 距離邊界的最小 padding（px） */
    boundaryPadding?: number
    /** 判定拖曳起始的位移門檻（px），避免誤判點擊 */
    dragThreshold?: number
    /** 是否啟用拖曳 */
    disabled?: boolean
}

const props = withDefaults(defineProps<Props>(), {
    bounds: null,
    boundaryPadding: 0,
    dragThreshold: 5,
    disabled: false,
})

const emit = defineEmits<{
    (e: 'dragStart'): void
    /** 拖曳放開的當下觸發（尚未完成 snap 回邊界） */
    (e: 'dragEnd'): void
    /** 位置穩定（含 snap 動畫結束）後觸發 */
    (e: 'positionSettled'): void
}>()

const rootRef = ref<HTMLElement | null>(null)
const dragX = ref(0)
const dragY = ref(0)
const isDragging = ref(false)
const isSnapping = ref(false)

let startPointerX = 0
let startPointerY = 0
let startDragX = 0
let startDragY = 0
let pointerId = -1
let hasStartedDrag = false

function resolveBoundsRect(): DOMRect | null {
    const boundsEl = props.bounds ?? rootRef.value?.parentElement
    return boundsEl ? boundsEl.getBoundingClientRect() : null
}

function onPointerDown(e: PointerEvent) {
    if (props.disabled || e.button !== 0 || !rootRef.value)
        return
    startPointerX = e.clientX
    startPointerY = e.clientY
    startDragX = dragX.value
    startDragY = dragY.value
    hasStartedDrag = false
    pointerId = e.pointerId
    isSnapping.value = false
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerUp)
}

function onPointerMove(e: PointerEvent) {
    if (e.pointerId !== pointerId)
        return
    const dx = e.clientX - startPointerX
    const dy = e.clientY - startPointerY
    if (!hasStartedDrag) {
        if (Math.hypot(dx, dy) < props.dragThreshold)
            return
        hasStartedDrag = true
        isDragging.value = true
        emit('dragStart')
    }
    dragX.value = startDragX + dx
    dragY.value = startDragY + dy
}

function onPointerUp(e: PointerEvent) {
    if (e.pointerId !== pointerId)
        return
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
    window.removeEventListener('pointercancel', onPointerUp)
    pointerId = -1

    if (!hasStartedDrag) {
        isDragging.value = false
        return
    }
    isDragging.value = false
    hasStartedDrag = false
    emit('dragEnd')

    // 攔截因拖曳結束觸發的 click，避免意外觸發按鈕動作
    const suppressClick = (clickE: Event) => {
        clickE.stopPropagation()
        clickE.preventDefault()
        window.removeEventListener('click', suppressClick, true)
    }
    window.addEventListener('click', suppressClick, true)
    // 保險：若 click 未如預期觸發，下一輪 tick 移除
    setTimeout(() => window.removeEventListener('click', suppressClick, true), 0)

    // 超出邊界時以 transition 漸變移回
    const el = rootRef.value
    const boundsRect = resolveBoundsRect()
    if (!el || !boundsRect)
        return
    const elRect = el.getBoundingClientRect()
    const pad = props.boundaryPadding
    let adjustX = 0
    let adjustY = 0
    if (elRect.left < boundsRect.left + pad)
        adjustX = (boundsRect.left + pad) - elRect.left
    else if (elRect.right > boundsRect.right - pad)
        adjustX = (boundsRect.right - pad) - elRect.right
    if (elRect.top < boundsRect.top + pad)
        adjustY = (boundsRect.top + pad) - elRect.top
    else if (elRect.bottom > boundsRect.bottom - pad)
        adjustY = (boundsRect.bottom - pad) - elRect.bottom

    if (adjustX || adjustY) {
        isSnapping.value = true
        dragX.value += adjustX
        dragY.value += adjustY
    }
    else {
        // 不需 snap：位置已穩定
        emit('positionSettled')
    }
}

function onTransitionEnd(e: TransitionEvent) {
    // 只處理 root 自身的 transform 過渡；避免子元素（如 AiStyleButton 的 outline）
    // 的 transform transition 冒泡後誤觸 positionSettled
    if (e.target !== rootRef.value)
        return
    if (e.propertyName === 'transform') {
        isSnapping.value = false
        emit('positionSettled')
    }
}

onBeforeUnmount(() => {
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
    window.removeEventListener('pointercancel', onPointerUp)
})
</script>

<template>
    <div
         ref="rootRef"
         class="draggable"
         :class="{ 'is-dragging': isDragging, 'is-snapping': isSnapping }"
         :style="{ transform: `translate(${dragX}px, ${dragY}px)` }"
         @pointerdown="onPointerDown"
         @transitionend="onTransitionEnd">
        <slot />
    </div>
</template>

<style scoped>
.draggable {
    touch-action: none;
    cursor: grab;
}

.draggable.is-dragging {
    cursor: grabbing;
    user-select: none;
}

.draggable.is-snapping {
    transition: transform 0.35s cubic-bezier(0.22, 0.61, 0.36, 1);
}
</style>