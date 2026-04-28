import type { ArgsOf } from "discordx";
import { Discord, On } from "discordx";
import {
    ChannelType,
    type Message as DjsMessage,
    type RESTPostAPIWebhookWithTokenJSONBody,
    type APIEmbed
} from "discord.js";
import { ALL_DMS_TARGET_ID, findUserTarget } from "../models/behavior-target.model.js";
import { findGroupTargetIdsForUser } from "../models/behavior-target-member.model.js";
import {
    findBehaviorById,
    findBehaviorsByTargets,
    type BehaviorRow
} from "../models/behavior.model.js";
import {
    endSession,
    findActiveSession,
    startSession,
    type BehaviorSessionRow
} from "../models/behavior-session.model.js";
import { decryptSecret } from "../utils/crypto.js";
import { matchesTrigger } from "../utils/behavior-trigger.js";
import { dispatchWebhook, type DispatchResult } from "../services/webhook-dispatch.service.js";
import { avatarUrlFor } from "../web/message-mapper.js";
import { botEventLog } from "../web/bot-event-log.js";

/**
 * Build a Discord webhook payload from a user's DM message. Mirrors the
 * shape of an outbound bot message: `username` / `avatar_url` are filled
 * with the sender's identity so the receiving channel sees who actually
 * spoke (instead of "Karyl Chan said …").
 *
 * Attachments are forwarded by URL (Discord re-fetches them on POST).
 * Non-empty embeds are passed through as-is so a forwarded link card
 * keeps its preview.
 */
function buildPayload(message: DjsMessage): RESTPostAPIWebhookWithTokenJSONBody {
    const user = message.author;
    const embeds: APIEmbed[] = message.embeds.map(e => e.toJSON() as APIEmbed);
    const attachmentLines = [...message.attachments.values()].map(a => a.url);
    const baseContent = message.content ?? '';
    const content = attachmentLines.length > 0
        ? [baseContent, ...attachmentLines].filter(Boolean).join('\n')
        : baseContent;
    return {
        content: content.length > 0 ? content : undefined,
        username: user.globalName ?? user.username,
        avatar_url: avatarUrlFor(user.id, user.avatar),
        embeds: embeds.length > 0 ? embeds : undefined,
        // allowed_mentions defaults to honoring the payload's own
        // mentions; the source DM came from a user who could only ping
        // themselves, so passing through is safe.
        allowed_mentions: { parse: [] }
    };
}

/**
 * Pull every behavior potentially applicable to this DM sender, in the
 * priority order:  user → group → all_dms.
 *
 * Within each tier, behaviors are pre-sorted by sortOrder (model query
 * order). Tiers are concatenated; the caller iterates the flat list and
 * applies stopOnMatch semantics.
 */
async function collectApplicableBehaviors(userId: string): Promise<BehaviorRow[]> {
    const result: BehaviorRow[] = [];

    const userTarget = await findUserTarget(userId);
    if (userTarget) {
        const userBehaviors = await findBehaviorsByTargets([userTarget.id], { enabledOnly: true });
        result.push(...userBehaviors);
    }

    const groupIds = await findGroupTargetIdsForUser(userId);
    if (groupIds.length > 0) {
        const groupBehaviors = await findBehaviorsByTargets(groupIds, { enabledOnly: true });
        result.push(...groupBehaviors);
    }

    const allBehaviors = await findBehaviorsByTargets([ALL_DMS_TARGET_ID], { enabledOnly: true });
    result.push(...allBehaviors);

    return result;
}

/**
 * Send the relayContent (post-strip) back to the originating DM channel.
 * Soft-fails: webhook dispatch reports back through the result envelope
 * already, so a relay failure shouldn't crash the handler — log and move on.
 */
async function relayBack(message: DjsMessage, text: string): Promise<void> {
    if (!text) return;
    const channel = message.channel;
    if (!('send' in channel) || typeof channel.send !== 'function') return;
    try {
        await channel.send(text);
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        botEventLog.record(
            'warn',
            'bot',
            `webhook-behavior: failed to relay response to DM ${message.channelId}: ${msg}`,
            { channelId: message.channelId, userId: message.author.id }
        );
    }
}

async function dispatchAndHandle(
    message: DjsMessage,
    behavior: BehaviorRow
): Promise<DispatchResult> {
    let url: string;
    try {
        url = decryptSecret(behavior.webhookUrl);
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        botEventLog.record(
            'error',
            'error',
            `webhook-behavior: cannot decrypt webhook for behavior ${behavior.id}: ${msg}`,
            { behaviorId: behavior.id }
        );
        return { ok: false, error: 'decrypt failed', ended: false, relayContent: '' };
    }
    const payload = buildPayload(message);
    const result = await dispatchWebhook(url, payload);
    if (!result.ok) {
        botEventLog.record(
            'warn',
            'bot',
            `webhook-behavior: dispatch failed for behavior ${behavior.id} (${result.error ?? 'unknown'})`,
            { behaviorId: behavior.id, status: result.status }
        );
        return result;
    }
    if (result.relayContent) {
        await relayBack(message, result.relayContent);
    }
    return result;
}

@Discord()
export class WebhookBehaviorEvents {
    @On()
    async messageCreate([message]: ArgsOf<"messageCreate">): Promise<void> {
        try {
            if (message.channel.type !== ChannelType.DM) return;
            if (message.author.bot) return;

            const userId = message.author.id;
            const channelId = message.channelId;

            // Active session takes precedence over trigger evaluation.
            // Persisted in DB so a bot restart resumes the session on the
            // next inbound DM (no in-memory rehydration required).
            const session: BehaviorSessionRow | null = await findActiveSession(userId);
            if (session) {
                const behavior = await findBehaviorById(session.behaviorId);
                if (!behavior || !behavior.enabled) {
                    // Session points at a deleted/disabled behavior — clean
                    // it up and fall through to fresh trigger evaluation
                    // for this message. (Behavior deletes CASCADE the
                    // session row; this branch covers race windows or a
                    // disabled-not-deleted behavior.)
                    await endSession(userId);
                } else {
                    const result = await dispatchAndHandle(message, behavior);
                    if (result.ended) {
                        await endSession(userId);
                        await relayBack(message, '✓ 持續轉發已由 webhook 服務端結束。');
                    }
                    return;
                }
            }

            const behaviors = await collectApplicableBehaviors(userId);
            if (behaviors.length === 0) return;

            const content = message.content ?? '';
            for (const behavior of behaviors) {
                if (!matchesTrigger(behavior.triggerType, behavior.triggerValue, content)) continue;
                const result = await dispatchAndHandle(message, behavior);
                // Continuous: open a session UNLESS the webhook already
                // signaled end on the very first POST (or dispatch
                // outright failed).
                if (behavior.forwardType === 'continuous' && result.ok && !result.ended) {
                    await startSession(userId, behavior.id, channelId);
                    await relayBack(
                        message,
                        `▶ 已開始持續轉發「${behavior.title}」。輸入 /break 可隨時結束。`
                    );
                    // Continuous always halts further evaluation — once a
                    // session is open, the next DM goes straight to the
                    // session branch above.
                    return;
                }
                if (behavior.stopOnMatch) return;
            }
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            botEventLog.record(
                'error',
                'error',
                `webhook-behavior messageCreate failed: ${msg}`,
                { channelId: message.channelId, userId: message.author.id }
            );
        }
    }
}

