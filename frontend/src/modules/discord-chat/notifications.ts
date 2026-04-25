import { router } from '../../router';
import { useSettingsStore } from '../../stores/settingsStore';
import { useMuteStore } from './stores/muteStore';

/**
 * Desktop notification dispatcher. Wraps the Web Notification API so
 * stores don't reach into platform code directly, and centralises the
 * "should we actually fire?" gate (settings + mute + focus state).
 *
 * Permission is requested lazily — the first time a real-world ping
 * comes in after the user has opted in, we prompt the browser. Saves
 * us a permission popup on first paint that the user might just deny.
 */

export interface NotificationContext {
    channelId: string;
    /** Surface to scope the deep-link: 'dm' or the guild snowflake. */
    surface: 'dm' | string;
    title: string;
    body: string;
    /** Author avatar URL — shown as the OS notification icon. Optional;
     *  falls back to whatever the OS uses for unowned notifications. */
    iconUrl?: string | null;
    /** True if this message @-mentions the bot itself. Used to bypass
     *  the "channel muted" filter for guild mentions, matching Discord
     *  parity (mentions punch through mute). */
    isMention?: boolean;
}

function supported(): boolean {
    return typeof window !== 'undefined' && 'Notification' in window;
}

export async function ensureNotificationPermission(): Promise<boolean> {
    if (!supported()) return false;
    if (Notification.permission === 'granted') return true;
    if (Notification.permission === 'denied') return false;
    try {
        const result = await Notification.requestPermission();
        return result === 'granted';
    } catch {
        return false;
    }
}

function navigateTo(ctx: NotificationContext): void {
    const query: Record<string, string> = {};
    if (ctx.surface !== 'dm') query.guild = ctx.surface;
    query.channel = ctx.channelId;
    router.push({ path: '/admin/messages', query }).catch(() => {});
}

/**
 * Try to fire a notification for the given context. No-ops cheaply
 * when the API isn't available, the user disabled the setting, the
 * window has focus, or the channel is muted (mentions still notify
 * for guild channels).
 */
export function maybeNotify(ctx: NotificationContext): void {
    if (!supported()) return;
    if (Notification.permission !== 'granted') return;
    // The OS handles "is the window focused" suppression for some
    // platforms, but most browsers fire regardless — gate explicitly
    // so an active user isn't bombarded.
    if (typeof document !== 'undefined' && document.hasFocus()) return;

    const settings = useSettingsStore();
    if (!settings.desktopNotifications) return;

    const muteStore = useMuteStore();
    if (muteStore.isMuted(ctx.channelId) && !ctx.isMention) return;

    try {
        // `tag` collapses repeats from the same channel into a single
        // OS notification slot — otherwise a chatty conversation buries
        // the user in pings. `renotify: false` is the default but TS
        // typings don't list the field on every browser, so we cast.
        const n = new Notification(ctx.title, {
            body: ctx.body,
            icon: ctx.iconUrl ?? undefined,
            tag: ctx.channelId
        } as NotificationOptions);
        n.onclick = () => {
            try { window.focus(); } catch { /* some platforms forbid */ }
            navigateTo(ctx);
            n.close();
        };
    } catch {
        // Some browsers throw when offline / quota exceeded; we don't
        // care enough to surface that to the user.
    }
}
