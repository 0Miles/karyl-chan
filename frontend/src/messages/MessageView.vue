<script setup lang="ts">
import { computed } from 'vue';
import MessageContent from './MessageContent.vue';
import MessageReplyHeader from './MessageReplyHeader.vue';
import MessageAttachment from './MessageAttachment.vue';
import MessageSticker from './MessageSticker.vue';
import MessageReactions from './MessageReactions.vue';
import MessageEmbed from './MessageEmbed.vue';
import { parseMessageContent } from './markdown';
import type { Message } from './types';

const props = defineProps<{
    message: Message;
    compact?: boolean;
}>();

const ast = computed(() => parseMessageContent(props.message.content));
const time = computed(() => {
    const d = new Date(props.message.createdAt);
    return Number.isNaN(d.getTime()) ? props.message.createdAt : d.toLocaleString();
});
const displayName = computed(() => props.message.author.globalName ?? props.message.author.username);
</script>

<template>
    <article :class="['message', { compact }]" :data-message-id="message.id">
        <MessageReplyHeader v-if="message.referencedMessage" :referenced="message.referencedMessage" />
        <header v-if="!compact" class="header">
            <img v-if="message.author.avatarUrl" :src="message.author.avatarUrl" alt="" class="avatar" />
            <div v-else class="avatar avatar-fallback">{{ displayName.charAt(0).toUpperCase() }}</div>
            <div class="meta">
                <span class="name">{{ displayName }}</span>
                <span v-if="message.author.bot" class="bot-tag">BOT</span>
                <time class="time" :datetime="message.createdAt">{{ time }}</time>
                <span v-if="message.editedAt" class="edited">(edited)</span>
            </div>
        </header>
        <div class="body">
            <MessageContent :nodes="ast" />
            <MessageAttachment v-for="att in message.attachments ?? []" :key="att.id" :attachment="att" />
            <MessageSticker v-for="sticker in message.stickers ?? []" :key="sticker.id" :sticker="sticker" />
            <MessageEmbed v-for="(embed, idx) in message.embeds ?? []" :key="idx" :embed="embed" />
            <MessageReactions
                v-if="message.reactions?.length"
                :message-id="message.id"
                :reactions="message.reactions"
            />
        </div>
    </article>
</template>

<style scoped>
.message {
    display: flex;
    flex-direction: column;
    padding: 0.4rem 0.75rem;
    gap: 0.15rem;
}
.message:hover {
    background: var(--bg-surface-hover);
}
.message.compact {
    padding-top: 0.1rem;
    padding-bottom: 0.1rem;
}
.header {
    display: flex;
    align-items: flex-start;
    gap: 0.6rem;
}
.avatar {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    object-fit: cover;
    flex-shrink: 0;
}
.avatar-fallback {
    background: var(--accent);
    color: var(--text-on-accent);
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 600;
}
.meta {
    display: flex;
    align-items: baseline;
    gap: 0.4rem;
    flex-wrap: wrap;
}
.name {
    font-weight: 600;
    color: var(--text-strong);
}
.bot-tag {
    background: var(--accent);
    color: var(--text-on-accent);
    font-size: 0.65rem;
    font-weight: 700;
    padding: 1px 4px;
    border-radius: 3px;
    line-height: 1;
}
.time {
    font-size: 0.75rem;
    color: var(--text-muted);
}
.edited {
    font-size: 0.75rem;
    color: var(--text-faint);
}
.body {
    margin-left: 2.85rem;
}
.compact .body {
    margin-left: 2.85rem;
}
</style>
