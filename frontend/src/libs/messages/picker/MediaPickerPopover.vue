<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useBreakpoint } from '../../../composables/use-breakpoint';
import AppPopover from '../../../components/AppPopover.vue';
import MediaPicker, { type MediaSelection } from './MediaPicker.vue';
import type { Placement } from '../../../composables/use-popover';

type MediaPickerInstance = InstanceType<typeof MediaPicker>;

/**
 * Viewport-aware wrapper around MediaPicker, built on AppPopover:
 * - Desktop → popover anchored to the caller's trigger button.
 * - Mobile  → bottom drawer (AppPopover swaps presentations internally).
 *
 * Desktop popover keeps the picker mounted across show/hide, so we
 * flush recents explicitly on close. The mobile drawer unmounts the
 * picker when it closes, which already runs MediaPicker.onBeforeUnmount
 * → flushRecents for us.
 */
const props = defineProps<{
    /** Button element the desktop popover anchors to. */
    referenceEl: HTMLElement | null;
    /** Two-way via v-model:visible. */
    visible: boolean;
    placement?: Placement;
    offset?: [number, number];
}>();

const emit = defineEmits<{
    (e: 'select', selection: MediaSelection): void;
    (e: 'update:visible', value: boolean): void;
}>();

const { isMobile } = useBreakpoint();

const desktopPickerRef = ref<MediaPickerInstance | null>(null);

const open = computed<boolean>({
    get: () => props.visible,
    set: (v) => emit('update:visible', v)
});

watch(() => props.visible, (v, prev) => {
    // The desktop popover keeps the picker mounted across open/close, so
    // recents need to be flushed explicitly. On mobile the picker unmounts
    // with the drawer and MediaPicker's own onBeforeUnmount handles it.
    if (!v && prev && !isMobile.value) desktopPickerRef.value?.flushRecents();
});

function handleClose() {
    emit('update:visible', false);
}
</script>

<template>
    <AppPopover
        v-model:open="open"
        :reference-el="referenceEl"
        :placement="placement ?? 'top-end'"
        :offset="offset ?? [0, 8]"
    >
        <MediaPicker
            ref="desktopPickerRef"
            @select="(s) => emit('select', s)"
            @close="handleClose"
        />
    </AppPopover>
</template>
