import { createPopper } from '@popperjs/core'
import type {
    Instance as PopperInstance,
    Options as PopperOptions,
    Placement,
    VirtualElement,
    Modifier,
    State,
} from '@popperjs/core'
import { ref, watch, onMounted, onBeforeUnmount, type Ref, unref, type MaybeRef } from 'vue'

import { useClickOutsideStack } from './use-click-outside-stack'
import { useEscapeStack } from './use-escape-stack'

export type TriggerType = 'click' | 'hover' | 'focus' | 'manual' | 'contextmenu'

export interface PopoverOptions {
    placement?: Placement
    trigger?: TriggerType | TriggerType[]
    showDelay?: number
    hideDelay?: number
    /** [skidding, distance] */
    offset?: [number, number]
    arrow?: boolean | HTMLElement
    arrowPadding?: number
    flip?: boolean
    fallbackPlacements?: Placement[]
    boundary?: HTMLElement | 'clippingParents' | 'viewport'
    strategy?: 'fixed' | 'absolute'
    preventOverflow?: boolean
    overflowPadding?: number
    gpuAcceleration?: boolean
    /** 與觸發元素同寬 */
    sameWidth?: boolean
    zIndex?: number
    onShow?: () => void
    onHide?: () => void
    onFirstUpdate?: (state: State) => void
    disabled?: boolean
    teleportTo?: string | HTMLElement
    closeOnContentClick?: boolean
    /** 由 usePopover composable 統一管理，raw createPopover 不處理此選項 */
    closeOnClickOutside?: boolean
    /** 由 usePopover composable 統一管理，raw createPopover 不處理此選項 */
    closeOnEscape?: boolean
    hideOnScroll?: boolean
    /** false 禁用, true 使用預設名稱 'popover', string 自定義名稱 */
    transition?: boolean | string
    /** 作為 transitionend 事件的備用超時 (ms) */
    transitionDuration?: number
    onBeforeShow?: () => void
    onAfterShow?: () => void
    onBeforeHide?: () => void
    onAfterHide?: () => void
}

export interface PopoverInstance {
    popper: PopperInstance | null
    show: () => void
    hide: () => void
    toggle: () => void
    update: () => Promise<Partial<State>> | void
    forceUpdate: () => void
    setOptions: (options: Partial<PopoverOptions>) => void
    updateReference: (newReference: HTMLElement | VirtualElement) => void
    destroy: () => void
    isVisible: () => boolean
    /** 含過渡動畫期間，動畫結束後才變 false */
    isContentVisible: () => boolean
    getPlacement: () => Placement | undefined
}

export interface UsePopoverOptions extends PopoverOptions {
    visible?: Ref<boolean>
}

export interface UsePopoverReturn {
    instance: Ref<PopoverInstance | null>
    /** 意圖狀態，hide 時立即變 false */
    isVisible: Ref<boolean>
    /** 含過渡動畫期間，動畫結束後才變 false */
    isContentVisible: Ref<boolean>
    show: () => void
    hide: () => void
    toggle: () => void
    update: () => void
}

// Enter 動畫期間抑制子元素 CSS transition + 注入 placement keyframes / classes。
// 於首次 createPopover 時注入到 document.head。
let popoverStyleInjected = false

const PLACEMENT_ANIM_CSS = `
[data-popover-entering] *{transition:none!important}
@keyframes popoverSlideDownAndFade{
    from{opacity:0;transform:translateY(-10px)}
    to{opacity:1;transform:translateY(0)}
}
@keyframes popoverSlideUpAndFade{
    from{opacity:0;transform:translateY(10px)}
    to{opacity:1;transform:translateY(0)}
}
@keyframes popoverSlideLeftAndFade{
    from{opacity:0;transform:translateX(10px)}
    to{opacity:1;transform:translateY(0)}
}
@keyframes popoverSlideRightAndFade{
    from{opacity:0;transform:translateX(-10px)}
    to{opacity:1;transform:translateY(0)}
}
.popover-anim-down-normal{animation:popoverSlideDownAndFade .2s ease 0s 1 normal both}
.popover-anim-down-reverse{animation:popoverSlideDownAndFade .2s ease 0s 1 reverse both}
.popover-anim-up-normal{animation:popoverSlideUpAndFade .2s ease 0s 1 normal both}
.popover-anim-up-reverse{animation:popoverSlideUpAndFade .2s ease 0s 1 reverse both}
.popover-anim-left-normal{animation:popoverSlideLeftAndFade .2s ease 0s 1 normal both}
.popover-anim-left-reverse{animation:popoverSlideLeftAndFade .2s ease 0s 1 reverse both}
.popover-anim-right-normal{animation:popoverSlideRightAndFade .2s ease 0s 1 normal both}
.popover-anim-right-reverse{animation:popoverSlideRightAndFade .2s ease 0s 1 reverse both}
`.trim()

function ensurePopoverStyle() {
    if (popoverStyleInjected || typeof document === 'undefined') return
    popoverStyleInjected = true
    const s = document.createElement('style')
    s.textContent = PLACEMENT_ANIM_CSS
    document.head.appendChild(s)
}

const PLACEMENT_ANIM_DIR: Record<string, 'down' | 'up' | 'left' | 'right'> = {
    top: 'up',
    bottom: 'down',
    left: 'left',
    right: 'right',
}

function getPlacementAnimClass(placement: string, reverse: boolean): string {
    const dir = placement.split('-')[0]
    const cssDir = PLACEMENT_ANIM_DIR[dir] ?? 'down'
    const direction = reverse ? 'reverse' : 'normal'
    return `popover-anim-${cssDir}-${direction}`
}

export const PLACEMENTS: Placement[] = [
    'top',
    'top-start',
    'top-end',
    'bottom',
    'bottom-start',
    'bottom-end',
    'left',
    'left-start',
    'left-end',
    'right',
    'right-start',
    'right-end',
    'auto',
    'auto-start',
    'auto-end',
]

const DEFAULT_OPTIONS: Required<
    Pick<
        PopoverOptions,
        | 'placement'
        | 'trigger'
        | 'showDelay'
        | 'hideDelay'
        | 'offset'
        | 'arrow'
        | 'arrowPadding'
        | 'flip'
        | 'strategy'
        | 'preventOverflow'
        | 'overflowPadding'
        | 'gpuAcceleration'
        | 'sameWidth'
        | 'closeOnContentClick'
        | 'hideOnScroll'
        | 'transition'
    >
> = {
    placement: 'bottom',
    trigger: 'click',
    showDelay: 0,
    hideDelay: 0,
    offset: [0, 8],
    arrow: false,
    arrowPadding: 4,
    flip: true,
    strategy: 'absolute',
    preventOverflow: true,
    overflowPadding: 8,
    gpuAcceleration: true,
    sameWidth: false,
    closeOnContentClick: false,
    hideOnScroll: false,
    transition: true,
}

export function createVirtualElement(x: number, y: number): VirtualElement {
    return {
        getBoundingClientRect: () => ({
            width: 0,
            height: 0,
            top: y,
            right: x,
            bottom: y,
            left: x,
            x,
            y,
            toJSON: () => ({}),
        }),
    }
}

export function createVirtualElementFromEvent(event: MouseEvent): VirtualElement {
    return createVirtualElement(event.clientX, event.clientY)
}

export function getScrollParent(element: HTMLElement): HTMLElement | Window {
    if (!element) return window

    const overflowRegex = /(auto|scroll)/
    const { position } = getComputedStyle(element)

    if (position === 'fixed') return window

    let parent: HTMLElement | null = element.parentElement

    while (parent) {
        const style = getComputedStyle(parent)
        const { overflow, overflowX, overflowY } = style

        if (overflowRegex.test(overflow + overflowY + overflowX)) {
            return parent
        }
        parent = parent.parentElement
    }

    return window
}

export function getScrollParents(element: HTMLElement): (HTMLElement | Window)[] {
    const scrollParents: (HTMLElement | Window)[] = []
    let current: HTMLElement | null = element

    while (current) {
        const scrollParent = getScrollParent(current)
        if (scrollParent === window) {
            scrollParents.push(window)
            break
        }
        scrollParents.push(scrollParent as HTMLElement)
        current = scrollParent as HTMLElement
    }

    return scrollParents
}

function createSameWidthModifier(): Modifier<'sameWidth', object> {
    return {
        name: 'sameWidth',
        enabled: true,
        phase: 'beforeWrite',
        requires: ['computeStyles'],
        fn({ state }) {
            state.styles.popper.width = `${state.rects.reference.width}px`
        },
        effect({ state }) {
            // effect 階段 rects 尚未計算，直接從 DOM 元素讀取寬度
            const refWidth = (state.elements.reference as HTMLElement).getBoundingClientRect().width
            state.elements.popper.style.width = `${refWidth}px`
        },
    }
}

/**
 * 創建 z-index 修飾器
 */
function createZIndexModifier(zIndex: number): Modifier<'zIndex', object> {
    return {
        name: 'zIndex',
        enabled: true,
        phase: 'write',
        fn({ state }) {
            state.elements.popper.style.zIndex = String(zIndex)
        },
    }
}

/**
 * 創建 GPU 加速修飾器
 */
function createGpuAccelerationModifier(enabled: boolean): Partial<Modifier<'computeStyles', { gpuAcceleration: boolean }>> {
    return {
        name: 'computeStyles',
        options: {
            gpuAcceleration: enabled,
        },
    }
}

/**
 * 修正箭頭跨軸定位：Popper.js 的 arrow modifier 只設定主軸（沿邊緣置中），
 * 跨軸（箭頭在哪條邊）完全依賴外部 CSS。為避免 CSS 規則未生效或被覆蓋
 * 導致箭頭跑到錯誤的位置，此 modifier 直接透過 inline style 設定跨軸定位。
 */
function createArrowPositionFixModifier(): Modifier<'arrowPositionFix', object> {
    return {
        name: 'arrowPositionFix',
        enabled: true,
        phase: 'afterWrite',
        requires: ['arrow'],
        fn({ state }) {
            const arrow = state.elements.arrow
            if (!arrow) return

            const basePlacement = state.placement.split('-')[0]
            const arrowHalfH = arrow.offsetHeight / 2
            const arrowHalfW = arrow.offsetWidth / 2

            // 清除所有跨軸方向，再設定正確的那一個
            arrow.style.top = ''
            arrow.style.bottom = ''
            arrow.style.left = ''
            arrow.style.right = ''

            switch (basePlacement) {
                case 'top':
                    arrow.style.bottom = `${-arrowHalfH}px`
                    break
                case 'bottom':
                    arrow.style.top = `${-arrowHalfH}px`
                    break
                case 'left':
                    arrow.style.right = `${-arrowHalfW}px`
                    break
                case 'right':
                    arrow.style.left = `${-arrowHalfW}px`
                    break
            }

            // 還原 Popper 計算的主軸定位
            const arrowData = state.modifiersData.arrow
            if (arrowData) {
                if (basePlacement === 'top' || basePlacement === 'bottom') {
                    arrow.style.left = arrowData.x != null ? `${arrowData.x}px` : ''
                } else {
                    arrow.style.top = arrowData.y != null ? `${arrowData.y}px` : ''
                }
            }
        },
    }
}

/**
 * 創建 Popover 實例
 *
 * @param reference - 觸發元素
 * @param content - 彈出層內容元素
 * @param options - 配置選項
 * @returns PopoverInstance
 *
 * @example
 * ```ts
 * const popover = createPopover(buttonEl, tooltipEl, {
 *   placement: 'top',
 *   trigger: 'hover',
 *   showDelay: 100,
 *   hideDelay: 200,
 * })
 *
 * popover.show()
 * popover.hide()
 * popover.destroy()
 * ```
 */
export function createPopover(
    initialReference: HTMLElement | VirtualElement,
    content: HTMLElement,
    options: PopoverOptions = {},
): PopoverInstance {
    ensurePopoverStyle()
    const mergedOptions = { ...DEFAULT_OPTIONS, ...options }
    let reference = initialReference

    let popperInstance: PopperInstance | null = null
    let isVisible = false
    let destroyed = false
    let showTimeout: ReturnType<typeof setTimeout> | null = null
    let hideTimeout: ReturnType<typeof setTimeout> | null = null
    let originalParent: ParentNode | null = null

    const cleanupFns: (() => void)[] = []

    let isLeaving = false
    let currentAnimationId = 0
    let animationCleanup: (() => void) | null = null
    let currentAnimClass: string | null = null
    let updateReferenceCleanup: (() => void) | null = null

    /**
     * 是否使用內建方向感知動畫（transition === true）
     */
    function isPlacementAnimation(): boolean {
        return mergedOptions.transition === true
    }

    /**
     * 取得過渡動畫名稱；回傳 null 表示不啟用（含 placement animation 由另一路徑處理）
     */
    function getTransitionName(): string | null {
        if (!mergedOptions.transition || mergedOptions.transition === true) return null
        return mergedOptions.transition
    }

    /**
     * 等待 CSS transition / animation 結束，附帶備用超時
     * 回傳取消函式
     */
    function whenTransitionEnds(el: HTMLElement, callback: () => void): () => void {
        const duration = mergedOptions.transitionDuration ?? 300
        let done = false

        const resolve = () => {
            if (done) return
            done = true
            el.removeEventListener('transitionend', onEnd)
            el.removeEventListener('animationend', onEnd)
            clearTimeout(fallbackTimer)
            callback()
        }

        const onEnd = (e: TransitionEvent | AnimationEvent) => {
            if (e.target === el) resolve()
        }

        el.addEventListener('transitionend', onEnd)
        el.addEventListener('animationend', onEnd)
        const fallbackTimer = setTimeout(resolve, duration)

        return () => {
            if (done) return
            done = true
            el.removeEventListener('transitionend', onEnd)
            el.removeEventListener('animationend', onEnd)
            clearTimeout(fallbackTimer)
        }
    }

    /**
     * 清除所有過渡動畫 class 並取消進行中的動畫
     */
    function cancelCurrentAnimation() {
        currentAnimationId++

        if (animationCleanup) {
            animationCleanup()
            animationCleanup = null
        }

        // 清除 class-based transition classes
        const name = getTransitionName()
        if (name) {
            const e = [`${name}-enter-from`, `${name}-enter-active`, `${name}-enter-to`]
            const l = [`${name}-leave-from`, `${name}-leave-active`, `${name}-leave-to`]
            content.classList.remove(...e, ...l)
        }

        // 清除 placement animation class
        if (currentAnimClass) {
            content.classList.remove(currentAnimClass)
            currentAnimClass = null
        }
        content.style.opacity = ''

        isLeaving = false
    }

    /**
     * 方向感知動畫 — 根據 Popper placement 加上 MasterCSS @keyframes animation class
     */
    function performPlacementAnimation(reverse: boolean, onComplete: () => void) {
        const animId = currentAnimationId
        if (reverse) isLeaving = true

        const startAnimation = () => {
            if (animId !== currentAnimationId) return

            if (!reverse) {
                // Enter：重新 forceUpdate，讓 Popper 根據完整渲染後的內容高度決定最終方向
                popperInstance?.forceUpdate()
                // 抑制子元素 CSS transition
                content.setAttribute('data-popover-entering', '')
            }

            const placement = popperInstance?.state?.placement ?? mergedOptions.placement
            const animClass = getPlacementAnimClass(placement, reverse)

            currentAnimClass = animClass
            content.classList.add(animClass)

            animationCleanup = whenTransitionEnds(content, () => {
                if (animId !== currentAnimationId) return
                content.classList.remove(animClass)
                if (currentAnimClass === animClass) currentAnimClass = null
                content.style.opacity = ''
                content.removeAttribute('data-popover-entering')
                if (reverse) isLeaving = false
                animationCleanup = null
                onComplete()
            })
        }

        // Enter：延遲一幀，等待巢狀元件完成渲染，Popper 才能正確判斷方向
        // Leave：內容已完整渲染，立即執行
        if (!reverse) {
            requestAnimationFrame(startAnimation)
        } else {
            startAnimation()
        }
    }

    /**
     * 進入動畫
     */
    function performEnterTransition(onComplete: () => void) {
        if (isPlacementAnimation()) {
            performPlacementAnimation(false, onComplete)
            return
        }
        const name = getTransitionName()
        if (!name) {
            onComplete()
            return
        }

        const animId = currentAnimationId

        content.classList.add(`${name}-enter-from`, `${name}-enter-active`)

        // 強制回流，確保瀏覽器已計算 enter-from 初始狀態
        void content.offsetHeight

        // 雙 rAF 確保瀏覽器已繪製初始狀態（與 Vue <Transition> 行為一致）
        requestAnimationFrame(() => {
            if (animId !== currentAnimationId) return

            requestAnimationFrame(() => {
                if (animId !== currentAnimationId) return

                content.classList.remove(`${name}-enter-from`)
                content.classList.add(`${name}-enter-to`)

                animationCleanup = whenTransitionEnds(content, () => {
                    if (animId !== currentAnimationId) return
                    content.classList.remove(`${name}-enter-active`, `${name}-enter-to`)
                    animationCleanup = null
                    onComplete()
                })
            })
        })
    }

    /**
     * 離開動畫
     */
    function performLeaveTransition(onComplete: () => void) {
        if (isPlacementAnimation()) {
            performPlacementAnimation(true, onComplete)
            return
        }
        const name = getTransitionName()
        if (!name) {
            onComplete()
            return
        }

        const animId = currentAnimationId
        isLeaving = true

        content.classList.add(`${name}-leave-from`, `${name}-leave-active`)

        void content.offsetHeight

        // 雙 rAF，與 enter 對稱
        requestAnimationFrame(() => {
            if (animId !== currentAnimationId) return

            requestAnimationFrame(() => {
                if (animId !== currentAnimationId) return

                content.classList.remove(`${name}-leave-from`)
                content.classList.add(`${name}-leave-to`)

                animationCleanup = whenTransitionEnds(content, () => {
                    if (animId !== currentAnimationId) return
                    content.classList.remove(`${name}-leave-active`, `${name}-leave-to`)
                    isLeaving = false
                    animationCleanup = null
                    onComplete()
                })
            })
        })
    }

    function buildPopperOptions(): Partial<PopperOptions> {
        const modifiers: Partial<Modifier<string, object>>[] = []

        if (mergedOptions.offset) {
            modifiers.push({
                name: 'offset',
                options: {
                    offset: mergedOptions.offset,
                },
            })
        }

        if (mergedOptions.arrow) {
            const arrowElement = typeof mergedOptions.arrow === 'boolean' ? undefined : mergedOptions.arrow
            modifiers.push({
                name: 'arrow',
                options: {
                    element: arrowElement,
                    padding: mergedOptions.arrowPadding,
                },
            })
            modifiers.push(createArrowPositionFixModifier())
        }

        modifiers.push({
            name: 'flip',
            enabled: mergedOptions.flip,
            options: {
                fallbackPlacements: mergedOptions.fallbackPlacements,
            },
        })

        modifiers.push({
            name: 'preventOverflow',
            enabled: mergedOptions.preventOverflow,
            options: {
                boundary: mergedOptions.boundary ?? 'clippingParents',
                padding: mergedOptions.overflowPadding,
                altAxis: true,
            },
        })

        // 使用 CSS transition 時必須禁用 GPU 加速，
        // 避免 Popper 的 inline transform 與動畫 class 的 transform 衝突
        const hasAnimation = !!mergedOptions.transition
        const effectiveGpuAcceleration = hasAnimation ? false : mergedOptions.gpuAcceleration
        modifiers.push(createGpuAccelerationModifier(effectiveGpuAcceleration))

        if (mergedOptions.sameWidth) {
            modifiers.push(createSameWidthModifier())
        }

        if (mergedOptions.zIndex !== undefined) {
            modifiers.push(createZIndexModifier(mergedOptions.zIndex))
        }

        return {
            placement: mergedOptions.placement,
            strategy: mergedOptions.strategy,
            modifiers,
            onFirstUpdate: mergedOptions.onFirstUpdate as ((arg0: Partial<State>) => void) | undefined,
        }
    }

    function clearTimeouts() {
        if (showTimeout) {
            clearTimeout(showTimeout)
            showTimeout = null
        }
        if (hideTimeout) {
            clearTimeout(hideTimeout)
            hideTimeout = null
        }
    }

    function show() {
        if (destroyed || mergedOptions.disabled) return

        // 必須清除 pending hide timeout，否則 hover 從 trigger 移至 content 時 hide 不會被取消
        clearTimeouts()

        if (isVisible && !isLeaving) return

        const doShow = () => {
            if (destroyed || mergedOptions.disabled) return

            cancelCurrentAnimation()

            // 清除 updateReference 殘留的位移過渡，避免重新開啟時從舊位置滑動
            content.style.transition = ''

            mergedOptions.onBeforeShow?.()

            // 預先套用初始隱藏狀態，確保元素一出現就帶有 opacity: 0 不會閃爍
            if (isPlacementAnimation()) {
                content.style.opacity = '0'
            } else {
                const transitionName = getTransitionName()
                if (transitionName) {
                    content.classList.add(`${transitionName}-enter-from`)
                }
            }

            if (mergedOptions.teleportTo) {
                const target
                    = typeof mergedOptions.teleportTo === 'string'
                        ? document.querySelector(mergedOptions.teleportTo)
                        : mergedOptions.teleportTo
                if (target && content.parentNode !== target) {
                    originalParent ??= content.parentNode
                    target.appendChild(content)
                }
            }

            // 必須在建立 Popper 之前設定 display，否則 Popper 無法測量元素尺寸
            content.style.display = ''
            content.setAttribute('data-show', '')

            if (!popperInstance) {
                popperInstance = createPopper(reference, content, buildPopperOptions())
            } else {
                popperInstance.setOptions(buildPopperOptions())
            }
            popperInstance.forceUpdate()

            isVisible = true
            mergedOptions.onShow?.()

            performEnterTransition(() => {
                mergedOptions.onAfterShow?.()
            })
        }

        if (mergedOptions.showDelay > 0) {
            showTimeout = setTimeout(doShow, mergedOptions.showDelay)
        } else {
            doShow()
        }
    }

    function hide() {
        if (destroyed) return

        // 必須清除 pending show timeout，否則快速滑過時 popover 會在滑鼠離開後才開啟
        clearTimeouts()

        if (!isVisible) return

        const doHide = () => {
            if (destroyed) return

            cancelCurrentAnimation()
            content.style.transition = ''

            mergedOptions.onBeforeHide?.()

            // 意圖狀態立即切換
            isVisible = false
            mergedOptions.onHide?.()

            // 離開動畫結束後才隱藏 DOM
            performLeaveTransition(() => {
                content.style.display = 'none'
                content.removeAttribute('data-show')
                mergedOptions.onAfterHide?.()
            })
        }

        if (mergedOptions.hideDelay > 0) {
            hideTimeout = setTimeout(doHide, mergedOptions.hideDelay)
        } else {
            doHide()
        }
    }

    function toggle() {
        if (isVisible) {
            hide()
        } else {
            show()
        }
    }

    function update() {
        return popperInstance?.update()
    }

    function forceUpdate() {
        popperInstance?.forceUpdate()
    }

    /**
     * 清除所有事件監聽器
     */
    function clearEventListeners() {
        cleanupFns.forEach(fn => fn())
        cleanupFns.length = 0
    }

    /**
     * 設置關閉相關的事件監聽器
     */
    function setupCloseListeners() {
        const referenceEl = reference as HTMLElement

        if (mergedOptions.closeOnContentClick) {
            const handleContentClick = () => hide()
            content.addEventListener('click', handleContentClick)
            cleanupFns.push(() => content.removeEventListener('click', handleContentClick))
        }

        if (mergedOptions.hideOnScroll) {
            const scrollParents = getScrollParents(referenceEl)
            const handleScroll = () => {
                if (isVisible) hide()
            }
            scrollParents.forEach((parent) => {
                parent.addEventListener('scroll', handleScroll, { passive: true })
            })
            cleanupFns.push(() => {
                scrollParents.forEach((parent) => {
                    parent.removeEventListener('scroll', handleScroll)
                })
            })
        }
    }

    /**
     * 設置觸發相關的事件監聽器
     */
    function setupTriggerListeners() {
        const triggers = Array.isArray(mergedOptions.trigger) ? mergedOptions.trigger : [mergedOptions.trigger]

        const referenceEl = reference as HTMLElement

        if (triggers.includes('click')) {
            const handleClick = () => toggle()
            referenceEl.addEventListener?.('click', handleClick)
            cleanupFns.push(() => referenceEl.removeEventListener?.('click', handleClick))
        }

        if (triggers.includes('hover')) {
            const handleMouseEnter = () => show()
            const handleMouseLeave = (e: MouseEvent) => {
                const related = e.relatedTarget as Node | null
                // 滑鼠在 trigger ↔ content 之間移動時不關閉，避免 content 覆蓋 trigger 導致閃爍
                if (related && (content.contains(related) || (referenceEl as HTMLElement).contains?.(related))) {
                    return
                }
                hide()
            }

            referenceEl.addEventListener?.('mouseenter', handleMouseEnter)
            referenceEl.addEventListener?.('mouseleave', handleMouseLeave)
            content.addEventListener('mouseenter', handleMouseEnter)
            content.addEventListener('mouseleave', handleMouseLeave)

            cleanupFns.push(() => {
                referenceEl.removeEventListener?.('mouseenter', handleMouseEnter)
                referenceEl.removeEventListener?.('mouseleave', handleMouseLeave)
                content.removeEventListener('mouseenter', handleMouseEnter)
                content.removeEventListener('mouseleave', handleMouseLeave)
            })
        }

        if (triggers.includes('focus')) {
            const handleFocus = () => show()
            const handleBlur = () => hide()

            // 使用 focusin/focusout 而非 focus/blur，確保 wrapper 元素能收到子元素的聚焦事件
            referenceEl.addEventListener?.('focusin', handleFocus)
            referenceEl.addEventListener?.('focusout', handleBlur)

            cleanupFns.push(() => {
                referenceEl.removeEventListener?.('focusin', handleFocus)
                referenceEl.removeEventListener?.('focusout', handleBlur)
            })
        }

        if (triggers.includes('contextmenu')) {
            const handleContextMenu = (e: MouseEvent) => {
                e.preventDefault()
                const virtualEl = createVirtualElementFromEvent(e)
                // 同步更新閉包中的 reference，確保 clickOutside 判斷正確
                reference = virtualEl
                if (popperInstance) {
                    // Popper.js 不提供公開 API 更換 reference，直接修改 state 是官方建議的做法
                    popperInstance.state.elements.reference = virtualEl
                    popperInstance.forceUpdate()
                }
                show()
            }
            referenceEl.addEventListener?.('contextmenu', handleContextMenu)
            cleanupFns.push(() => referenceEl.removeEventListener?.('contextmenu', handleContextMenu))
        }
    }

    /**
     * 根據目前 trigger 模式設置所有事件監聽器
     */
    function setupAllEventListeners() {
        const triggers = Array.isArray(mergedOptions.trigger) ? mergedOptions.trigger : [mergedOptions.trigger]

        // manual 模式不設置觸發監聽器，但仍尊重 close options
        if (!triggers.includes('manual')) {
            setupTriggerListeners()
        }
        setupCloseListeners()
    }

    function setOptions(newOptions: Partial<PopoverOptions>) {
        const prevTrigger = mergedOptions.trigger
        const prevCloseOnContentClick = mergedOptions.closeOnContentClick
        const prevHideOnScroll = mergedOptions.hideOnScroll

        Object.assign(mergedOptions, newOptions)

        if (popperInstance) {
            popperInstance.setOptions(buildPopperOptions())
        }

        const eventOptionsChanged
            = (newOptions.trigger !== undefined && newOptions.trigger !== prevTrigger)
            || (newOptions.closeOnContentClick !== undefined && newOptions.closeOnContentClick !== prevCloseOnContentClick)
            || (newOptions.hideOnScroll !== undefined && newOptions.hideOnScroll !== prevHideOnScroll)

        if (eventOptionsChanged) {
            clearEventListeners()
            setupAllEventListeners()
        }
    }

    function destroy() {
        destroyed = true
        clearTimeouts()
        cancelCurrentAnimation()
        updateReferenceCleanup?.()
        clearEventListeners()

        if (popperInstance) {
            popperInstance.destroy()
            popperInstance = null
        }

        content.style.display = 'none'
        content.removeAttribute('data-show')

        // 還原 teleport 前的 DOM 位置
        if (originalParent && content.parentNode !== originalParent) {
            try {
                originalParent.appendChild(content)
            } catch {
                // 原始父節點可能已不在 DOM 中
            }
            originalParent = null
        }

        isVisible = false
    }

    content.style.display = 'none'
    setupAllEventListeners()

    // 觀察 content 尺寸變化，內容撐開時重算位置。
    if (typeof ResizeObserver !== 'undefined') {
        const ro = new ResizeObserver(() => {
            if (isVisible) popperInstance?.update()
        })
        ro.observe(content)
        cleanupFns.push(() => ro.disconnect())
    }

    /**
     * 更新 reference 元素，用於面板已開啟時平滑切換對齊目標
     */
    function updateReference(newReference: HTMLElement | VirtualElement) {
        reference = newReference

        if (popperInstance) {
            // 清除上一次 updateReference 殘留的過渡清理
            updateReferenceCleanup?.()

            const transitionValue = 'top 0.15s ease, left 0.15s ease'
            content.style.transition = transitionValue

            popperInstance.state.elements.reference = newReference
            popperInstance.forceUpdate()

            let cleaned = false
            const cleanup = () => {
                if (cleaned) return
                cleaned = true
                content.style.transition = ''
                content.removeEventListener('transitionend', onEnd)
                clearTimeout(fallbackTimer)
                updateReferenceCleanup = null
            }
            const onEnd = (e: TransitionEvent) => {
                if (e.target === content) cleanup()
            }
            content.addEventListener('transitionend', onEnd)
            const fallbackTimer = setTimeout(cleanup, 200)
            updateReferenceCleanup = cleanup
        }

        // reference 變了，clickOutside 判斷需要更新
        clearEventListeners()
        setupAllEventListeners()
    }

    return {
        get popper() {
            return popperInstance
        },
        show,
        hide,
        toggle,
        update,
        forceUpdate,
        setOptions,
        updateReference,
        destroy,
        isVisible: () => isVisible,
        isContentVisible: () => isVisible || isLeaving,
        getPlacement: () => popperInstance?.state?.placement,
    }
}

/**
 * Vue Composable for Popover
 *
 * @param referenceRef - 觸發元素 ref
 * @param contentRef - 內容元素 ref
 * @param options - 配置選項
 *
 * @example
 * ```vue
 * <script setup>
 * import { ref } from 'vue'
 * import { usePopover } from '@ui/hooks/use-popover'
 *
 * const buttonRef = ref<HTMLElement>()
 * const tooltipRef = ref<HTMLElement>()
 *
 * const { isVisible, show, hide, toggle } = usePopover(buttonRef, tooltipRef, {
 *   placement: 'top',
 *   trigger: 'hover',
 * })
 * </script>
 * ```
 */
export function usePopover(
    referenceRef: MaybeRef<HTMLElement | VirtualElement | null | undefined>,
    contentRef: MaybeRef<HTMLElement | null | undefined>,
    options: UsePopoverOptions = {},
): UsePopoverReturn {
    const instance = ref<PopoverInstance | null>(null)
    const isVisible = ref(false)
    const isContentVisible = ref(false)

    const { visible: visibleRef, ...popoverOptions } = options

    let closeOnEscape = popoverOptions.closeOnEscape !== false
    let closeOnClickOutside = popoverOptions.closeOnClickOutside !== false
    const { register: escapeRegister, unregister: escapeUnregister } = useEscapeStack()
    const { register: clickOutsideRegister, unregister: clickOutsideUnregister } = useClickOutsideStack()

    // 忽略觸發 show 的同一個 click 事件，避免 show 後立即被關閉
    let showTriggeredInCurrentEvent = false

    function registerClickOutside() {
        clickOutsideRegister({
            shouldIgnore: () => showTriggeredInCurrentEvent,
            isInside: (target) => {
                const c = unref(contentRef)
                const r = unref(referenceRef)
                if (c && c.contains(target)) return true
                if (r && (r as HTMLElement).contains?.(target)) return true
                return false
            },
            close: () => instance.value?.hide(),
        })
    }

    function createInstance() {
        const reference = unref(referenceRef)
        const content = unref(contentRef)

        if (!reference || !content) return

        if (instance.value) {
            instance.value.destroy()
        }

        instance.value = createPopover(reference, content, {
            ...popoverOptions,
            onShow: () => {
                escapeRegister(closeOnEscape ? () => instance.value?.hide() : null)
                if (closeOnClickOutside) {
                    showTriggeredInCurrentEvent = true
                    setTimeout(() => { showTriggeredInCurrentEvent = false }, 0)
                    registerClickOutside()
                }
                isVisible.value = true
                isContentVisible.value = true
                popoverOptions.onShow?.()
            },
            onHide: () => {
                escapeUnregister()
                clickOutsideUnregister()
                isVisible.value = false
                popoverOptions.onHide?.()
            },
            onAfterHide: () => {
                isContentVisible.value = false
                popoverOptions.onAfterHide?.()
            },
        })

        // 攔截 setOptions，讓 closeOnEscape / closeOnClickOutside 的動態切換
        // 能同步更新 stack 註冊狀態（createPopover 本身已不處理這兩個選項）
        const rawSetOptions = instance.value.setOptions
        instance.value.setOptions = (newOptions) => {
            if (newOptions.closeOnEscape !== undefined) {
                closeOnEscape = newOptions.closeOnEscape !== false
                if (isVisible.value) {
                    escapeUnregister()
                    escapeRegister(closeOnEscape ? () => instance.value?.hide() : null)
                }
            }
            if (newOptions.closeOnClickOutside !== undefined) {
                const next = newOptions.closeOnClickOutside !== false
                if (closeOnClickOutside !== next) {
                    closeOnClickOutside = next
                    if (isVisible.value) {
                        if (next) registerClickOutside()
                        else clickOutsideUnregister()
                    }
                }
            }
            rawSetOptions(newOptions)
        }

        // 同步受控模式的初始狀態（watch immediate 在 onMounted 前觸發，實例尚未建立）
        if (visibleRef && unref(visibleRef)) {
            instance.value.show()
        }
    }

    function show() {
        instance.value?.show()
    }

    function hide() {
        instance.value?.hide()
    }

    function toggle() {
        instance.value?.toggle()
    }

    function update() {
        instance.value?.update()
    }

    if (visibleRef) {
        watch(
            visibleRef,
            (val) => {
                if (val) {
                    show()
                } else {
                    hide()
                }
            },
            { immediate: true },
        )
    }

    watch(
        () => unref(referenceRef),
        (newRef, oldRef) => {
            if (newRef && newRef !== oldRef) {
                if (isVisible.value && instance.value) {
                    // 面板已開啟：僅更新 reference，不重建實例，平滑移動
                    instance.value.updateReference(newRef)
                } else {
                    createInstance()
                }
            }
        },
        { flush: 'sync' },
    )

    onMounted(() => {
        createInstance()
    })

    onBeforeUnmount(() => {
        instance.value?.destroy()
        instance.value = null
    })

    return {
        instance,
        isVisible,
        isContentVisible,
        show,
        hide,
        toggle,
        update,
    }
}

export type { Placement, PopperInstance, PopperOptions, VirtualElement, Modifier, State }
