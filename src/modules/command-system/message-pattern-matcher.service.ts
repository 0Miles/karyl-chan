/**
 * command-system/message-pattern-matcher.service.ts — M1-C1 骨架實作
 *
 * MessagePatternMatcher：取代 webhook-behavior.events.ts 的 messageCreate handler。
 *
 * 對齊 C-runtime §5（DM-only，§5.1 決策）：
 *   1. DM-only gate（channel.type !== ChannelType.DM 直接 return）
 *   2. 查 active session（behavior_sessions PK=userId）── session active 直接走 forwarder
 *   3. 查 applicable behaviors（依 audienceKind 三層 user → group → all）
 *   4. matchTrigger（startswith/endswith/regex）
 *   5. 呼叫 WebhookForwarder.forward
 *   6. session 管理（startSession/endSession，[BEHAVIOR:END] sentinel）
 *
 * 狀態：dormant（M1-C1）。
 *   - 所有真實邏輯已實作。
 *   - register(client) 不真的 hookup（dormant 階段）。
 *   - onMessage(djsMessage) 暴露給 testing。
 *
 * M1-C2 接線時：
 *   1. 在 main.ts 中呼叫 messageMatcher.register(bot)（替代 registerWebhookBehaviorEvents）
 *   2. 移除舊 registerWebhookBehaviorEvents 呼叫
 *   3. system behavior message handler（/manual、/break 的 DM 觸發）補在此處
 */

import {
  type Client,
  type Message as DjsMessage,
  type DMChannel,
  ChannelType,
} from "discord.js";
import { Op } from "sequelize";
import {
  Behavior,
  type BehaviorRow,
} from "../behavior/models/behavior.model.js";
import {
  findActiveSession,
  startSession,
  endSession,
} from "../behavior/models/behavior-session.model.js";
import { findAudienceMembers } from "../behavior/models/behavior-audience-member.model.js";
import { matchesTrigger } from "../behavior/behavior-trigger.js";
import { botEventLog } from "../bot-events/bot-event-log.js";
import type { MessageMatchOutcome } from "./types.js";
import type { WebhookForwarder } from "./webhook-forwarder.service.js";
import { findBehaviorById } from "../behavior/models/behavior.model.js";

// ── MessagePatternMatcher ─────────────────────────────────────────────────────

export class MessagePatternMatcher {
  constructor(private readonly forwarder: WebhookForwarder) {}

  /**
   * 掛載到 bot client（替代 registerWebhookBehaviorEvents(client)）。
   * M1-C2 接線：真實掛載 messageCreate listener。
   *
   * 注意（C-runtime §5.1）：DM-only gate。guild channel 訊息一律丟棄。
   *
   * system behavior 的 DM 觸發路徑（/manual、/break text trigger）：
   *   v2 設計決定 system behavior 只走 slash_command trigger（不走 message_pattern）。
   *   理由：v1 的 /manual、/break 文字觸發是歷史殘留。v2 slash command 已足夠，
   *   message_pattern 觸發 system behavior 增加複雜度但無明顯收益。
   *   若未來需要，在此加一個 source='system' 的 behavior row 查找，
   *   然後 dispatch 到 InteractionDispatcher 等效的 system handler。
   */
  register(client: Client): void {
    client.on("messageCreate", (msg) => {
      void this.onMessage(msg).catch((err: unknown) => {
        botEventLog.record(
          "error",
          "bot",
          `message-pattern-matcher: messageCreate handler 拋出例外：${err instanceof Error ? err.message : String(err)}`,
        );
      });
    });
    botEventLog.record(
      "info",
      "bot",
      "message-pattern-matcher: messageCreate listener 已掛載（M1-C2）",
    );
  }

  /**
   * 處理一條 DjsMessage（供 testing 直接呼叫；M1-C2 後由 register 的 listener 呼叫）。
   */
  async onMessage(djsMessage: DjsMessage): Promise<MessageMatchOutcome> {
    // ─ DM-only gate（C-runtime §5.1）
    if (djsMessage.channel.type !== ChannelType.DM) {
      return { handled: false };
    }

    // 忽略 bot 自己發的訊息
    if (djsMessage.author.bot) {
      return { handled: false };
    }

    const userId = djsMessage.author.id;
    const channelId = djsMessage.channel.id;
    const content = djsMessage.content ?? "";

    // ─ 查 active session（C-runtime §5.2 session 優先）
    const activeSession = await findActiveSession(userId);
    if (activeSession) {
      return this.handleWithSession(
        activeSession,
        djsMessage,
        userId,
        channelId,
        content,
      );
    }

    // ─ 查 applicable behaviors（三層：user → group → all）
    const applicableBehaviors = await this.collectApplicableBehaviors(userId);
    if (applicableBehaviors.length === 0) {
      return { handled: false };
    }

    // ─ 匹配 trigger
    for (const behavior of applicableBehaviors) {
      if (behavior.triggerType !== "message_pattern") continue;
      if (!behavior.messagePatternKind || !behavior.messagePatternValue)
        continue;

      const matched = matchesTrigger(
        behavior.messagePatternKind,
        behavior.messagePatternValue,
        content,
      );
      if (!matched) continue;

      // ─ 呼叫 WebhookForwarder + session 管理
      return this.handleMatchedBehavior(
        behavior,
        djsMessage,
        userId,
        channelId,
        content,
      );
    }

    return { handled: false };
  }

  // ── 私有：active session 路徑 ────────────────────────────────────────────

  private async handleWithSession(
    session: { behaviorId: number; channelId: string; userId: string },
    djsMessage: DjsMessage,
    userId: string,
    channelId: string,
    content: string,
  ): Promise<MessageMatchOutcome> {
    const behavior = await findBehaviorById(session.behaviorId);

    // M-11 修：orphan session fatal assertion（C-runtime §3.2 M-11）
    if (!behavior) {
      // session 指向不存在的 behavior（孤兒 session），不靜默丟棄，log error + 清除
      botEventLog.record(
        "error",
        "bot",
        `message-pattern-matcher: orphan session userId=${userId} behaviorId=${session.behaviorId}，behavior 不存在，強制清除 session`,
        { userId, behaviorId: session.behaviorId },
      );
      await endSession(userId);
      return {
        handled: false,
        sessionEnded: true,
        error: "orphan session cleared",
      };
    }

    if (!behavior.enabled) {
      // behavior 被 disable，清除 session
      await endSession(userId);
      return { handled: false, sessionEnded: true };
    }

    const payload = this.buildPayload(djsMessage, behavior);
    const result = await this.forwarder.forward(behavior, payload);

    const dmChannel = djsMessage.channel as DMChannel;

    if (result.ended) {
      await endSession(userId);
      if (result.relayContent) {
        await dmChannel.send(result.relayContent).catch(() => {});
      }
      return { handled: true, sessionEnded: true, behaviorId: behavior.id };
    }

    if (result.ok && result.relayContent) {
      await dmChannel.send(result.relayContent).catch(() => {});
    }

    if (!result.ok) {
      botEventLog.record(
        "warn",
        "bot",
        `message-pattern-matcher: session forward 失敗 behaviorId=${behavior.id}：${result.error ?? "unknown"}`,
        { userId, behaviorId: behavior.id },
      );
    }

    return { handled: true, behaviorId: behavior.id };
  }

  // ── 私有：matched behavior 首次觸發 ─────────────────────────────────────

  private async handleMatchedBehavior(
    behavior: BehaviorRow,
    djsMessage: DjsMessage,
    userId: string,
    channelId: string,
    content: string,
  ): Promise<MessageMatchOutcome> {
    const payload = this.buildPayload(djsMessage, behavior);
    const result = await this.forwarder.forward(behavior, payload);
    const dmChannel = djsMessage.channel as DMChannel;

    let sessionStarted = false;
    let sessionEnded = false;

    if (result.ok) {
      // continuous forward：建立 session
      if (behavior.forwardType === "continuous" && !result.ended) {
        await startSession(userId, behavior.id, channelId);
        sessionStarted = true;
      }

      if (result.ended) {
        sessionEnded = true;
      }

      if (result.relayContent) {
        await dmChannel.send(result.relayContent).catch(() => {});
      }
    } else {
      botEventLog.record(
        "warn",
        "bot",
        `message-pattern-matcher: forward 失敗 behaviorId=${behavior.id}：${result.error ?? "unknown"}`,
        { userId, behaviorId: behavior.id },
      );
    }

    return {
      handled: true,
      sessionStarted,
      sessionEnded,
      behaviorId: behavior.id,
    };
  }

  // ── 私有：collectApplicableBehaviors（三層 audienceKind 查詢）──────────

  /**
   * 查詢對此 userId 適用的 message_pattern behaviors。
   * 代理 module-level helper，固定只查 message_pattern 觸發。
   */
  private async collectApplicableBehaviors(
    userId: string,
  ): Promise<BehaviorRow[]> {
    return collectApplicableBehaviorsForUser(userId, "message_pattern");
  }

  // ── 私有：buildPayload ───────────────────────────────────────────────────

  /**
   * 從 DM message 建構 webhook POST body。
   * 對齊 RESTPostAPIWebhookWithTokenJSONBody 形狀（C-runtime §7.1）。
   */
  private buildPayload(
    djsMessage: DjsMessage,
    _behavior: BehaviorRow,
  ): Record<string, unknown> {
    return {
      content: djsMessage.content ?? "",
      username: djsMessage.author.username,
      avatar_url: djsMessage.author.displayAvatarURL(),
    };
  }

  // ── 私有：Sequelize model → BehaviorRow ──────────────────────────────────

  private rowOfBehavior(model: InstanceType<typeof Behavior>): BehaviorRow {
    return {
      id: model.getDataValue("id") as number,
      title: model.getDataValue("title") as string,
      description: (model.getDataValue("description") as string) ?? "",
      enabled: !!model.getDataValue("enabled"),
      sortOrder: model.getDataValue("sortOrder") as number,
      stopOnMatch: !!model.getDataValue("stopOnMatch"),
      forwardType: model.getDataValue(
        "forwardType",
      ) as BehaviorRow["forwardType"],
      source: model.getDataValue("source") as BehaviorRow["source"],
      triggerType: model.getDataValue(
        "triggerType",
      ) as BehaviorRow["triggerType"],
      messagePatternKind:
        (model.getDataValue(
          "messagePatternKind",
        ) as BehaviorRow["messagePatternKind"]) ?? null,
      messagePatternValue:
        (model.getDataValue("messagePatternValue") as string | null) ?? null,
      slashCommandName:
        (model.getDataValue("slashCommandName") as string | null) ?? null,
      slashCommandDescription:
        (model.getDataValue("slashCommandDescription") as string | null) ??
        null,
      scope: model.getDataValue("scope") as BehaviorRow["scope"],
      integrationTypes: model.getDataValue("integrationTypes") as string,
      contexts: model.getDataValue("contexts") as string,
      placementGuildId:
        (model.getDataValue("placementGuildId") as string | null) ?? null,
      placementChannelId:
        (model.getDataValue("placementChannelId") as string | null) ?? null,
      audienceKind: model.getDataValue(
        "audienceKind",
      ) as BehaviorRow["audienceKind"],
      audienceUserId:
        (model.getDataValue("audienceUserId") as string | null) ?? null,
      audienceGroupName:
        (model.getDataValue("audienceGroupName") as string | null) ?? null,
      webhookUrl: (model.getDataValue("webhookUrl") as string | null) ?? null,
      webhookSecret:
        (model.getDataValue("webhookSecret") as string | null) ?? null,
      webhookAuthMode:
        (model.getDataValue(
          "webhookAuthMode",
        ) as BehaviorRow["webhookAuthMode"]) ?? null,
      pluginId: (model.getDataValue("pluginId") as number | null) ?? null,
      pluginBehaviorKey:
        (model.getDataValue("pluginBehaviorKey") as string | null) ?? null,
      systemKey:
        (model.getDataValue("systemKey") as BehaviorRow["systemKey"]) ?? null,
    };
  }
}

// ── module-level helper（共用）────────────────────────────────────────────────

/**
 * 查詢對此 userId 在 DM 觸發時適用的 behaviors。
 *
 * 篩選條件：
 *   - enabled=true
 *   - source 非 'system'（system behaviors 不在 /manual 列表中）
 *   - triggerType：若指定，只回該 triggerType；不指定則返回全部
 *   - audienceKind 符合（user / group / all 三層）
 *
 * 結果依 sortOrder 排序。
 * 可被 MessagePatternMatcher 與 InteractionDispatcher(/manual) 共用。
 *
 * @param userId  Discord user id
 * @param triggerType  若為 'message_pattern' 則只查訊息觸發；未指定則查全部
 */
export async function collectApplicableBehaviorsForUser(
  userId: string,
  triggerType?: "message_pattern" | "slash_command",
): Promise<BehaviorRow[]> {
  const where: Record<string, unknown> = {
    enabled: true,
    source: { [Op.ne]: "system" },
  };
  if (triggerType !== undefined) {
    where["triggerType"] = triggerType;
  }
  const allRows = await Behavior.findAll({
    where,
    order: [["sortOrder", "ASC"]],
  });

  const result: BehaviorRow[] = [];

  for (const row of allRows) {
    const behavior = rowOfBehavior(row);

    if (behavior.audienceKind === "user") {
      if (behavior.audienceUserId === userId) {
        result.push(behavior);
      }
    } else if (behavior.audienceKind === "group") {
      const members = await findAudienceMembers(behavior.id);
      if (members.includes(userId)) {
        result.push(behavior);
      }
    } else if (behavior.audienceKind === "all") {
      result.push(behavior);
    }
  }

  return result;
}

// ── module-level rowOfBehavior（供 collectApplicableBehaviorsForUser 使用）──────

function rowOfBehavior(model: InstanceType<typeof Behavior>): BehaviorRow {
  return {
    id: model.getDataValue("id") as number,
    title: model.getDataValue("title") as string,
    description: (model.getDataValue("description") as string) ?? "",
    enabled: !!model.getDataValue("enabled"),
    sortOrder: model.getDataValue("sortOrder") as number,
    stopOnMatch: !!model.getDataValue("stopOnMatch"),
    forwardType: model.getDataValue(
      "forwardType",
    ) as BehaviorRow["forwardType"],
    source: model.getDataValue("source") as BehaviorRow["source"],
    triggerType: model.getDataValue(
      "triggerType",
    ) as BehaviorRow["triggerType"],
    messagePatternKind:
      (model.getDataValue(
        "messagePatternKind",
      ) as BehaviorRow["messagePatternKind"]) ?? null,
    messagePatternValue:
      (model.getDataValue("messagePatternValue") as string | null) ?? null,
    slashCommandName:
      (model.getDataValue("slashCommandName") as string | null) ?? null,
    slashCommandDescription:
      (model.getDataValue("slashCommandDescription") as string | null) ?? null,
    scope: model.getDataValue("scope") as BehaviorRow["scope"],
    integrationTypes: model.getDataValue("integrationTypes") as string,
    contexts: model.getDataValue("contexts") as string,
    placementGuildId:
      (model.getDataValue("placementGuildId") as string | null) ?? null,
    placementChannelId:
      (model.getDataValue("placementChannelId") as string | null) ?? null,
    audienceKind: model.getDataValue(
      "audienceKind",
    ) as BehaviorRow["audienceKind"],
    audienceUserId:
      (model.getDataValue("audienceUserId") as string | null) ?? null,
    audienceGroupName:
      (model.getDataValue("audienceGroupName") as string | null) ?? null,
    webhookUrl: (model.getDataValue("webhookUrl") as string | null) ?? null,
    webhookSecret:
      (model.getDataValue("webhookSecret") as string | null) ?? null,
    webhookAuthMode:
      (model.getDataValue(
        "webhookAuthMode",
      ) as BehaviorRow["webhookAuthMode"]) ?? null,
    pluginId: (model.getDataValue("pluginId") as number | null) ?? null,
    pluginBehaviorKey:
      (model.getDataValue("pluginBehaviorKey") as string | null) ?? null,
    systemKey:
      (model.getDataValue("systemKey") as BehaviorRow["systemKey"]) ?? null,
  };
}
