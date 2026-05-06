/**
 * @deprecated M1-A1：system-behavior.service.ts 已 stub 化。
 * 所有 system behavior dispatch（/manual、/break）將在 M1-C 重寫。
 *
 * 暫時 stub：
 *   - runManualForInteraction：回 ephemeral「v2 重構中，暫時不可用」
 *   - runBreakForInteraction：回 ephemeral「v2 重構中，暫時不可用」
 *   - runManualForMessage / runBreakForMessage：no-op（不回覆）
 */

import type {
  ChatInputCommandInteraction,
  Message as DjsMessage,
} from "discord.js";

const V2_STUB_MESSAGE =
  "⚙ 此功能正在 v2 重構中（M1-A1），暫時不可用。請等待 M1-C 完成。";

/** @deprecated M1-A1 stub。M1-C 接管後重寫。 */
export async function runManualForInteraction(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  await interaction
    .reply({ content: V2_STUB_MESSAGE, flags: "Ephemeral" })
    .catch(() => {});
}

/** @deprecated M1-A1 stub。M1-C 接管後重寫。 */
export async function runBreakForInteraction(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  await interaction
    .reply({ content: V2_STUB_MESSAGE, flags: "Ephemeral" })
    .catch(() => {});
}

/** @deprecated M1-A1 stub。M1-C 接管後重寫。 */
export async function runManualForMessage(
  _message: DjsMessage,
): Promise<void> {
  // M1-A1: no-op。M1-C 接管後重寫。
}

/** @deprecated M1-A1 stub。M1-C 接管後重寫。 */
export async function runBreakForMessage(_message: DjsMessage): Promise<void> {
  // M1-A1: no-op。M1-C 接管後重寫。
}
