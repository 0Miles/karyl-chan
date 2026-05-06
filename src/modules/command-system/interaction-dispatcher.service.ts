/**
 * command-system/interaction-dispatcher.service.ts — M1-C1 骨架實作
 *
 * InteractionDispatcher：統一的 Discord interactionCreate 入口。
 * 取代 main.ts 中的多重 try 分叉（system / user-slash / in-process / plugin）。
 *
 * 對齊 C-runtime §4.1 派發路徑：
 *   [1] behaviors（slash_command trigger）── source ∈ {system, custom, plugin}
 *   [2] plugin_commands（軌三）── 走 plugin-interaction-dispatch.service.ts
 *   [3] in-process registry（builtin-features）── 保留
 *   fallback：claimed=false，由 main.ts log warn
 *
 * 狀態：dormant（M1-C1）。
 *   - 所有真實邏輯已實作。
 *   - 不從 main.ts import，不掛任何 interactionCreate listener。
 *
 * M1-C2 接線時：
 *   1. 在 main.ts 的 interactionCreate handler 中呼叫 dispatcher.dispatch(interaction)
 *   2. 移除舊 dispatchUserSlashBehavior + runManualForInteraction + runBreakForInteraction 呼叫
 *   3. system behavior（source='system'）中的 stub 替換為真實實作（見下方 TODO）
 */

import {
  type Interaction,
  type ChatInputCommandInteraction,
} from "discord.js";
import {
  Behavior,
  type BehaviorRow,
} from "../behavior/models/behavior.model.js";
import { botEventLog } from "../bot-events/bot-event-log.js";
import { dispatchInteractionToPlugin } from "../plugin-system/plugin-interaction-dispatch.service.js";
import { dispatchInProcessInteraction } from "../builtin-features/in-process-command-registry.service.js";
import type { DispatchOutcome } from "./types.js";
import type { WebhookForwarder } from "./webhook-forwarder.service.js";

// ── NotImplementedError（system behavior stub 用）────────────────────────────

export class NotImplementedError extends Error {
  constructor(feature: string) {
    super(`M1-C1 dormant: ${feature} 尚未實作，M1-C2 接線時補上`);
    this.name = "NotImplementedError";
  }
}

// ── Discord webhook payload 建構（slash command → webhook body）─────────────

/**
 * 從 ChatInputCommandInteraction 建構 behavior webhook POST body。
 * 對齊 RESTPostAPIWebhookWithTokenJSONBody 形狀（C-runtime §7.1）。
 */
function buildWebhookPayload(
  interaction: ChatInputCommandInteraction,
): Record<string, unknown> {
  return {
    // 將 interaction 資訊對映到 webhook-compatible content
    content: interaction.commandName,
    // 附加 interaction 元資訊供 plugin 使用
    username: interaction.user.username,
    // 自訂欄位（behavior webhook 可忽略）
    _meta: {
      interaction_id: interaction.id,
      interaction_token: interaction.token,
      application_id: interaction.applicationId,
      command_name: interaction.commandName,
      guild_id: interaction.guildId,
      channel_id: interaction.channelId,
      user: {
        id: interaction.user.id,
        username: interaction.user.username,
        global_name: interaction.user.globalName,
      },
      locale: interaction.locale ?? null,
    },
  };
}

// ── InteractionDispatcher ────────────────────────────────────────────────────

export class InteractionDispatcher {
  constructor(private readonly forwarder: WebhookForwarder) {}

  /**
   * 統一 interactionCreate 入口。
   * 第一個 claim 即停。fallback：claimed=false 由 main.ts log warn。
   */
  async dispatch(interaction: Interaction): Promise<DispatchOutcome> {
    // ─ Layer 1：behaviors 表（slash_command trigger）
    if (interaction.isChatInputCommand()) {
      const outcome = await this.dispatchBehaviorLayer(interaction);
      if (outcome.claimed) return outcome;
    }

    // ─ Layer 2：plugin_commands（軌三）── 走既有 dispatchInteractionToPlugin
    try {
      const claimed = await dispatchInteractionToPlugin(interaction);
      if (claimed) {
        return { claimed: true, claimedBy: "plugin_command" };
      }
    } catch (err) {
      botEventLog.record(
        "error",
        "bot",
        `interaction-dispatcher: plugin_command layer 拋出例外：${err instanceof Error ? err.message : String(err)}`,
        { commandName: interaction.isChatInputCommand() ? interaction.commandName : undefined },
      );
      // layer 2 失敗不短路，繼續嘗試 layer 3
    }

    // ─ Layer 3：in-process registry（builtin-features）
    try {
      const claimed = await dispatchInProcessInteraction(interaction);
      if (claimed) {
        return { claimed: true, claimedBy: "in_process" };
      }
    } catch (err) {
      botEventLog.record(
        "error",
        "bot",
        `interaction-dispatcher: in-process layer 拋出例外：${err instanceof Error ? err.message : String(err)}`,
        { commandName: interaction.isChatInputCommand() ? interaction.commandName : undefined },
      );
    }

    // ─ Fallback：未被任何層 claim
    return {
      claimed: false,
      reason: "unknown_command",
    };
  }

  // ── Layer 1：behaviors 表 slash dispatch ──────────────────────────────────

  private async dispatchBehaviorLayer(
    interaction: ChatInputCommandInteraction,
  ): Promise<DispatchOutcome> {
    let behaviorRow: BehaviorRow | null = null;
    try {
      // 查找 behaviors 表中 triggerType='slash_command' + slashCommandName 匹配的 row
      const row = await Behavior.findOne({
        where: {
          triggerType: "slash_command",
          slashCommandName: interaction.commandName,
          enabled: true,
        },
      });
      if (!row) return { claimed: false };

      behaviorRow = {
        id: row.getDataValue("id") as number,
        title: row.getDataValue("title") as string,
        description: (row.getDataValue("description") as string) ?? "",
        enabled: !!row.getDataValue("enabled"),
        sortOrder: row.getDataValue("sortOrder") as number,
        stopOnMatch: !!row.getDataValue("stopOnMatch"),
        forwardType: row.getDataValue("forwardType") as BehaviorRow["forwardType"],
        source: row.getDataValue("source") as BehaviorRow["source"],
        triggerType: row.getDataValue("triggerType") as BehaviorRow["triggerType"],
        messagePatternKind:
          (row.getDataValue("messagePatternKind") as BehaviorRow["messagePatternKind"]) ?? null,
        messagePatternValue:
          (row.getDataValue("messagePatternValue") as string | null) ?? null,
        slashCommandName:
          (row.getDataValue("slashCommandName") as string | null) ?? null,
        slashCommandDescription:
          (row.getDataValue("slashCommandDescription") as string | null) ?? null,
        scope: row.getDataValue("scope") as BehaviorRow["scope"],
        integrationTypes: row.getDataValue("integrationTypes") as string,
        contexts: row.getDataValue("contexts") as string,
        placementGuildId:
          (row.getDataValue("placementGuildId") as string | null) ?? null,
        placementChannelId:
          (row.getDataValue("placementChannelId") as string | null) ?? null,
        audienceKind: row.getDataValue("audienceKind") as BehaviorRow["audienceKind"],
        audienceUserId:
          (row.getDataValue("audienceUserId") as string | null) ?? null,
        audienceGroupName:
          (row.getDataValue("audienceGroupName") as string | null) ?? null,
        webhookUrl: (row.getDataValue("webhookUrl") as string | null) ?? null,
        webhookSecret:
          (row.getDataValue("webhookSecret") as string | null) ?? null,
        webhookAuthMode:
          (row.getDataValue("webhookAuthMode") as BehaviorRow["webhookAuthMode"]) ?? null,
        pluginId: (row.getDataValue("pluginId") as number | null) ?? null,
        pluginBehaviorKey:
          (row.getDataValue("pluginBehaviorKey") as string | null) ?? null,
        systemKey:
          (row.getDataValue("systemKey") as BehaviorRow["systemKey"]) ?? null,
      };
    } catch (err) {
      botEventLog.record(
        "error",
        "bot",
        `interaction-dispatcher: behaviors 表查詢失敗：${err instanceof Error ? err.message : String(err)}`,
        { commandName: interaction.commandName },
      );
      // C-runtime §4.3：behaviors 查詢失敗不短路，繼續嘗試下一層
      return { claimed: false };
    }

    if (!behaviorRow) return { claimed: false };

    const source = behaviorRow.source;

    if (source === "system") {
      return this.dispatchSystemBehavior(interaction, behaviorRow);
    }

    if (source === "custom" || source === "plugin") {
      return this.dispatchWebhookBehavior(interaction, behaviorRow);
    }

    return { claimed: false };
  }

  // ── source=system dispatch ────────────────────────────────────────────────

  /**
   * system behavior（admin-login/manual/break）dispatch。
   *
   * M0-FROZEN 註明 system seed 由 M1-C 重新設計。
   * M1-C1：預留 stub，拋出 NotImplementedError 以明確標示「需要 M1-C2 補」。
   * M1-C2 接線時：根據 behaviorRow.systemKey 呼叫對應的 system handler。
   *
   * 注意：此方法仍回傳 claimed=true（已宣告擁有），避免漏到後面的 layer。
   */
  private async dispatchSystemBehavior(
    interaction: ChatInputCommandInteraction,
    behaviorRow: BehaviorRow,
  ): Promise<DispatchOutcome> {
    // M1-C1 stub：system behavior 接線等 M1-C2
    // 回覆 ephemeral 讓使用者知道功能暫時不可用
    const systemKey = behaviorRow.systemKey ?? "(unknown)";
    botEventLog.record(
      "warn",
      "bot",
      `interaction-dispatcher: system behavior '${systemKey}' 尚未在 M1-C1 實作（等 M1-C2 接線）`,
      { commandName: interaction.commandName, systemKey },
    );
    await interaction
      .reply({
        content: "⚙ 此系統指令正在 v2 重構中（M1-C1），暫時不可用。",
        ephemeral: true,
      })
      .catch(() => {});
    return { claimed: true, claimedBy: "behavior_system" };
  }

  // ── source=custom / source=plugin dispatch（webhook）────────────────────

  /**
   * custom/plugin behavior dispatch：建構 payload 後呼叫 WebhookForwarder。
   */
  private async dispatchWebhookBehavior(
    interaction: ChatInputCommandInteraction,
    behaviorRow: BehaviorRow,
  ): Promise<DispatchOutcome> {
    const payload = buildWebhookPayload(interaction);

    // Defer reply（slash command 需要在 3s 內 ack）
    try {
      await interaction.deferReply({ ephemeral: true });
    } catch {
      return { claimed: true, claimedBy: behaviorRow.source === "custom" ? "behavior_custom" : "behavior_plugin" };
    }

    try {
      const result = await this.forwarder.forward(
        behaviorRow,
        payload as Record<string, unknown>,
      );

      if (!result.ok) {
        await interaction
          .editReply({ content: `⚠ Behavior 轉發失敗：${result.error ?? "未知錯誤"}` })
          .catch(() => {});
        return {
          claimed: true,
          claimedBy: behaviorRow.source === "custom" ? "behavior_custom" : "behavior_plugin",
        };
      }

      if (result.relayContent) {
        await interaction.editReply({ content: result.relayContent }).catch(() => {});
      } else {
        // 無回覆內容則刪除 deferred reply
        await interaction.deleteReply().catch(() => {});
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await interaction
        .editReply({ content: `⚠ 內部錯誤：${msg}` })
        .catch(() => {});
      botEventLog.record(
        "error",
        "bot",
        `interaction-dispatcher: webhook behavior ${behaviorRow.id} 拋出例外：${msg}`,
        { behaviorId: behaviorRow.id, commandName: interaction.commandName },
      );
    }

    return {
      claimed: true,
      claimedBy: behaviorRow.source === "custom" ? "behavior_custom" : "behavior_plugin",
    };
  }
}
