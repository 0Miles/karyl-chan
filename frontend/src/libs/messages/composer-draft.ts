/**
 * Per-channel composer draft persistence. Saves the editor's text
 * representation (the same form readEditorText/buildEditorFragment
 * round-trip through, so mentions and custom emojis survive a reload)
 * to localStorage so users don't lose half-typed messages when they
 * switch channels or refresh the tab.
 *
 * Drafts are scoped by channel id; missing channelIds (e.g. the
 * "select a chat" empty state) are treated as no-op so we never write
 * a draft against a meaningless key.
 */

const PREFIX = 'karyl-composer-draft:';
const MAX_LEN = 8000;

function key(channelId: string): string {
    return `${PREFIX}${channelId}`;
}

export function loadDraft(channelId: string | null | undefined): string {
    if (!channelId) return '';
    try {
        return localStorage.getItem(key(channelId)) ?? '';
    } catch {
        return '';
    }
}

export function saveDraft(channelId: string | null | undefined, text: string): void {
    if (!channelId) return;
    try {
        const trimmed = text.trim();
        if (!trimmed) {
            localStorage.removeItem(key(channelId));
            return;
        }
        // Truncate absurd inputs so a runaway paste can't fill quota for
        // every other key. Discord's 2000-char cap means anything over a
        // few KB is already lost on send anyway.
        const value = text.length > MAX_LEN ? text.slice(0, MAX_LEN) : text;
        localStorage.setItem(key(channelId), value);
    } catch {
        // Quota exceeded or storage disabled (private mode). Drafts are
        // a UX nicety — silently giving up is better than throwing into
        // the input handler.
    }
}

export function clearDraft(channelId: string | null | undefined): void {
    if (!channelId) return;
    try {
        localStorage.removeItem(key(channelId));
    } catch {
        // ignore
    }
}
