<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useBreakpoint } from '../../../composables/use-breakpoint';
import AppPopover from '../../../components/AppPopover.vue';
import MediaPicker, { type MediaSelection } from './MediaPicker.vue';
import type { Placement } from '../../../composables/use-popover';

type MediaPickerInstance = InstanceType<typeof MediaPicker>;

/**
 * Viewport-aware emoji/sticker picker built on AppPopover. Two ways to
 * wire the trigger:
 *
 *   1. Pass a button via the `#trigger` slot:
 *        <MediaPickerPopover v-model:visible="showPicker">
 *            <template #trigger>
 *                <button>…</button>
 *            </template>
 *        </MediaPickerPopover>
 *
 *   2. Pass a pre-existing element ref via `referenceEl` — useful when
 *      the trigger can't be co-located with the picker (e.g., one
 *      picker shared across many react buttons in a message list).
 *
 * The desktop popover keeps MediaPicker mounted across show/hide, so
 * recents are flushed explicitly on close. The mobile drawer unmounts
 * the picker with itself, and MediaPicker.onBeforeUnmount already
 * handles that path.
 */
const props = withDefaults(defineProps<{
    /** External anchor — used when the trigger lives outside this component. */
    referenceEl?: HTMLElement | null;
    /** Two-way via v-model:visible. */
    visible: boolean;
    placement?: Placement;
    offset?: [number, number];
    /**
     * Allow stickers. Set to false for reaction pickers — Discord
     * reactions only support emojis, so the Stickers tab / recents /
     * search results should be hidden in that flow.
     */
    stickers?: boolean;
}>(), {
    stickers: true
});

const emit = defineEmits<{
    (e: 'select', selection: MediaSelection): void;
    (e: 'update:visible', value: boolean): void;
}>();

const { isMobile } = useBreakpoint();

const pickerRef = ref<MediaPickerInstance | null>(null);

const open = computed<boolean>({
    get: () => props.visible,
    set: (v) => emit('update:visible', v)
});

watch(() => props.visible, (v, prev) => {
    if (!v && prev && !isMobile.value) pickerRef.value?.flushRecents();
});

function handleClose() {
    emit('update:visible', false);
}
</script>

<template>
    <AppPopover
        v-model:open="open"
        :reference-el="referenceEl ?? null"
        :placement="placement ?? 'top-end'"
        :offset="offset ?? [0, 8]"
    >
        <template #trigger>
            <slot name="trigger" />
        </template>
        <MediaPicker
            ref="pickerRef"
            :stickers="stickers"
            @select="(s) => emit('select', s)"
            @close="handleClose"
        />
    </AppPopover>
</template>
