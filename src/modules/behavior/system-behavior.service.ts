import {
  ChannelType,
  type APIEmbedField,
  type ChatInputCommandInteraction,
  type Message as DjsMessage,
} from "discord.js";
import {
  ALL_DMS_TARGET_ID,
  findUserTarget,
} from "./models/behavior-target.model.js";
import { findGroupTargetIdsForUser } from "./models/behavior-target-member.model.js";
import {
  findBehaviorsByTargets,
  type BehaviorRow,
} from "./models/behavior.model.js";
import {
  endSession,
  findActiveSession,
} from "./models/behavior-session.model.js";
import { describeTrigger } from "./behavior-trigger.js";
import { DEFAULT_COLOR, SUCCEEDED_COLOR } from "../../utils/constant.js";
import { botEventLog } from "../../web/bot-event-log.js";

/**
 * Implementation of the three bot-internal "system behaviors":
 *
 *   /login   — admin-login.service.ts (separate file because it has
 *              its own JWT + URL minting pipeline)
 *   /manual  — list the invoker's applicable DM behaviors
 *   /break   — end the invoker's active continuous-forward session
 *
 * Both functions are split into a `forInteraction` (slash command)
 * and `forMessage` (legacy DM text trigger) variant so the same
 * surface works whether the user typed `/manual` or matched a behavior
 * with triggerType=startswith and triggerValue="manual". Replies use
 * Discord's reply / send appropriately for the surface.
 */

async function collectApplicable(userId: string): Promise<BehaviorRow[]> {
  const result: BehaviorRow[] = [];
  const userTarget = await findUserTarget(userId);
  if (userTarget) {
    result.push(
      ...(await findBehaviorsByTargets([userTarget.id], { enabledOnly: true })),
    );
  }
  const groupIds = await findGroupTargetIdsForUser(userId);
  if (groupIds.length > 0) {
    result.push(
      ...(await findBehaviorsByTargets(groupIds, { enabledOnly: true })),
    );
  }
  result.push(
    ...(await findBehaviorsByTargets([ALL_DMS_TARGET_ID], {
      enabledOnly: true,
    })),
  );
  // Hide system rows from the listing — they're infrastructure, not
  // user-configurable behaviors. The user's actual question with
  // /manual is "what custom forwards do I have set up", not "what
  // bot internals are wired".
  return result.filter((b) => b.type !== "system");
}

interface ManualReplyPayload {
  content?: string;
  embeds?: Array<Record<string, unknown>>;
  ephemeral?: boolean;
}

function buildManualReply(rows: BehaviorRow[]): ManualReplyPayload {
  if (rows.length === 0) {
    return {
      embeds: [{ color: DEFAULT_COLOR, description: "目前沒有可用的行為。" }],
      ephemeral: true,
    };
  }
  const fields: APIEmbedField[] = rows.slice(0, 25).map((b, idx) => {
    const lines = [
      `觸發:${describeTrigger(b.triggerType, b.triggerValue)}`,
      `類型:${b.forwardType === "continuous" ? "持續轉發" : "一次性轉發"}`,
    ];
    if (b.description) lines.push(b.description);
    return {
      name: `${idx + 1}. ${b.title}`,
      value: lines.join("\n").slice(0, 1024),
    };
  });
  const hasContinuous = rows.some((b) => b.forwardType === "continuous");
  const footer = hasContinuous
    ? { text: "持續轉發進行中可隨時輸入 /break 結束" }
    : undefined;
  return {
    embeds: [
      {
        color: DEFAULT_COLOR,
        title: "可用的行為",
        fields,
        footer,
      },
    ],
    ephemeral: true,
  };
}

export async function runManualForInteraction(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (interaction.channel?.type !== ChannelType.DM) {
    await interaction
      .reply({ content: "此指令僅限私訊使用。", flags: "Ephemeral" })
      .catch(() => {});
    return;
  }
  try {
    const rows = await collectApplicable(interaction.user.id);
    const payload = buildManualReply(rows);
    await interaction
      .reply({
        embeds: payload.embeds as never,
        flags: payload.ephemeral ? "Ephemeral" : undefined,
      })
      .catch(() => {});
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    botEventLog.record(
      "warn",
      "feature",
      `system-behavior /manual failed: ${msg}`,
      { userId: interaction.user.id },
    );
    await interaction
      .reply({ content: "⚠ 無法載入行為列表。", flags: "Ephemeral" })
      .catch(() => {});
  }
}

export async function runManualForMessage(message: DjsMessage): Promise<void> {
  // DM only — the messageCreate dispatcher already gates on this, but
  // defense-in-depth keeps us safe if a future caller skips the gate.
  if (message.channel.type !== ChannelType.DM) return;
  const rows = await collectApplicable(message.author.id);
  const payload = buildManualReply(rows);
  const channel = message.channel;
  if (!("send" in channel) || typeof channel.send !== "function") return;
  await channel.send({ embeds: payload.embeds as never }).catch(() => {});
}

export async function runBreakForInteraction(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (interaction.channel?.type !== ChannelType.DM) {
    await interaction
      .reply({ content: "此指令僅限私訊使用。", flags: "Ephemeral" })
      .catch(() => {});
    return;
  }
  try {
    const session = await findActiveSession(interaction.user.id);
    if (!session) {
      await interaction
        .reply({
          embeds: [
            { color: DEFAULT_COLOR, description: "目前沒有持續轉發可結束。" },
          ],
          flags: "Ephemeral",
        })
        .catch(() => {});
      return;
    }
    await endSession(interaction.user.id);
    await interaction
      .reply({
        embeds: [{ color: SUCCEEDED_COLOR, description: "✓ 持續轉發已結束。" }],
        flags: "Ephemeral",
      })
      .catch(() => {});
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    botEventLog.record(
      "warn",
      "feature",
      `system-behavior /break failed: ${msg}`,
      { userId: interaction.user.id },
    );
    await interaction
      .reply({ content: "⚠ 結束 session 失敗。", flags: "Ephemeral" })
      .catch(() => {});
  }
}

export async function runBreakForMessage(message: DjsMessage): Promise<void> {
  if (message.channel.type !== ChannelType.DM) return;
  const channel = message.channel;
  if (!("send" in channel) || typeof channel.send !== "function") return;
  const session = await findActiveSession(message.author.id);
  if (!session) {
    await channel
      .send({
        embeds: [
          { color: DEFAULT_COLOR, description: "目前沒有持續轉發可結束。" },
        ],
      })
      .catch(() => {});
    return;
  }
  await endSession(message.author.id);
  await channel
    .send({
      embeds: [{ color: SUCCEEDED_COLOR, description: "✓ 持續轉發已結束。" }],
    })
    .catch(() => {});
}
