<script setup lang="ts">
import { Icon } from '@iconify/vue';
import { useI18n } from 'vue-i18n';
import type { Message } from '../../libs/messages/types';

const { t: $t } = useI18n();

defineProps<{
    message: Message | null;
}>();

const emit = defineEmits<{
    (e: 'close'): void;
    (e: 'copy'): void;
}>();
</script>

<template>
    <Teleport to="body">
        <div v-if="message" class="src-backdrop" @click.self="emit('close')">
            <div class="src-modal" role="dialog" aria-modal="true">
                <header class="src-head">
                    <span>{{ $t('messages.viewSource') }}</span>
                    <button type="button" class="src-icon" @click="emit('copy')" :title="$t('messages.copyText')">
                        <Icon icon="material-symbols:content-copy-outline-rounded" width="16" height="16" />
                    </button>
                    <button type="button" class="src-icon" @click="emit('close')" :aria-label="$t('common.close')">
                        <Icon icon="material-symbols:close-rounded" width="18" height="18" />
                    </button>
                </header>
                <pre class="src-body"><code>{{ message.content ?? '' }}</code></pre>
            </div>
        </div>
    </Teleport>
</template>

<style scoped>
.src-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    z-index: 95;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
}
.src-modal {
    width: min(96vw, 720px);
    max-height: 80vh;
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
    display: flex;
    flex-direction: column;
    overflow: hidden;
}
.src-head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.55rem 0.85rem;
    border-bottom: 1px solid var(--border);
    font-weight: 600;
    color: var(--text-strong);
    font-size: 0.92rem;
}
.src-head > span:first-child { flex: 1; }
.src-icon {
    background: none;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    cursor: pointer;
    padding: 4px;
    color: var(--text);
    line-height: 0;
}
.src-icon:hover { background: var(--bg-surface-hover); }
.src-body {
    margin: 0;
    padding: 0.75rem 1rem;
    overflow: auto;
    background: var(--bg-surface-2);
    color: var(--text);
    font-family: ui-monospace, SFMono-Regular, monospace;
    font-size: 0.85rem;
    white-space: pre-wrap;
    word-break: break-word;
}
</style>
