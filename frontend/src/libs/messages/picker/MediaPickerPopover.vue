<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { usePopover, type Placement } from '../../../composables/use-popover';
import MediaPicker, { type MediaSelection } from './MediaPicker.vue';

type MediaPickerInstance = InstanceType<typeof MediaPicker>;

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
const pickerRef = ref<MediaPickerInstance | null>(null);

const popoverVisible = ref(props.visible);
watch(() => props.visible, (v) => { popoverVisible.value = v; });
watch(popoverVisible, (v) => {
    // MediaPicker stays mounted inside the teleported popover, so recents
    // must be flushed explicitly when the popover closes.
    if (!v) pickerRef.value?.flushRecents();
    if (v !== props.visible) emit('update:visible', v);
});

function handlePickerClose() {
    emit('update:visible', false);
}

usePopover(referenceRef, contentEl, {
    placement: props.placement ?? 'top-end',
    trigger: 'manual',
    offset: props.offset ?? [0, 8],
    teleportTo: 'body',
    visible: popoverVisible,
    closeOnClickOutside: true,
    closeOnEscape: true
});
</script>

<template>
    <div ref="contentEl" class="media-picker-popover" style="display: none">
        <MediaPicker
            ref="pickerRef"
            @select="(s) => emit('select', s)"
            @close="handlePickerClose"
        />
    </div>
</template>

<style scoped>
.media-picker-popover { z-index: 1000; }
</style>
