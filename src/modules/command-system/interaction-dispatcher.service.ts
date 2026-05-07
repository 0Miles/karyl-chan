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
  EmbedBuilder,
} from "discord.js";
import {
  Behavior,
  type BehaviorRow,
} from "../behavior/models/behavior.model.js";
import { botEventLog } from "../bot-events/bot-event-log.js";
import { dispatchInteractionToPlugin } from "../plugin-system/plugin-interaction-dispatch.service.js";
import { dispatchInProcessInteraction } from "../builtin-features/in-process-command-registry.service.js";
import { issueLoginLinkForInteraction } from "../admin/admin-login.service.js";
import { endSession } from "../behavior/models/behavior-session.model.js";
import type { DispatchOutcome } from "./types.js";
import type { WebhookForwarder } from "./webhook-forwarder.service.js";
import { collectApplicableBehaviorsForUser } from "./message-pattern-matcher.service.js";

// ── Discord webhook payload 建構（slash command → webhook body）─────────────

/**
 * 從 ChatInputCommandInteraction 建構 behavior webhook POST body。
 * 對齊 RESTPostAPIWebhookWithTokenJSONBody 形狀（C-runtime §7.1）。
 *
 * Discord webhook 原生欄位（content / username / avatar_url）帶 interaction 資訊，
 * plugin 可直接用標準 Discord webhook 消費邏輯處理。
 * _meta 欄位帶完整 interaction 元資訊供需要的 plugin 使用（behavior webhook 可忽略）。
 */
function buildWebhookPayload(
  interaction: ChatInputCommandInteraction,
): Record<string, unknown> {
  return {
    // Discord webhook 原生欄位：content 帶指令名稱（供 plugin 識別觸發入口）
    content: `/${interaction.commandName}`,
    // username / avatar_url 帶發送者資訊（相容 Discord 原生 webhook 形狀）
    username: interaction.user.globalName ?? interaction.user.username,
    avatar_url: interaction.user.displayAvatarURL(),
    // _meta：完整 interaction 元資訊，供 plugin 取用 interaction_id / token 等
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
        global_name: interaction.user.globalName ?? null,
        discriminator: interaction.user.discriminator,
        avatar: interaction.user.avatar ?? null,
      },
      locale: interaction.locale ?? null,
      // slash command options（若有）供 plugin 讀取
      options: interaction.options.data.map((opt) => ({
        name: opt.name,
        type: opt.type,
        value: opt.value ?? null,
      })),
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
        {
          commandName: interaction.isChatInputCommand()
            ? interaction.commandName
            : undefined,
        },
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
        {
          commandName: interaction.isChatInputCommand()
            ? interaction.commandName
            : undefined,
        },
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
        forwardType: row.getDataValue(
          "forwardType",
        ) as BehaviorRow["forwardType"],
        source: row.getDataValue("source") as BehaviorRow["source"],
        triggerType: row.getDataValue(
          "triggerType",
        ) as BehaviorRow["triggerType"],
        messagePatternKind:
          (row.getDataValue(
            "messagePatternKind",
          ) as BehaviorRow["messagePatternKind"]) ?? null,
        messagePatternValue:
          (row.getDataValue("messagePatternValue") as string | null) ?? null,
        slashCommandName:
          (row.getDataValue("slashCommandName") as string | null) ?? null,
        slashCommandDescription:
          (row.getDataValue("slashCommandDescription") as string | null) ??
          null,
        scope: row.getDataValue("scope") as BehaviorRow["scope"],
        integrationTypes: row.getDataValue("integrationTypes") as string,
        contexts: row.getDataValue("contexts") as string,
        placementGuildId:
          (row.getDataValue("placementGuildId") as string | null) ?? null,
        placementChannelId:
          (row.getDataValue("placementChannelId") as string | null) ?? null,
        audienceKind: row.getDataValue(
          "audienceKind",
        ) as BehaviorRow["audienceKind"],
        audienceUserId:
          (row.getDataValue("audienceUserId") as string | null) ?? null,
        audienceGroupName:
          (row.getDataValue("audienceGroupName") as string | null) ?? null,
        webhookUrl: (row.getDataValue("webhookUrl") as string | null) ?? null,
        webhookSecret:
          (row.getDataValue("webhookSecret") as string | null) ?? null,
        webhookAuthMode:
          (row.getDataValue(
            "webhookAuthMode",
          ) as BehaviorRow["webhookAuthMode"]) ?? null,
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
   * 對齊 C-runtime §4.1：source=system 分支由此處理，不流到 WebhookForwarder。
   * v2 system seed 已暫關（M1-C2 前，behaviors 表通常沒有 source='system' 的 row）。
   * 若 admin 透過 M1-D 後的 admin/behaviors 建立 source='system' row，此路徑啟動。
   *
   * systemKey 對應：
   *   admin-login → issueLoginLinkForInteraction（admin-login.service.ts）
   *   manual      → 目前 v2 system seed 暫關，無 manual behavior row；若有，
   *                 v2 manual 語意為「開始 continuous forward session 到特定 behavior」，
   *                 但需要 behaviorRow 提供目標 behavior id（v2 設計 M1-D 後補），
   *                 此版本回 ephemeral 說明暫不支援。
   *   break       → endSession(userId)（清除 active session）
   */
  private async dispatchSystemBehavior(
    interaction: ChatInputCommandInteraction,
    behaviorRow: BehaviorRow,
  ): Promise<DispatchOutcome> {
    const systemKey = behaviorRow.systemKey;

    if (systemKey === "admin-login") {
      await issueLoginLinkForInteraction(interaction);
      return { claimed: true, claimedBy: "behavior_system" };
    }

    if (systemKey === "break") {
      const ended = await endSession(interaction.user.id);
      if (ended) {
        await interaction
          .reply({ content: "Session 已結束。", ephemeral: true })
          .catch(() => {});
      } else {
        await interaction
          .reply({ content: "目前沒有活躍的 session。", ephemeral: true })
          .catch(() => {});
      }
      return { claimed: true, claimedBy: "behavior_system" };
    }

    if (systemKey === "manual") {
      return this.dispatchManualBehavior(interaction);
    }

    // 未知 systemKey（不應發生，behaviorsS 表 CHECK 約束攔截）
    const unknownKey = systemKey ?? "(null)";
    botEventLog.record(
      "warn",
      "bot",
      `interaction-dispatcher: 未知 systemKey='${unknownKey}'，claimed=true 阻止漏到下一層`,
      { commandName: interaction.commandName, systemKey: unknownKey },
    );
    await interaction
      .reply({ content: "⚙ 未知的系統指令。", ephemeral: true })
      .catch(() => {});
    return { claimed: true, claimedBy: "behavior_system" };
  }

  // ── /manual：列出此 user 在 DM 觸發可用的 behaviors ─────────────────────

  /**
   * /manual slash command 真實實作。
   *
   * 列出此 user 在 DM 觸發時 match 的所有 behaviors（依 audienceKind 過濾）。
   * 回 ephemeral embed，顯示 title / triggerType / trigger preview。
   * 若 0 條 → 「目前在私訊沒有可用行為」。
   *
   * 對齊 M1-COMPLETION.md §5 與任務 Batch 1 #2 補強。
   */
  private async dispatchManualBehavior(
    interaction: ChatInputCommandInteraction,
  ): Promise<DispatchOutcome> {
    const userId = interaction.user.id;

    let behaviors: BehaviorRow[] = [];
    try {
      behaviors = await collectApplicableBehaviorsForUser(userId);
    } catch (err) {
      botEventLog.record(
        "error",
        "bot",
        `interaction-dispatcher: /manual 查詢 behaviors 失敗：${err instanceof Error ? err.message : String(err)}`,
        { userId },
      );
      await interaction
        .reply({
          content: "⚠ 無法取得行為清單，請稍後再試。",
          ephemeral: true,
        })
        .catch(() => {});
      return { claimed: true, claimedBy: "behavior_system" };
    }

    if (behaviors.length === 0) {
      await interaction
        .reply({
          content: "目前在私訊沒有可用行為。",
          ephemeral: true,
        })
        .catch(() => {});
      return { claimed: true, claimedBy: "behavior_system" };
    }

    // 建構 embed，每條 behavior 一個 field
    const embed = new EmbedBuilder()
      .setTitle("私訊可用行為清單")
      .setDescription(`目前對你適用的行為共 ${behaviors.length} 條：`)
      .setColor(0x5865f2);

    for (const b of behaviors.slice(0, 25)) {
      // Discord embed 最多 25 fields
      const triggerLabel =
        b.triggerType === "slash_command"
          ? `/${b.slashCommandName ?? "(未設定)"}`
          : `訊息觸發（${b.messagePatternKind ?? "?"}）：${b.messagePatternValue ?? ""}`;
      embed.addFields({
        name: b.title,
        value:
          `**類型**：${b.triggerType === "slash_command" ? "Slash 指令" : "訊息模式"}\n` +
          `**觸發**：\`${triggerLabel}\`\n` +
          (b.description ? `**說明**：${b.description}` : ""),
        inline: false,
      });
    }

    if (behaviors.length > 25) {
      embed.setFooter({ text: `（僅顯示前 25 條，共 ${behaviors.length} 條）` });
    }

    await interaction
      .reply({ embeds: [embed], ephemeral: true })
      .catch(() => {});

    botEventLog.record(
      "info",
      "bot",
      `/manual: userId=${userId} 查詢到 ${behaviors.length} 條可用行為`,
      { userId, count: behaviors.length },
    );

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
      return {
        claimed: true,
        claimedBy:
          behaviorRow.source === "custom"
            ? "behavior_custom"
            : "behavior_plugin",
      };
    }

    try {
      const result = await this.forwarder.forward(
        behaviorRow,
        payload as Record<string, unknown>,
      );

      if (!result.ok) {
        await interaction
          .editReply({
            content: `⚠ Behavior 轉發失敗：${result.error ?? "未知錯誤"}`,
          })
          .catch(() => {});
        return {
          claimed: true,
          claimedBy:
            behaviorRow.source === "custom"
              ? "behavior_custom"
              : "behavior_plugin",
        };
      }

      if (result.relayContent) {
        await interaction
          .editReply({ content: result.relayContent })
          .catch(() => {});
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
      claimedBy:
        behaviorRow.source === "custom" ? "behavior_custom" : "behavior_plugin",
    };
  }
}
