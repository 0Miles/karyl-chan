/**
 * Regression tests for the popover engine — focused on the bugs the
 * recent review uncovered. We don't try to assert pixel-accurate
 * positions (Popper does that, and jsdom layout is fake anyway); we
 * test invariants that broke in those bugs.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createPopover } from './use-popover';

/**
 * jsdom doesn't ship a ResizeObserver. The popover engine uses one;
 * we shim it with a controllable spy so tests can assert when the
 * disconnect path runs.
 */
type ROCallback = (entries: ResizeObserverEntry[], observer: ResizeObserver) => void;
const observers: { cb: ROCallback; disconnected: boolean; observed: Element[] }[] = [];
class FakeResizeObserver {
    cb: ROCallback;
    constructor(cb: ROCallback) {
        this.cb = cb;
        observers.push({ cb, disconnected: false, observed: [] });
    }
    private rec() {
        return observers[observers.length - 1];
    }
    observe(el: Element) {
        this.rec().observed.push(el);
    }
    disconnect() {
        const rec = observers.find((r) => r.cb === this.cb);
        if (rec) rec.disconnected = true;
    }
    unobserve() {}
}

beforeEach(() => {
    observers.length = 0;
    (globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver =
        FakeResizeObserver as unknown as typeof ResizeObserver;
});

afterEach(() => {
    document.body.innerHTML = '';
});

function makePopoverEls() {
    const ref = document.createElement('button');
    const content = document.createElement('div');
    document.body.append(ref, content);
    return { ref, content };
}

describe('createPopover — ResizeObserver lifecycle (review issue #1)', () => {
    it('does not disconnect the ResizeObserver when setOptions changes a trigger-affecting option', () => {
        const { ref, content } = makePopoverEls();
        const inst = createPopover(ref, content, { trigger: 'click' });

        expect(observers).toHaveLength(1);
        const ro = observers[0];
        expect(ro.disconnected).toBe(false);
        expect(ro.observed).toContain(content);

        // Toggling closeOnContentClick previously fell into the
        // eventOptionsChanged branch → clearEventListeners() → RO
        // disconnect. With the fix, the RO stays alive.
        inst.setOptions({ closeOnContentClick: true });
        expect(ro.disconnected).toBe(false);

        // Trigger swap — same code path.
        inst.setOptions({ trigger: 'hover' });
        expect(ro.disconnected).toBe(false);

        // Only destroy() should release it.
        inst.destroy();
        expect(ro.disconnected).toBe(true);
    });

    it('keeps the ResizeObserver alive across updateReference', () => {
        const { ref, content } = makePopoverEls();
        const ref2 = document.createElement('span');
        document.body.appendChild(ref2);
        const inst = createPopover(ref, content);

        const ro = observers[0];
        inst.updateReference(ref2);
        expect(ro.disconnected).toBe(false);

        inst.destroy();
        expect(ro.disconnected).toBe(true);
    });

    it('does not create a second ResizeObserver per option change', () => {
        const { ref, content } = makePopoverEls();
        const inst = createPopover(ref, content);
        const before = observers.length;
        inst.setOptions({ trigger: 'hover' });
        inst.setOptions({ closeOnContentClick: true });
        expect(observers.length).toBe(before);
        inst.destroy();
    });
});

describe('createPopover — setOptions warnings (review issue #8)', () => {
    let warnSpy: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
        warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });
    afterEach(() => warnSpy.mockRestore());

    it('warns when raw setOptions receives wrapper-managed close options', () => {
        const { ref, content } = makePopoverEls();
        const inst = createPopover(ref, content);
        inst.setOptions({ closeOnEscape: false });
        expect(warnSpy).toHaveBeenCalled();
        const msg = String(warnSpy.mock.calls[0][0]);
        expect(msg).toMatch(/closeOnEscape|closeOnClickOutside/);
        inst.destroy();
    });

    it('does not warn for normal options', () => {
        const { ref, content } = makePopoverEls();
        const inst = createPopover(ref, content);
        inst.setOptions({ placement: 'top', offset: [0, 12] });
        expect(warnSpy).not.toHaveBeenCalled();
        inst.destroy();
    });
});

describe('createPopover — teleportTo warning (review issue #7)', () => {
    let warnSpy: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
        warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });
    afterEach(() => warnSpy.mockRestore());

    it('warns when teleport selector matches nothing', () => {
        const { ref, content } = makePopoverEls();
        const inst = createPopover(ref, content, {
            teleportTo: '#does-not-exist',
        });
        inst.show();
        expect(warnSpy).toHaveBeenCalled();
        const msg = String(warnSpy.mock.calls[0][0]);
        expect(msg).toMatch(/teleportTo/);
        inst.destroy();
    });

    it('does not warn when the selector resolves', () => {
        const target = document.createElement('div');
        target.id = 'teleport-target';
        document.body.appendChild(target);
        const { ref, content } = makePopoverEls();
        const inst = createPopover(ref, content, {
            teleportTo: '#teleport-target',
        });
        inst.show();
        expect(warnSpy).not.toHaveBeenCalled();
        inst.destroy();
    });
});

describe('createPopover — updateReference no longer leaks transitionend listener (review issue #6)', () => {
    it('does not register a transitionend listener on the content', () => {
        const { ref, content } = makePopoverEls();
        const ref2 = document.createElement('span');
        document.body.appendChild(ref2);
        // Spy on addEventListener so we can assert no transitionend was wired.
        const addSpy = vi.spyOn(content, 'addEventListener');
        const inst = createPopover(ref, content);
        inst.show();
        inst.updateReference(ref2);

        const transitionendCalls = addSpy.mock.calls.filter(
            (args) => args[0] === 'transitionend',
        );
        expect(transitionendCalls).toHaveLength(0);

        inst.destroy();
        addSpy.mockRestore();
    });
});
