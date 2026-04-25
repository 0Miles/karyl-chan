import { describe, it, expect, vi } from 'vitest';
import { useEscapeStack } from './use-escape-stack';

function pressEscape() {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
}

describe('useEscapeStack', () => {
    it('invokes only the top-of-stack callback', () => {
        const a = vi.fn();
        const b = vi.fn();
        const stackA = useEscapeStack();
        const stackB = useEscapeStack();
        stackA.register(a);
        stackB.register(b);
        pressEscape();
        expect(b).toHaveBeenCalledOnce();
        expect(a).not.toHaveBeenCalled();
        // Cleanup so subsequent tests start cold.
        stackA.unregister();
        stackB.unregister();
    });

    it('falls through a null-callback layer to the next responsive one', () => {
        const a = vi.fn();
        const stackA = useEscapeStack();
        const stackPlaceholder = useEscapeStack();
        stackA.register(a);
        stackPlaceholder.register(null); // placeholder layer (closeOnEscape: false)
        pressEscape();
        expect(a).toHaveBeenCalledOnce();
        stackA.unregister();
        stackPlaceholder.unregister();
    });

    it('after unregister, the next-down handler takes over', () => {
        const a = vi.fn();
        const b = vi.fn();
        const stackA = useEscapeStack();
        const stackB = useEscapeStack();
        stackA.register(a);
        stackB.register(b);
        stackB.unregister();
        pressEscape();
        expect(a).toHaveBeenCalledOnce();
        expect(b).not.toHaveBeenCalled();
        stackA.unregister();
    });

    it('does nothing for non-Escape keys', () => {
        const a = vi.fn();
        const stack = useEscapeStack();
        stack.register(a);
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
        expect(a).not.toHaveBeenCalled();
        stack.unregister();
    });

    it('does nothing when the stack is empty', () => {
        // No registrations — pressing Escape should not throw.
        expect(() => pressEscape()).not.toThrow();
    });

    it('isolates groups by target key', () => {
        const overlayCb = vi.fn();
        const drawerCb = vi.fn();
        const overlay = useEscapeStack('overlay');
        const drawer = useEscapeStack('drawer');
        overlay.register(overlayCb);
        drawer.register(drawerCb);
        pressEscape();
        // Both groups invoke their top entry — the listener walks every
        // group, but each group has only one responsive entry here.
        expect(overlayCb).toHaveBeenCalledOnce();
        // Listener returns after the first fired callback, so only
        // ONE of the two should have fired (insertion order of the Map).
        expect(drawerCb).not.toHaveBeenCalled();
        overlay.unregister();
        drawer.unregister();
    });

    it('is idempotent — registering twice with the same instance leaves a single entry', () => {
        const cb = vi.fn();
        const stack = useEscapeStack('iso-test');
        stack.register(cb);
        stack.register(cb);
        expect(stack.getStackSize()).toBe(1);
        stack.unregister();
    });

    it('reports the stack size for body-scroll lock decisions', () => {
        const a = useEscapeStack('size-test');
        const b = useEscapeStack('size-test');
        expect(a.getStackSize()).toBe(0);
        a.register(() => {});
        b.register(() => {});
        expect(a.getStackSize()).toBe(2);
        a.unregister();
        expect(a.getStackSize()).toBe(1);
        b.unregister();
    });
});
