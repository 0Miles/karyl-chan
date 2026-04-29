import {
  ChannelType,
  type ChatInputCommandInteraction,
  type RESTPostAPIWebhookWithTokenJSONBody,
} from "discord.js";
import { ALL_DMS_TARGET_ID } from "./models/behavior-target.model.js";
import {
  findBehaviorsByTargets,
  type BehaviorRow,
} from "./models/behavior.model.js";
import { decryptSecret } from "../../utils/crypto.js";
import { dispatchWebhook } from "../../services/webhook-dispatch.service.js";
import { dispatchPluginDmBehavior } from "../plugin-system/plugin-dispatch.service.js";
import { avatarUrlFor } from "../web-core/message-mapper.js";
import { botEventLog } from "../../web/bot-event-log.js";

/**
 * Dispatch a user-created slash-command behavior (type='webhook' or
 * type='plugin', target=all_dms, triggerType='slash_command') invoked
 * via Discord interaction.
 *
 * Backend POST/PATCH validation already ensures the only behaviors
 * with this combination of (triggerType=slash_command, target≠system)
 * sit on ALL_DMS_TARGET — DM commands are inherently global on
 * Discord's side, so any other target would create a name visible
 * outside its intended audience.
 *
 * Three responsibilities:
 *   1. Look up the matching behavior by triggerValue == commandName.
 *   2. Defer the interaction (3-second clock) so dispatch latency
 *      doesn't break the interaction.
 *   3. Build a webhook-shaped payload from the interaction (no
 *      attachments / embeds at the slash-command level), POST it
 *      through the same dispatch primitives used by the messageCreate
 *      handler, and surface the result to the user via editReply.
 *
 * Returns true when a matching behavior was found (and the interaction
 * is now owned — the caller should not fall through to other
 * dispatchers); false otherwise.
 */

interface DispatchOk {
  ok: true;
  relayContent: string;
}
interface DispatchFail {
  ok: false;
  error: string;
}
type DispatchResult = DispatchOk | DispatchFail;

function buildInteractionPayload(
  interaction: ChatInputCommandInteraction,
  triggerValue: string,
): RESTPostAPIWebhookWithTokenJSONBody {
  const user = interaction.user;
  return {
    // Putting the slash trigger as content gives the receiving webhook
    // a useful echo — it can branch on the trigger like it would on
    // the message text from the messageCreate path.
    content: `/${triggerValue}`,
    username: user.globalName ?? user.username,
    avatar_url: avatarUrlFor(user.id, user.avatar),
    allowed_mentions: { parse: [] },
  };
}

async function findMatchingBehavior(
  commandName: string,
): Promise<BehaviorRow | null> {
  // Only ALL_DMS rows can carry slash_command triggers per the
  // validation rule; scope the read to that target to avoid loading
  // unrelated rows. Skip system rows — those have their own dispatch
  // path in main.ts and shouldn't be double-fired here.
  const rows = await findBehaviorsByTargets([ALL_DMS_TARGET_ID], {
    enabledOnly: true,
  });
  return (
    rows.find(
      (b) =>
        b.type !== "system" &&
        b.triggerType === "slash_command" &&
        b.triggerValue === commandName,
    ) ?? null
  );
}

/**
 * Returns true iff a user slash-command behavior owned this
 * interaction (so the caller knows not to fall through to discordx
 * or plugin dispatch).
 */
export async function dispatchUserSlashBehavior(
  interaction: ChatInputCommandInteraction,
): Promise<boolean> {
  const matched = await findMatchingBehavior(interaction.commandName);
  if (!matched) return false;

  // Defer right away so we have the full 15-minute followup window
  // to do dispatch + reply. Ephemeral so a slow webhook doesn't leave
  // a public "thinking…" hanging forever.
  try {
    await interaction.deferReply({ ephemeral: true });
  } catch (err) {
    botEventLog.record(
      "warn",
      "bot",
      `user-slash-behavior: defer failed for /${matched.triggerValue}: ${err instanceof Error ? err.message : String(err)}`,
      { behaviorId: matched.id },
    );
    return true;
  }

  const payload = buildInteractionPayload(interaction, matched.triggerValue);
  const result: DispatchResult = await runDispatch(matched, payload);

  if (result.ok) {
    if (result.relayContent) {
      await interaction
        .editReply({ content: result.relayContent.slice(0, 2000) })
        .catch(() => {});
    } else {
      await interaction
        .editReply({ content: `✓ 已觸發「${matched.title}」` })
        .catch(() => {});
    }
  } else {
    await interaction
      .editReply({ content: `⚠ 行為觸發失敗:${result.error}` })
      .catch(() => {});
  }
  return true;
}

async function runDispatch(
  behavior: BehaviorRow,
  payload: RESTPostAPIWebhookWithTokenJSONBody,
): Promise<DispatchResult> {
  if (behavior.type === "plugin") {
    if (behavior.pluginId == null || !behavior.pluginBehaviorKey) {
      return { ok: false, error: "plugin behavior misconfigured" };
    }
    const r = await dispatchPluginDmBehavior({
      pluginId: behavior.pluginId,
      behaviorKey: behavior.pluginBehaviorKey,
      payload,
    });
    if (!r.ok) return { ok: false, error: r.error ?? "plugin dispatch failed" };
    return { ok: true, relayContent: r.relayContent ?? "" };
  }
  // Default: type='webhook'.
  let url: string;
  let secret: string | null = null;
  try {
    url = decryptSecret(behavior.webhookUrl);
    if (behavior.webhookSecret) secret = decryptSecret(behavior.webhookSecret);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `decrypt failed: ${msg}` };
  }
  const r = await dispatchWebhook(url, payload, { secret });
  if (!r.ok) return { ok: false, error: r.error ?? "webhook dispatch failed" };
  return { ok: true, relayContent: r.relayContent ?? "" };
}

// Re-export so the channel-type narrowing helper stays nearby for
// callers that want to gate dispatching to DMs only.
export const SLASH_BEHAVIOR_DM_ONLY = (
  interaction: ChatInputCommandInteraction,
): boolean => interaction.channel?.type === ChannelType.DM;
