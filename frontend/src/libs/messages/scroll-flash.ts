/**
 * Briefly highlights a message row so the user's eye catches the
 * destination of a scroll-to action (message-link click, reply-jump,
 * etc). Adds the `msg-flash` class; the accompanying CSS keyframe
 * fades the background from a tint back to transparent. The class is
 * cleared after the animation so subsequent flashes of the same row
 * actually restart instead of being swallowed as a no-op.
 */
export function flashMessage(messageId: string): void {
    const el = document.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(messageId)}"]`);
    if (!el) return;
    // Remove-then-reflow-then-add restarts the animation when the row
    // is already flashing from an earlier jump.
    el.classList.remove('msg-flash');
    void el.offsetWidth;
    el.classList.add('msg-flash');
    window.setTimeout(() => el.classList.remove('msg-flash'), 1200);
}
