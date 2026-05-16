import type { BehaviorMessagePatternKind } from "./models/behavior.model.js";

/**
 * Evaluate whether a DM message body matches a message_pattern trigger.
 * Pure / synchronous; safe to call inside hot path of messageCreate.
 *
 * v2 schema 拆解：triggerType='message_pattern' + messagePatternKind（startswith/endswith/regex）
 *   - triggerType='slash_command' 從 interactionCreate 路徑處理，不走此函式。
 *   - 此函式只處理 messagePatternKind 的三種情況。
 *
 * Regex patterns are compiled once and cached — every DM message that
 * passes through the matcher would otherwise pay an O(N_patterns)
 * compilation tax even though the patterns are static between writes
 * to the behaviors table. The cache is keyed by source string;
 * updating a behavior's pattern produces a new key so a stale entry
 * is never reused.
 *
 * NB the ReDoS surface is bounded by the trust model: only admin
 * operators with `behavior.manage` can author regex patterns, and
 * they're authoring against their own bot. A catastrophic
 * backtracking pattern is a self-DoS, not an external attack.
 */
const regexCache = new Map<string, RegExp | null>();

function getRegex(patternValue: string): RegExp | null {
  const cached = regexCache.get(patternValue);
  if (cached !== undefined) return cached;
  let compiled: RegExp | null;
  try {
    compiled = new RegExp(patternValue);
  } catch {
    compiled = null;
  }
  regexCache.set(patternValue, compiled);
  return compiled;
}

export function matchesTrigger(
  patternKind: BehaviorMessagePatternKind,
  patternValue: string,
  content: string,
): boolean {
  if (patternKind === "startswith") {
    return content.startsWith(patternValue);
  }
  if (patternKind === "endswith") {
    return content.endsWith(patternValue);
  }
  if (patternKind === "regex") {
    const re = getRegex(patternValue);
    return re !== null && re.test(content);
  }
  return false;
}
