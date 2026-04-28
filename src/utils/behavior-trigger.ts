import type { BehaviorTriggerType } from '../models/behavior.model.js';

/**
 * Evaluate whether a DM message body matches a behavior trigger.
 * Pure / synchronous; safe to call inside hot path of messageCreate.
 *
 * Matching rules:
 *   - 'startswith' / 'endswith': literal, case-sensitive substring at
 *     the head/tail of `content`.
 *   - 'regex': compiled per-call against `triggerValue`. Unanchored —
 *     callers wanting full-line match should write `^…$` themselves.
 *     Invalid patterns are guarded: we return false (no match) and
 *     leave it to upstream validation (route layer rejects invalid
 *     regex on save) to surface a fix.
 */
export function matchesTrigger(
    triggerType: BehaviorTriggerType,
    triggerValue: string,
    content: string
): boolean {
    if (triggerType === 'startswith') {
        return content.startsWith(triggerValue);
    }
    if (triggerType === 'endswith') {
        return content.endsWith(triggerValue);
    }
    if (triggerType === 'regex') {
        try {
            return new RegExp(triggerValue).test(content);
        } catch {
            return false;
        }
    }
    return false;
}

/**
 * Human-readable preview of a trigger for /manual output and admin UI
 * sidebar summaries. Truncates the value at 60 chars so a long regex
 * doesn't blow up an embed field.
 */
export function describeTrigger(triggerType: BehaviorTriggerType, triggerValue: string): string {
    const truncated = triggerValue.length > 60 ? `${triggerValue.slice(0, 57)}…` : triggerValue;
    if (triggerType === 'startswith') return `開頭：${truncated}`;
    if (triggerType === 'endswith') return `結尾：${truncated}`;
    return `regex：${truncated}`;
}
