import { describe, it, expect, vi, afterEach } from 'vitest';
import { useClickOutsideStack } from './use-click-outside-stack';

afterEach(() => {
    document.body.innerHTML = '';
});

function clickOn(el: Node) {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
}

describe('useClickOutsideStack', () => {
    it('closes a layer when the click lands outside it', () => {
        const inside = document.createElement('div');
        const outside = document.createElement('div');
        document.body.appendChild(inside);
        document.body.appendChild(outside);

        const close = vi.fn();
        const layer = useClickOutsideStack();
        layer.register({
            shouldIgnore: () => false,
            isInside: (n) => inside.contains(n),
            close
        });

        clickOn(outside);
        expect(close).toHaveBeenCalledOnce();
        layer.unregister();
    });

    it('keeps the layer open when the click is inside it', () => {
        const inside = document.createElement('div');
        document.body.appendChild(inside);

        const close = vi.fn();
        const layer = useClickOutsideStack();
        layer.register({
            shouldIgnore: () => false,
            isInside: (n) => inside.contains(n),
            close
        });

        clickOn(inside);
        expect(close).not.toHaveBeenCalled();
        layer.unregister();
    });

    it('closes nested outer layers but keeps inner ones when click is inside the inner', () => {
        const outer = document.createElement('div');
        const inner = document.createElement('div');
        outer.appendChild(inner);
        document.body.appendChild(outer);

        const closeOuter = vi.fn();
        const closeInner = vi.fn();
        const outerLayer = useClickOutsideStack();
        const innerLayer = useClickOutsideStack();
        outerLayer.register({
            shouldIgnore: () => false,
            isInside: (n) => outer.contains(n),
            close: closeOuter
        });
        innerLayer.register({
            shouldIgnore: () => false,
            isInside: (n) => inner.contains(n),
            close: closeInner
        });

        clickOn(inner);
        // Top of stack is `inner`; click lands inside it → walk halts,
        // outer is preserved (it's an ancestor).
        expect(closeInner).not.toHaveBeenCalled();
        expect(closeOuter).not.toHaveBeenCalled();
        outerLayer.unregister();
        innerLayer.unregister();
    });

    it('closes both layers when click is outside both', () => {
        const a = document.createElement('div');
        const b = document.createElement('div');
        const outside = document.createElement('div');
        document.body.appendChild(a);
        document.body.appendChild(b);
        document.body.appendChild(outside);

        const closeA = vi.fn();
        const closeB = vi.fn();
        const layerA = useClickOutsideStack();
        const layerB = useClickOutsideStack();
        layerA.register({
            shouldIgnore: () => false,
            isInside: (n) => a.contains(n),
            close: closeA
        });
        layerB.register({
            shouldIgnore: () => false,
            isInside: (n) => b.contains(n),
            close: closeB
        });

        clickOn(outside);
        expect(closeB).toHaveBeenCalledOnce();
        expect(closeA).toHaveBeenCalledOnce();
        layerA.unregister();
        layerB.unregister();
    });

    it('skips a layer when shouldIgnore returns true (e.g. the click that just opened it)', () => {
        const outside = document.createElement('div');
        document.body.appendChild(outside);
        const close = vi.fn();
        const layer = useClickOutsideStack();
        layer.register({
            shouldIgnore: () => true,
            isInside: () => false,
            close
        });
        clickOn(outside);
        expect(close).not.toHaveBeenCalled();
        layer.unregister();
    });

    it('re-registering the same instance moves it to the top of the stack', () => {
        const aEl = document.createElement('div');
        const bEl = document.createElement('div');
        document.body.appendChild(aEl);
        document.body.appendChild(bEl);

        const closeA = vi.fn();
        const closeB = vi.fn();
        const layerA = useClickOutsideStack();
        const layerB = useClickOutsideStack();
        layerA.register({
            shouldIgnore: () => false,
            isInside: (n) => aEl.contains(n),
            close: closeA
        });
        layerB.register({
            shouldIgnore: () => false,
            isInside: (n) => bEl.contains(n),
            close: closeB
        });
        // Re-register A — now A is on top, then B (but order matters: top-down).
        // After re-register: stack = [B, A] (A pushed last → top).
        layerA.register({
            shouldIgnore: () => false,
            isInside: (n) => aEl.contains(n),
            close: closeA
        });
        // Click inside B: walking top-down, A first (outside B → close A),
        // then B (inside → break). closeA fires, closeB doesn't.
        clickOn(bEl);
        expect(closeA).toHaveBeenCalledOnce();
        expect(closeB).not.toHaveBeenCalled();
        layerA.unregister();
        layerB.unregister();
    });

    it('does nothing when no layers are registered', () => {
        const el = document.createElement('div');
        document.body.appendChild(el);
        expect(() => clickOn(el)).not.toThrow();
    });

    it('ignores clicks on detached nodes', () => {
        const detached = document.createElement('div');
        // Not appended to body → handler bails before walking the stack.
        const close = vi.fn();
        const layer = useClickOutsideStack();
        layer.register({
            shouldIgnore: () => false,
            isInside: () => false,
            close
        });
        clickOn(detached);
        expect(close).not.toHaveBeenCalled();
        layer.unregister();
    });
});
