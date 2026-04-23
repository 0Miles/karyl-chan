import { nanoid } from 'nanoid'

type EscapeCallback = () => void

interface StackEntry {
    id: string
    callback: EscapeCallback | null
}

const stacks = new Map<string, StackEntry[]>()
let listenerInstalled = false

function ensureListener() {
    if (listenerInstalled) return
    listenerInstalled = true

    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return

        for (const [, entries] of stacks) {
            // 從頂端往下找第一個有 callback 的
            for (let i = entries.length - 1; i >= 0; i--) {
                const entry = entries[i]
                if (entry.callback) {
                    e.stopPropagation()
                    e.preventDefault()
                    entry.callback()
                    return
                }
            }
        }
    })
}

/**
 * 統一的 overlay escape 管理
 *
 * 所有 overlay（usePopover、NuModal）共用同一個 escape stack，
 * 按 Escape 時只有最頂層的 overlay 會被關閉。
 *
 * @param target - stack 分組 key（通常為 'overlay'）
 */
export const useEscapeStack = (target = 'overlay') => {
    if (!stacks.has(target)) {
        stacks.set(target, [])
    }

    const id = nanoid()
    const stack = stacks.get(target)!

    /**
     * 註冊到 stack，提供 escape callback。
     * 傳入 null 表示佔位但不響應 Escape（如 closeOnEscape: false 的 overlay）。
     */
    const register = (callback: EscapeCallback | null) => {
        // 避免重複註冊
        if (stack.some(e => e.id === id)) return
        stack.push({ id, callback })
        ensureListener()
    }

    /**
     * 從 stack 移除
     */
    const unregister = () => {
        const idx = stack.findIndex(e => e.id === id)
        if (idx !== -1) stack.splice(idx, 1)
    }

    /**
     * 取得目前 stack 中的註冊數量（用於判斷是否需要解鎖 body scroll 等）
     */
    const getStackSize = () => stack.length

    return {
        register,
        unregister,
        getStackSize,
    }
}
