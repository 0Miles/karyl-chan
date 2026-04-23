import { nanoid } from 'nanoid'

interface StackEntry {
    id: string
    shouldIgnore: () => boolean
    isInside: (target: Node) => boolean
    close: () => void
}

const stack: StackEntry[] = []
let listenerInstalled = false

function ensureListener() {
    if (listenerInstalled || typeof document === 'undefined') return
    listenerInstalled = true

    document.addEventListener(
        'click',
        (e) => {
            const target = e.target as Node | null
            if (!target || !document.body.contains(target)) return

            // 由頂端往下走：
            // - shouldIgnore：跳過此層繼續檢查下一層（例如同一個 click 剛觸發了 show）
            // - isInside：停止。點擊落在這一層，該層與其下所有層都保留
            // - 其餘：關閉此層，繼續檢查下一層，達成巢狀同時關閉
            for (let i = stack.length - 1; i >= 0; i--) {
                const entry = stack[i]
                if (entry.shouldIgnore()) continue
                if (entry.isInside(target)) break
                entry.close()
            }
        },
        true,
    )
}

/**
 * 統一的 overlay click-outside 管理
 *
 * 所有 usePopover 共用同一個 stack，點擊外部時依開啟順序（top-down）檢查：
 * - 點擊落在某一層上 → 該層與底下保留
 * - 點擊落在某一層外 → 關閉該層並繼續往下
 *
 * 這讓巢狀 popover（例如 Popover 內含 Select）在點擊真正外部時能同時關閉多層。
 */
export const useClickOutsideStack = () => {
    const id = nanoid()

    const register = (handlers: Omit<StackEntry, 'id'>) => {
        // 先移除舊的（若存在），讓重新 register 時能移到 stack 頂端
        const idx = stack.findIndex(e => e.id === id)
        if (idx !== -1) stack.splice(idx, 1)
        stack.push({ id, ...handlers })
        ensureListener()
    }

    const unregister = () => {
        const idx = stack.findIndex(e => e.id === id)
        if (idx !== -1) stack.splice(idx, 1)
    }

    return {
        register,
        unregister,
    }
}
