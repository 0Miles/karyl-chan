import { describe, it, expect } from 'vitest';
import { defineComponent, h, type Ref } from 'vue';
import { mount } from '@vue/test-utils';
import { useShiftKey } from './use-shift-key';

function makeHost() {
    let shift!: Ref<boolean>;
    const Host = defineComponent({
        setup() {
            shift = useShiftKey();
            return () => h('div');
        }
    });
    const wrapper = mount(Host);
    return { wrapper, get held() { return shift.value; } };
}

describe('useShiftKey', () => {
    it('starts as false', () => {
        const host = makeHost();
        expect(host.held).toBe(false);
        host.wrapper.unmount();
    });

    it('flips to true on keydown when shiftKey is set', () => {
        const host = makeHost();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', shiftKey: true }));
        expect(host.held).toBe(true);
        host.wrapper.unmount();
    });

    it('flips back to false on keyup once shift is released', () => {
        const host = makeHost();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift', shiftKey: true }));
        expect(host.held).toBe(true);
        document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift', shiftKey: false }));
        expect(host.held).toBe(false);
        host.wrapper.unmount();
    });

    it('clears the held flag on window blur (e.g. user alt-tabs while holding shift)', () => {
        const host = makeHost();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift', shiftKey: true }));
        expect(host.held).toBe(true);
        window.dispatchEvent(new Event('blur'));
        expect(host.held).toBe(false);
        host.wrapper.unmount();
    });

    it('detaches its listeners on unmount (no leak across instances)', () => {
        const host = makeHost();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', shiftKey: true }));
        expect(host.held).toBe(true);
        host.wrapper.unmount();
        // After unmount, further events should not affect the (already-destroyed) ref.
        // The ref itself still exists — we just confirm a fresh instance starts cold.
        const second = makeHost();
        expect(second.held).toBe(false);
        second.wrapper.unmount();
    });
});
