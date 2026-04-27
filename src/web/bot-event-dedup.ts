/**
 * In-memory dedup window for high-frequency BotEvent emissions.
 * Returns true if the key hasn't been seen within windowMs.
 *
 * State is purely in-memory — the window resets on process restart,
 * which is acceptable for rate-limit / flood-protection log suppression.
 */

const DEFAULT_WINDOW_MS = 60_000;
const MAX_KEYS = 1_000;

/** key → timestamp of last recorded emission */
const seen = new Map<string, number>();

export function shouldRecord(key: string, windowMs: number = DEFAULT_WINDOW_MS): boolean {
    const now = Date.now();
    const last = seen.get(key);
    if (last !== undefined && now - last < windowMs) {
        return false;
    }
    // Evict the oldest entry when the map hits the cap. This is O(1) for
    // Map iteration order (insertion order = FIFO), so eviction is always
    // the logically oldest key regardless of its timestamp.
    if (seen.size >= MAX_KEYS) {
        const oldestKey = seen.keys().next().value as string;
        seen.delete(oldestKey);
    }
    seen.set(key, now);
    return true;
}
