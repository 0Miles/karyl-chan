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

const standaloneImage = computed(() => props.embed.image ?? props.embed.thumbnail ?? null);
const imageOnly = computed(() => Boolean(
    standaloneImage.value
    && !props.embed.title
    && !props.embed.description
    && !props.embed.author
    && !props.embed.footer
    && !(props.embed.fields && props.embed.fields.length > 0)
));
// When a thumbnail is present alongside other content, lay out as a grid
// (text on the left, thumbnail pinned top-right) instead of a float. The
// old float worked for wide embeds but fell apart whenever the text
// column was too narrow, pushing the thumbnail outside the border.
const hasSideThumb = computed(() => Boolean(props.embed.thumbnail) && !imageOnly.value);

function preferProxy(image: { url: string; proxyUrl?: string }): string {
    return image.proxyUrl || image.url;
}
</script>

<template>
    <a
        v-if="imageOnly && standaloneImage"
        :href="embed.url ?? standaloneImage.url"
        target="_blank"
        rel="noopener noreferrer"
        class="image-only"
    >
        <img :src="preferProxy(standaloneImage)" alt="" loading="lazy" referrerpolicy="no-referrer" />
    </a>
    <div v-else class="embed" :style="{ borderLeftColor: colorBar }">
        <div :class="['embed-layout', { 'with-thumb': hasSideThumb }]">
            <div class="embed-body">
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
            </div>
            <img
                v-if="hasSideThumb && embed.thumbnail"
                :src="preferProxy(embed.thumbnail)"
                alt=""
                class="thumbnail"
                loading="lazy"
                referrerpolicy="no-referrer"
            />
        </div>
        <img
            v-if="embed.image"
            :src="preferProxy(embed.image)"
            alt=""
            class="image"
            loading="lazy"
            referrerpolicy="no-referrer"
        />
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
    background: var(--bg-surface-2);
    border-left: 4px solid var(--accent);
    border-radius: 4px;
    /* Clamp width against the parent on narrow viewports — bare max-width
       alone let content push us wider than the chat column on mobile. */
    max-width: min(480px, 100%);
    box-sizing: border-box;
    color: var(--text);
    /* Break long unbroken words (URLs, ids, Asian text without spaces) so
       nothing in any child can exceed our box. */
    overflow-wrap: anywhere;
    word-break: break-word;
}
.embed-layout {
    display: block;
}
.embed-layout.with-thumb {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 0.75rem;
    align-items: start;
}
.embed-body {
    min-width: 0;
}
.author {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.85rem;
    color: var(--quote-text);
    margin-bottom: 0.25rem;
    min-width: 0;
}
.author > :last-child {
    min-width: 0;
    overflow-wrap: anywhere;
}
.author .icon {
    width: 16px;
    height: 16px;
    border-radius: 50%;
    flex-shrink: 0;
}
.title {
    margin: 0 0 0.25rem;
    font-size: 1rem;
    overflow-wrap: anywhere;
    word-break: break-word;
}
.title a {
    color: var(--link-mask);
}
.description {
    color: var(--text);
    min-width: 0;
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
    overflow-wrap: anywhere;
}
.field-value {
    font-size: 0.9rem;
    color: var(--text);
    white-space: pre-wrap;
    /* pre-wrap preserves author newlines but won't break long tokens —
       overflow-wrap does that without affecting normal whitespace. */
    overflow-wrap: anywhere;
    word-break: break-word;
    min-width: 0;
}
.image {
    display: block;
    margin-top: 0.5rem;
    max-width: 100%;
    max-height: 360px;
    /* object-fit keeps tall / wide images from warping when we clamp. */
    object-fit: contain;
    border-radius: 4px;
}
.thumbnail {
    max-width: 80px;
    max-height: 80px;
    object-fit: cover;
    border-radius: 4px;
    display: block;
}
.footer {
    margin-top: 0.5rem;
    font-size: 0.8rem;
    color: var(--text-muted);
    display: flex;
    align-items: center;
    gap: 0.25rem;
    flex-wrap: wrap;
    min-width: 0;
}
.footer .icon {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    flex-shrink: 0;
}
.image-only {
    display: inline-block;
    margin-top: 0.4rem;
    max-width: min(360px, 100%);
}
.image-only img {
    display: block;
    max-width: 100%;
    max-height: 360px;
    object-fit: contain;
    border-radius: 6px;
}

/* Very narrow viewports: stack the thumbnail above the body instead of
   wedging a ~100px grid column into a 280px embed. */
@media (max-width: 380px) {
    .embed-layout.with-thumb {
        grid-template-columns: minmax(0, 1fr);
    }
    .thumbnail {
        justify-self: start;
    }
}
</style>
