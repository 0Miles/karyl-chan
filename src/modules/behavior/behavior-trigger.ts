import type { BehaviorMessagePatternKind } from "./models/behavior.model.js";

/**
 * Evaluate whether a DM message body matches a message_pattern trigger.
 * Pure / synchronous; safe to call inside hot path of messageCreate.
 *
 * v2 schema 拆解：triggerType='message_pattern' + messagePatternKind（startswith/endswith/regex）
 *   - triggerType='slash_command' 從 interactionCreate 路徑處理，不走此函式。
 *   - 此函式只處理 messagePatternKind 的三種情況。
 *
 * M1-C 接管前，此函式暫時未被主路徑呼叫（webhook-behavior.events.ts 已 stub）。
 * 保留型別正確版本供 M1-C 重寫 dispatcher 使用。
 */
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
    try {
      return new RegExp(patternValue).test(content);
    } catch {
      return false;
    }
  }
  return false;
}

