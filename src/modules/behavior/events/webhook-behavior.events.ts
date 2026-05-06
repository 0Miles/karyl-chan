/**
 * @deprecated M1-A1：webhook-behavior.events.ts 已 stub 化。
 * 整個 messageCreate → behavior dispatch 路徑將在 M1-C 重寫。
 *
 * registerWebhookBehaviorEvents 暫時不掛任何 messageCreate 監聽器，
 * 讓 bot 能 boot，behavior 功能由 M1-C 接管。
 */

import type { Client } from "discord.js";

// 保留 BEHAVIOR_END_TOKEN 匯出，避免其他有引用的地方 compile 失敗。
/** @deprecated M1-A1 stub。M1-C 接管後確認是否保留（A-schema R-3：保留）。 */
export const BEHAVIOR_END_TOKEN = "[BEHAVIOR:END]";

/**
 * @deprecated M1-A1 stub。
 * 暫時不掛任何 messageCreate 監聽器。M1-C 接管後重寫。
 */
export function registerWebhookBehaviorEvents(_client: Client): void {
  // M1-A1: v2 破壞性遷移後，webhook behavior messageCreate dispatch 暫時停用。
  // M1-C 將重寫此函式（基於 v2 behaviors schema + 新 dispatcher runtime）。
}
