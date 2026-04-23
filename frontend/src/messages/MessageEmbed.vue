<script setup lang="ts">
import { computed } from 'vue';
import MessageContent from './MessageContent.vue';
import { parseMessageContent } from './markdown';
import type { MessageEmbed } from './types';

const props = defineProps<{ embed: MessageEmbed }>();

const colorBar = computed(() => {
    if (props.embed.color === null || props.embed.color === undefined) return '#5865f2';
    return `#${props.embed.color.toString(16).padStart(6, '0')}`;
});

const descriptionAst = computed(() =>
    props.embed.description ? parseMessageContent(props.embed.description) : null
);
</script>

<template>
    <div class="embed" :style="{ borderLeftColor: colorBar }">
        <div v-if="embed.author" class="author">
            <img v-if="embed.author.iconUrl" :src="embed.author.iconUrl" alt="" class="icon" />
            <a v-if="embed.author.url" :href="embed.author.url" target="_blank" rel="noopener noreferrer">{{ embed.author.name }}</a>
            <span v-else>{{ embed.author.name }}</span>
        </div>
        <h3 v-if="embed.title" class="title">
            <a v-if="embed.url" :href="embed.url" target="_blank" rel="noopener noreferrer">{{ embed.title }}</a>
            <template v-else>{{ embed.title }}</template>
        </h3>
        <MessageContent v-if="descriptionAst" :nodes="descriptionAst" class="description" />
        <div v-if="embed.fields?.length" class="fields">
            <div
                v-for="(field, idx) in embed.fields"
                :key="idx"
                :class="['field', { inline: field.inline }]"
            >
                <div class="field-name">{{ field.name }}</div>
                <div class="field-value">{{ field.value }}</div>
            </div>
        </div>
        <img v-if="embed.image" :src="embed.image.url" alt="" class="image" loading="lazy" />
        <img v-if="embed.thumbnail" :src="embed.thumbnail.url" alt="" class="thumbnail" loading="lazy" />
        <div v-if="embed.footer || embed.timestamp" class="footer">
            <img v-if="embed.footer?.iconUrl" :src="embed.footer.iconUrl" alt="" class="icon" />
            <span v-if="embed.footer?.text">{{ embed.footer.text }}</span>
            <span v-if="embed.footer?.text && embed.timestamp"> • </span>
            <span v-if="embed.timestamp">{{ new Date(embed.timestamp).toLocaleString() }}</span>
        </div>
    </div>
</template>

<style scoped>
.embed {
    margin-top: 0.4rem;
    padding: 0.5rem 0.75rem;
    background: #f9fafb;
    border-left: 4px solid #5865f2;
    border-radius: 4px;
    max-width: 480px;
}
.author {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.85rem;
    color: #4b5563;
    margin-bottom: 0.25rem;
}
.author .icon {
    width: 16px;
    height: 16px;
    border-radius: 50%;
}
.title {
    margin: 0 0 0.25rem;
    font-size: 1rem;
}
.title a {
    color: #1d4ed8;
}
.description {
    color: #1f2937;
}
.fields {
    margin-top: 0.5rem;
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem 1rem;
}
.field {
    flex: 1 1 100%;
    min-width: 0;
}
.field.inline {
    flex: 1 1 calc(33% - 1rem);
}
.field-name {
    font-weight: 600;
    font-size: 0.85rem;
}
.field-value {
    font-size: 0.9rem;
    color: #1f2937;
    white-space: pre-wrap;
}
.image {
    margin-top: 0.5rem;
    max-width: 100%;
    border-radius: 4px;
}
.thumbnail {
    float: right;
    max-width: 80px;
    margin-left: 0.5rem;
    border-radius: 4px;
}
.footer {
    margin-top: 0.5rem;
    font-size: 0.8rem;
    color: #6b7280;
    display: flex;
    align-items: center;
    gap: 0.25rem;
}
.footer .icon {
    width: 14px;
    height: 14px;
    border-radius: 50%;
}
</style>
