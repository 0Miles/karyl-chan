<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{ count: number }>();

const display = computed(() => (props.count > 99 ? '99+' : String(props.count)));
</script>

<template>
    <span v-if="count > 0" class="unread-pill">{{ display }}</span>
</template>

<style scoped>
.unread-pill {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 18px;
    height: 18px;
    padding: 0 6px;
    border-radius: 9px;
    font-size: 12px;
    font-weight: bold;
    background: var(--unread-accent, #f23f43);
    color: #fff;
}
</style>
