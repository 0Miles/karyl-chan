<script setup lang="ts">
import { useMessageContext } from './context';
import type { Message } from './types';

const props = defineProps<{ referenced: Message }>();

const ctx = useMessageContext();

function jump() {
    ctx.onReplyClick?.(props.referenced.id);
}
</script>

<template>
    <button type="button" class="reply" @click="jump">
        <span class="arrow">↩</span>
        <img v-if="referenced.author.avatarUrl" :src="referenced.author.avatarUrl" alt="" class="avatar" />
        <span class="author">{{ referenced.author.globalName ?? referenced.author.username }}</span>
        <span class="preview">{{ referenced.content || '(attachment)' }}</span>
    </button>
</template>

<style scoped>
.reply {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0;
    background: none;
    border: none;
    cursor: pointer;
    color: #6b7280;
    font-size: 0.85rem;
    margin-bottom: 0.2rem;
    max-width: 100%;
    overflow: hidden;
}
.arrow {
    color: #9ca3af;
}
.avatar {
    width: 16px;
    height: 16px;
    border-radius: 50%;
}
.author {
    font-weight: 500;
    color: #4b5563;
}
.preview {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 28ch;
}
.reply:hover .preview {
    color: #1f2937;
}
</style>
