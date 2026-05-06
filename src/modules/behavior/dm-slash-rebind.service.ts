/**
 * @deprecated M1-A1：dm-slash-rebind.service.ts 已 stub 化。
 * 整個 DM slash rebind 路徑將在 M1-C 重寫。
 * 目前匯出的函式為 no-op，讓 bot 能 boot。
 */

import type { Client } from "discord.js";

/**
 * @deprecated M1-A1 stub。M1-C 接管後重寫。
 * 暫時 no-op，不再掃描 behaviors 表或呼叫 Discord API。
 */
export async function rebindDmOnlyCommandsAsGlobal(
  _bot: Client,
): Promise<void> {
  // M1-A1: v2 破壞性遷移後，dm-slash-rebind 暫時停用。
  // M1-C 將重寫此路徑（基於 v2 behaviors schema + 新 CommandReconciler）。
}
