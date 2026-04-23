<script setup lang="ts">
import { toRef } from 'vue';
import { useDrawer, type DrawerPlacement } from '../../../composables/use-drawer';
import MediaPicker, { type MediaSelection } from './MediaPicker.vue';

const props = withDefaults(defineProps<{
    visible: boolean;
    placement?: DrawerPlacement;
}>(), {
    placement: 'bottom'
});

const emit = defineEmits<{
    (e: 'select', selection: MediaSelection): void;
    (e: 'update:visible', value: boolean): void;
}>();

const { placement, backdropClass, panelClass, backdropTransition, panelTransition } = useDrawer({
    visible: toRef(props, 'visible'),
    placement: props.placement,
    onClose: () => emit('update:visible', false)
});

function handleClose() {
    emit('update:visible', false);
}
</script>

<template>
    <Teleport to="body">
        <Transition :name="backdropTransition">
            <div
                v-if="visible"
                :class="backdropClass"
                @click="handleClose"
            />
        </Transition>
        <Transition :name="panelTransition">
            <div
                v-if="visible"
                :class="[panelClass, 'media-picker-drawer']"
                :data-placement="placement"
                role="dialog"
                aria-modal="true"
            >
                <MediaPicker
                    @select="(s) => emit('select', s)"
                    @close="handleClose"
                />
            </div>
        </Transition>
    </Teleport>
</template>

<style scoped>
.media-picker-drawer {
    border-top: 1px solid var(--border);
    border-radius: 12px 12px 0 0;
    max-height: 70vh;
}
.media-picker-drawer[data-placement="top"] {
    border-top: none;
    border-bottom: 1px solid var(--border);
    border-radius: 0 0 12px 12px;
}
.media-picker-drawer[data-placement="left"],
.media-picker-drawer[data-placement="right"] {
    border-top: none;
    border-radius: 0;
    max-height: none;
    max-width: 85vw;
    width: 360px;
}
</style>
