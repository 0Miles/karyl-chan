<script setup lang="ts">
import { computed } from 'vue';
import { useMessageContext } from './context';

const props = defineProps<{
    kind: 'user' | 'channel' | 'role' | 'everyone' | 'here' | 'slashCommand';
    id?: string;
    name?: string;
}>();

const ctx = useMessageContext();

const display = computed(() => {
    switch (props.kind) {
        case 'user': {
            const u = props.id ? ctx.resolveUser?.(props.id) : null;
            return { text: `@${u?.name ?? props.id ?? 'unknown'}`, color: u?.color ?? null };
        }
        case 'channel': {
            const c = props.id ? ctx.resolveChannel?.(props.id) : null;
            return { text: `#${c?.name ?? props.id ?? 'unknown'}`, color: null };
        }
        case 'role': {
            const r = props.id ? ctx.resolveRole?.(props.id) : null;
            return { text: `@${r?.name ?? props.id ?? 'role'}`, color: r?.color ?? null };
        }
        case 'everyone':
            return { text: '@everyone', color: null };
        case 'here':
            return { text: '@here', color: null };
        case 'slashCommand':
            return { text: `/${props.name ?? ''}`, color: null };
    }
});
</script>

<template>
    <span class="mention" :style="display.color ? { color: display.color } : undefined">{{ display.text }}</span>
</template>

<style scoped>
.mention {
    display: inline;
    background: rgba(88, 101, 242, 0.15);
    color: #5865f2;
    padding: 0 2px;
    border-radius: 3px;
    font-weight: 500;
    cursor: default;
}
</style>
