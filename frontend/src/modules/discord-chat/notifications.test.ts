import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import { useSettingsStore } from '../../stores/settingsStore';
import { useMuteStore } from './stores/muteStore';
import { ensureNotificationPermission, maybeNotify } from './notifications';

/**
 * Mock setup: maybeNotify reads from `window.Notification` (constructor
 * + .permission) and `document.hasFocus()`. We swap both for stubs we
 * can introspect, then restore in afterEach.
 */
let originalNotification: typeof window.Notification | undefined;
let originalHasFocus: typeof document.hasFocus;
const NotificationCtor = vi.fn();

function installNotificationMock(permission: NotificationPermission, requestResult: NotificationPermission = 'granted') {
    originalNotification = window.Notification;
    NotificationCtor.mockReset();
    // Spread out the static `permission` and `requestPermission` we
    // depend on; the constructor is the spy itself.
    const stub = NotificationCtor as unknown as {
        permission: NotificationPermission;
        requestPermission: () => Promise<NotificationPermission>;
    };
    Object.defineProperty(stub, 'permission', { configurable: true, get: () => permission });
    stub.requestPermission = vi.fn(async () => requestResult);
    (window as unknown as { Notification: unknown }).Notification = stub;
}

function setFocus(focused: boolean) {
    originalHasFocus = document.hasFocus;
    document.hasFocus = vi.fn(() => focused);
}

beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
});

afterEach(() => {
    if (originalNotification !== undefined) {
        (window as unknown as { Notification: unknown }).Notification = originalNotification;
        originalNotification = undefined;
    }
    if (originalHasFocus) {
        document.hasFocus = originalHasFocus;
    }
});

describe('ensureNotificationPermission', () => {
    it('returns true when permission already granted', async () => {
        installNotificationMock('granted');
        expect(await ensureNotificationPermission()).toBe(true);
    });

    it('returns false when permission already denied (no prompt)', async () => {
        installNotificationMock('denied');
        const stub = window.Notification as unknown as { requestPermission: ReturnType<typeof vi.fn> };
        expect(await ensureNotificationPermission()).toBe(false);
        expect(stub.requestPermission).not.toHaveBeenCalled();
    });

    it('prompts the user when permission is "default" and reflects the result', async () => {
        installNotificationMock('default', 'granted');
        const stub = window.Notification as unknown as { requestPermission: ReturnType<typeof vi.fn> };
        expect(await ensureNotificationPermission()).toBe(true);
        expect(stub.requestPermission).toHaveBeenCalledOnce();
    });

    it('returns false when the user denies the prompt', async () => {
        installNotificationMock('default', 'denied');
        expect(await ensureNotificationPermission()).toBe(false);
    });
});

describe('maybeNotify gating', () => {
    function ctx(overrides: Partial<Parameters<typeof maybeNotify>[0]> = {}): Parameters<typeof maybeNotify>[0] {
        return {
            channelId: 'c-1',
            surface: 'dm',
            title: 'Alice',
            body: 'hello',
            ...overrides
        };
    }

    it('fires when settings on, permission granted, window unfocused, channel unmuted', () => {
        installNotificationMock('granted');
        setFocus(false);
        const settings = useSettingsStore();
        settings.desktopNotifications = true;
        maybeNotify(ctx());
        expect(NotificationCtor).toHaveBeenCalledOnce();
        // Title is the first ctor arg, options is the second.
        expect(NotificationCtor.mock.calls[0][0]).toBe('Alice');
        const opts = NotificationCtor.mock.calls[0][1] as { body: string; tag: string };
        expect(opts.body).toBe('hello');
        expect(opts.tag).toBe('c-1');
    });

    it('does NOT fire when window has focus', () => {
        installNotificationMock('granted');
        setFocus(true);
        const settings = useSettingsStore();
        settings.desktopNotifications = true;
        maybeNotify(ctx());
        expect(NotificationCtor).not.toHaveBeenCalled();
    });

    it('does NOT fire when desktopNotifications setting is off', () => {
        installNotificationMock('granted');
        setFocus(false);
        const settings = useSettingsStore();
        settings.desktopNotifications = false;
        maybeNotify(ctx());
        expect(NotificationCtor).not.toHaveBeenCalled();
    });

    it('does NOT fire when permission is not granted', () => {
        installNotificationMock('default');
        setFocus(false);
        const settings = useSettingsStore();
        settings.desktopNotifications = true;
        maybeNotify(ctx());
        expect(NotificationCtor).not.toHaveBeenCalled();
    });

    it('mute level "none" suppresses even mentions', () => {
        installNotificationMock('granted');
        setFocus(false);
        const settings = useSettingsStore();
        settings.desktopNotifications = true;
        const mute = useMuteStore();
        mute.setLevel('c-1', 'none');
        maybeNotify(ctx({ isMention: true }));
        expect(NotificationCtor).not.toHaveBeenCalled();
    });

    it('mute level "mentions-only" suppresses non-mentions', () => {
        installNotificationMock('granted');
        setFocus(false);
        const settings = useSettingsStore();
        settings.desktopNotifications = true;
        const mute = useMuteStore();
        mute.setLevel('c-1', 'mentions-only');
        maybeNotify(ctx({ isMention: false }));
        expect(NotificationCtor).not.toHaveBeenCalled();
    });

    it('mute level "mentions-only" allows mentions through', () => {
        installNotificationMock('granted');
        setFocus(false);
        const settings = useSettingsStore();
        settings.desktopNotifications = true;
        const mute = useMuteStore();
        mute.setLevel('c-1', 'mentions-only');
        maybeNotify(ctx({ isMention: true }));
        expect(NotificationCtor).toHaveBeenCalledOnce();
    });

    it('swallows constructor failures (offline / quota exhausted)', () => {
        installNotificationMock('granted');
        setFocus(false);
        const settings = useSettingsStore();
        settings.desktopNotifications = true;
        NotificationCtor.mockImplementation(() => { throw new Error('boom'); });
        // The contract is that maybeNotify never escalates platform
        // failures into the caller's flow.
        expect(() => maybeNotify(ctx())).not.toThrow();
    });
});
