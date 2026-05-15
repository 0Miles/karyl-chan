/**
 * Regression for the emoji-picker mis-anchor bug. The previous design
 * registered each row's react-button into a parent Map<messageId,
 * button> via onMounted, which silently broke under
 * vue-virtual-scroller's view recycling — the component instance is
 * reused for different messages without re-firing onMounted.
 *
 * The fix moves the anchor source onto the click event itself
 * (`ev.currentTarget`), so this test asserts:
 *   1. `react` emits with the actual button element clicked.
 *   2. When the component's `message` prop is later swapped (simulating
 *      a DynamicScroller view recycle), a second click STILL fires with
 *      the same — and current — button DOM, no stale state.
 *   3. No `register-react-button` / `unregister-react-button` events
 *      exist anymore (so callers can't accidentally fall back to a
 *      stale-anchor Map).
 */
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import MessageActionBar from './MessageActionBar.vue';
import type { Message } from '../../libs/messages/types';

const i18n = createI18n({
    legacy: false,
    locale: 'en',
    messages: {
        en: {
            messages: {
                react: 'React',
                reply: 'Reply',
                edit: 'Edit',
                copyLink: 'Copy link',
                copyLinkDone: 'Copied',
                delete: 'Delete',
                deleteNoConfirm: 'Delete (no confirm)',
                deleteShiftConfirm: 'Delete (shift to skip confirm)',
            },
        },
    },
});

function makeMessage(id: string): Message {
    return {
        id,
        channelId: 'c1',
        author: { id: 'u1', username: 'u', displayName: 'u', avatarUrl: null },
        content: '',
        timestamp: 0,
        reactions: [],
    } as unknown as Message;
}

function mountActionBar(messageId: string) {
    return mount(MessageActionBar, {
        global: { plugins: [i18n] },
        props: {
            message: makeMessage(messageId),
            isOwn: false,
            shiftHeld: false,
            reacting: false,
            copied: false,
        },
    });
}

describe('MessageActionBar — react event carries the live button DOM', () => {
    it("emits 'react' with the clicked button element", async () => {
        const wrapper = mountActionBar('msg-1');
        const reactBtn = wrapper.find('button[title="React"]');
        await reactBtn.trigger('click');

        const events = wrapper.emitted('react');
        expect(events).toBeDefined();
        expect(events!).toHaveLength(1);
        const payload = events![0][0] as HTMLButtonElement;
        expect(payload).toBeInstanceOf(HTMLButtonElement);
        expect(payload).toBe(reactBtn.element);
    });

    it('still emits the SAME (current) button after a message-prop swap (DynamicScroller recycle)', async () => {
        const wrapper = mountActionBar('msg-A');
        const buttonBefore = wrapper.find('button[title="React"]').element;
        await wrapper.find('button[title="React"]').trigger('click');

        // Simulate the scroller recycling this view for a different
        // message — same component instance, new prop.
        await wrapper.setProps({ message: makeMessage('msg-B') });

        const buttonAfter = wrapper.find('button[title="React"]').element;
        // DOM is the same node — that's the point of view recycling.
        expect(buttonAfter).toBe(buttonBefore);

        await wrapper.find('button[title="React"]').trigger('click');
        const events = wrapper.emitted('react');
        expect(events).toHaveLength(2);
        // Both clicks carry the live button DOM, not a stale Map lookup.
        expect(events![0][0]).toBe(buttonBefore);
        expect(events![1][0]).toBe(buttonAfter);
    });

    it('does not emit the old register/unregister-react-button events', () => {
        const wrapper = mountActionBar('msg-1');
        wrapper.unmount();
        expect(wrapper.emitted('register-react-button')).toBeUndefined();
        expect(wrapper.emitted('unregister-react-button')).toBeUndefined();
    });
});
