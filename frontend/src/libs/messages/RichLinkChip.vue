<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import type { RichLink, RichLinkHandler } from './context';

/**
 * Generic rich-link chip. Platform-agnostic: delegates pattern matching,
 * resolution and click behaviour to the handler supplied by the caller.
 * Three states drive the template:
 *   • loading — handler.resolve hasn't returned; chip is disabled.
 *   • known   — resolve returned data; chip is clickable.
 *   • unknown — resolve returned null (scheme matched but target is
 *               inaccessible); chip shows handler.unknownLabel and
 *               stays disabled.
 */
const props = defineProps<{
    url: string;
    handler: RichLinkHandler;
}>();

const info = ref<RichLink | null>(null);
const resolved = ref(false);
let loadToken = 0;

async function load() {
    const token = ++loadToken;
    resolved.value = false;
    info.value = null;
    const result = await props.handler.resolve(props.url);
    if (token !== loadToken) return;
    info.value = result;
    resolved.value = true;
}

onMounted(load);
watch(() => [props.url, props.handler] as const, load);

const isKnown = computed(() => !!info.value);
const isUnknown = computed(() => resolved.value && !info.value);
const isLoading = computed(() => !resolved.value);

function onClick() {
    if (info.value) props.handler.onClick(info.value, props.url);
}
</script>

<template>
    <button
        type="button"
        :class="['rich-link', { known: isKnown, unknown: isUnknown, loading: isLoading }]"
        :disabled="!isKnown"
        :title="info?.preview ?? undefined"
        @click="onClick"
    >
        <template v-if="info">
            <img
                v-if="info.iconUrl"
                :src="info.iconUrl"
                alt=""
                class="icon"
            />
            <span
                v-else-if="info.iconFallback"
                class="icon icon-fallback"
            >{{ info.iconFallback }}</span>
            <span class="label">
                <span v-if="info.labelPrefix" class="prefix">{{ info.labelPrefix }}</span>{{ info.label }}
            </span>
            <template v-if="info.preview">
                <span class="sep">›</span>
                <span class="preview">{{ info.preview }}</span>
            </template>
        </template>
        <template v-else-if="resolved">
            <span class="label">{{ handler.unknownLabel }}</span>
        </template>
        <template v-else>
            <span class="label muted">…</span>
        </template>
    </button>
</template>

<style scoped>
/* Matches the colour scheme of MentionChip so mentions and rich links
   share a consistent "interactive inline token" look. */
.rich-link {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    max-width: 100%;
    vertical-align: baseline;
    padding: 0 4px;
    background: var(--accent-bg);
    color: var(--accent-text);
    border: none;
    border-radius: 3px;
    font: inherit;
    font-weight: 500;
    cursor: pointer;
    overflow: hidden;
}
.rich-link.known:hover {
    background: var(--accent);
    color: var(--text-on-accent);
}
.rich-link.unknown,
.rich-link.loading {
    cursor: default;
}
.rich-link:disabled {
    opacity: 0.7;
}
.icon {
    width: 1em;
    height: 1em;
    border-radius: 50%;
    object-fit: cover;
    flex-shrink: 0;
}
.icon-fallback {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: currentColor;
    color: var(--accent-bg);
    font-size: 0.65em;
    font-weight: 700;
    line-height: 1;
}
.rich-link.known:hover .icon-fallback {
    color: var(--accent);
}
.label {
    white-space: nowrap;
}
.label.muted {
    opacity: 0.7;
}
.prefix {
    opacity: 0.85;
    margin-right: 0.05em;
}
.sep {
    opacity: 0.7;
    flex-shrink: 0;
}
.preview {
    opacity: 0.9;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
}
</style>
