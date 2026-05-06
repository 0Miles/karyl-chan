/**
 * @deprecated M1-A1：user-slash-behavior.service.ts 已 stub 化。
 * 整個 user slash behavior dispatch 路徑將在 M1-C 重寫。
 */

import type { ChatInputCommandInteraction } from "discord.js";
import { ChannelType } from "discord.js";

/**
 * @deprecated M1-A1 stub。M1-C 接管後重寫。
 * 暫回 false（未攔截），讓 interactionCreate 的後續路徑繼續。
 */
export async function dispatchUserSlashBehavior(
  _interaction: ChatInputCommandInteraction,
): Promise<boolean> {
  // M1-A1: v2 破壞性遷移後，user slash behavior dispatch 暫時停用。
  // M1-C 將重寫此路徑（基於 v2 behaviors schema + 新 runtime）。
  return false;
}

// Re-export so callers that import SLASH_BEHAVIOR_DM_ONLY still compile.
/** @deprecated M1-A1 stub。M1-C 接管後移除。 */
export const SLASH_BEHAVIOR_DM_ONLY = (
  interaction: ChatInputCommandInteraction,
): boolean => interaction.channel?.type === ChannelType.DM;
