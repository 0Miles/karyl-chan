import type { ComposerSuggestionTrigger } from './types';

/**
 * Look at the text + cursor and return the active trigger (e.g. `@bob`) if
 * one of `chars` was typed at the start of a word and the user hasn't moved
 * past whitespace yet. Returns null when the cursor isn't inside a trigger.
 */
export function findActiveTrigger(text: string, cursor: number, chars: string[]): ComposerSuggestionTrigger | null {
    if (chars.length === 0) return null;
    for (let i = cursor - 1; i >= 0; i--) {
        const c = text[i];
        if (/\s/.test(c)) return null; // hit whitespace before any trigger
        if (chars.includes(c)) {
            // Trigger is only valid when at start-of-text or after whitespace,
            // otherwise it's part of an existing word (e.g. `email@domain`).
            if (i === 0 || /\s/.test(text[i - 1])) {
                return {
                    char: c,
                    query: text.slice(i + 1, cursor),
                    range: [i, cursor]
                };
            }
            return null;
        }
    }
    return null;
}
