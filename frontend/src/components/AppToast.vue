<script setup lang="ts">
import { useToastStore } from '../stores/toastStore';

const toast = useToastStore();
</script>

<template>
    <Teleport to="body">
        <TransitionGroup name="toast" tag="div" class="toast-container">
            <div
                v-for="item in toast.items"
                :key="item.id"
                class="toast-item"
                :class="`toast-item--${item.type}`"
                @click="toast.dismiss(item.id)"
            >
                {{ item.message }}
            </div>
        </TransitionGroup>
    </Teleport>
</template>

<style scoped>
.toast-container {
    position: fixed;
    bottom: 1rem;
    right: 1rem;
    z-index: 9999;
    display: flex;
    flex-direction: column-reverse;
    gap: 0.5rem;
    pointer-events: none;
}
.toast-item {
    pointer-events: auto;
    cursor: pointer;
    max-width: 360px;
    padding: 0.6rem 0.9rem;
    border-radius: var(--radius-sm, 6px);
    font-size: 0.82rem;
    line-height: 1.4;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.25);
}
.toast-item--error {
    background: var(--danger, #ef4444);
    color: #fff;
}
.toast-item--info {
    background: var(--bg-surface, #1e1e2e);
    color: var(--text, #cdd6f4);
    border: 1px solid var(--border, #45475a);
}
.toast-enter-active,
.toast-leave-active {
    transition: all 0.25s ease;
}
.toast-enter-from {
    opacity: 0;
    transform: translateY(0.5rem);
}
.toast-leave-to {
    opacity: 0;
    transform: translateX(1rem);
}
</style>
