<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { usePopover, type Placement } from '../../../composables/use-popover';
import MediaPicker, { type MediaSelection } from './MediaPicker.vue';

const props = defineProps<{
    /** The element the popover anchors to (typically a `<button>` ref). */
    referenceEl: HTMLElement | null;
    /** v-model:visible — true to open, false to close. */
    visible: boolean;
    placement?: Placement;
    /** Distance offset from the reference, [skidding, distance]. */
    offset?: [number, number];
}>();

const emit = defineEmits<{
    (e: 'select', selection: MediaSelection): void;
    (e: 'update:visible', value: boolean): void;
}>();

const contentEl = ref<HTMLElement | null>(null);
const referenceRef = computed(() => props.referenceEl);
const visibleRef = ref(props.visible);

watch(() => props.visible, (v) => { visibleRef.value = v; });
watch(visibleRef, (v) => { if (v !== props.visible) emit('update:visible', v); });

usePopover(referenceRef, contentEl, {
    placement: props.placement ?? 'top-end',
    trigger: 'manual',
    offset: props.offset ?? [0, 8],
    teleportTo: 'body',
    visible: visibleRef,
    closeOnClickOutside: true,
    closeOnEscape: true
});
</script>

<template>
    <div ref="contentEl" class="media-picker-popover" style="display: none">
        <MediaPicker @select="(s) => emit('select', s)" />
    </div>
</template>

<style scoped>
.media-picker-popover {
    z-index: 1000;
}
</style>
