<script setup lang="ts">
import { Icon } from '@iconify/vue';

/**
 * AppButton — 通用按鈕元件
 *
 * 整合 codebase 中各頁面各自實作的 scoped button CSS，
 * 提供一致的 variant / size / loading / disabled / block 語義。
 *
 * Props:
 *   variant  — 視覺風格，預設 'primary'
 *   size     — 尺寸，預設 'md'
 *   loading  — 顯示旋轉 spinner；按鈕同時被 disabled
 *   disabled — 禁用
 *   block    — 展開為 100% 寬度
 *   type     — HTML button type，預設 'button'
 *   icon     — 左側 iconify icon 名稱（亦可用 #icon slot）
 *
 * Slots:
 *   default  — 按鈕文字
 *   icon     — 左側圖示（優先於 `icon` prop）
 *   trailing — 右側圖示 / badge
 */
withDefaults(defineProps<{
    variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
    size?: 'sm' | 'md' | 'lg';
    loading?: boolean;
    disabled?: boolean;
    block?: boolean;
    type?: 'button' | 'submit';
    icon?: string;
}>(), {
    variant: 'primary',
    size: 'md',
    loading: false,
    disabled: false,
    block: false,
    type: 'button',
    icon: undefined,
});
</script>

<template>
    <button
        :type="type"
        :class="[
            'app-btn',
            `app-btn--${variant}`,
            `app-btn--${size}`,
            { 'app-btn--block': block, 'app-btn--loading': loading },
        ]"
        :disabled="disabled || loading"
    >
        <!-- spinner（loading 狀態）-->
        <Icon
            v-if="loading"
            icon="material-symbols:progress-activity"
            class="app-btn-spinner"
            aria-hidden="true"
        />

        <!-- 左側圖示：slot 優先，其次 icon prop -->
        <slot v-if="!loading" name="icon">
            <Icon
                v-if="icon"
                :icon="icon"
                width="16"
                height="16"
                aria-hidden="true"
            />
        </slot>

        <!-- 主要 label -->
        <span class="app-btn-label"><slot /></span>

        <!-- 右側 slot -->
        <slot name="trailing" />
    </button>
</template>

<style scoped>
.app-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.35rem;
    border-radius: var(--radius-sm);
    font: inherit;
    font-weight: 500;
    cursor: pointer;
    white-space: nowrap;
    transition: filter 0.1s, background 0.1s, opacity 0.1s;
    flex-shrink: 0;
}

/* ── block ──────────────────────────────────────────────────────── */
.app-btn--block {
    width: 100%;
}

/* ── disabled / loading ─────────────────────────────────────────── */
.app-btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
}

/* ── sizes ──────────────────────────────────────────────────────── */
.app-btn--sm {
    padding: 0.3rem 0.6rem;
    font-size: 0.82rem;
}
.app-btn--md {
    padding: 0.45rem 0.85rem;
    font-size: 0.88rem;
}
.app-btn--lg {
    padding: 0.6rem 1.1rem;
    font-size: 0.95rem;
}

/* ── primary ────────────────────────────────────────────────────── */
.app-btn--primary {
    background: var(--accent);
    color: var(--text-on-accent);
    border: 1px solid var(--accent);
}
.app-btn--primary:not(:disabled):hover {
    filter: brightness(1.1);
}

/* ── secondary ──────────────────────────────────────────────────── */
.app-btn--secondary {
    background: var(--bg-surface-2);
    color: var(--text);
    border: 1px solid var(--border);
}
.app-btn--secondary:not(:disabled):hover {
    background: var(--bg-surface-hover);
}

/* ── ghost ──────────────────────────────────────────────────────── */
.app-btn--ghost {
    background: transparent;
    color: var(--text);
    border: 1px solid var(--border);
}
.app-btn--ghost:not(:disabled):hover {
    background: var(--bg-surface-hover);
}

/* ── danger ─────────────────────────────────────────────────────── */
.app-btn--danger {
    background: transparent;
    color: var(--danger, #dc2626);
    border: 1px solid color-mix(in srgb, var(--danger, #dc2626) 40%, transparent);
}
.app-btn--danger:not(:disabled):hover {
    background: color-mix(in srgb, var(--danger, #dc2626) 8%, transparent);
}

/* ── spinner ─────────────────────────────────────────────────────── */
@keyframes app-btn-spin { to { transform: rotate(360deg); } }
.app-btn-spinner {
    width: 14px;
    height: 14px;
    animation: app-btn-spin 0.8s linear infinite;
    flex-shrink: 0;
}

.app-btn-label { line-height: 1.2; }
</style>
