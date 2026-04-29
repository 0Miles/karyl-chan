import {
  ApplicationCommandType,
  InteractionContextType,
  type Client,
} from "discord.js";
import {
  ALL_DMS_TARGET_ID,
} from "../models/behavior-target.model.js";
import {
  findAllSystemBehaviors,
  findBehaviorsByTargets,
  SYSTEM_BEHAVIOR_KEY_BREAK,
  SYSTEM_BEHAVIOR_KEY_LOGIN,
  SYSTEM_BEHAVIOR_KEY_MANUAL,
} from "../models/behavior.model.js";
import { botEventLog } from "../web/bot-event-log.js";

/**
 * Reconcile DM-only global slash commands with what's currently
 * declared in the DB. Two sources contribute:
 *
 *   1. **System behaviors** (type='system') — every row with
 *      triggerType='slash_command' produces a global DM-only command
 *      named after triggerValue. Currently login / manual / break.
 *
 *   2. **All-DMs target user behaviors** with triggerType='slash_command' —
 *      admin can wire `/foo` → webhook/plugin from BehaviorsPage; we
 *      register it globally with DM-only contexts so the user can
 *      see + invoke it in their DM with the bot. Restricted to the
 *      ALL_DMS_TARGET (DM commands are inherently global on Discord's
 *      side — there's no way to scope a DM command to specific users).
 *
 * Reconcile rules:
 *   - desired set = union of (1) + (2)
 *   - any global command not in the desired set BUT carrying the
 *     DM-only context shape gets deleted (likely a leftover from a
 *     renamed system trigger or a deleted user behavior)
 *   - missing desired commands get created
 *   - per-guild copies of any desired name are removed (dm-only
 *     commands shouldn't pollute guild slash pickers)
 *
 * Called from main.ts at boot AND from behavior-routes.ts after any
 * POST/PATCH/DELETE that could affect the desired set (so an admin
 * edit shows up in Discord without a bot restart).
 */

interface DesiredCommand {
  name: string;
  description: string;
}

function descriptionForSystemKey(
  pluginBehaviorKey: string | null,
  fallback: string,
): string {
  switch (pluginBehaviorKey) {
    case SYSTEM_BEHAVIOR_KEY_LOGIN:
      return "取得 admin 後台一次性登入連結(僅授權使用者)";
    case SYSTEM_BEHAVIOR_KEY_MANUAL:
      return "查看你在私訊可用的行為列表";
    case SYSTEM_BEHAVIOR_KEY_BREAK:
      return "結束目前正在進行的持續轉發";
    default:
      return fallback;
  }
}

async function buildDesired(): Promise<DesiredCommand[]> {
  const desired: DesiredCommand[] = [];

  const systems = await findAllSystemBehaviors().catch(() => []);
  for (const sys of systems) {
    if (
      sys.enabled &&
      sys.triggerType === "slash_command" &&
      sys.triggerValue.length > 0
    ) {
      desired.push({
        name: sys.triggerValue,
        description: descriptionForSystemKey(
          sys.pluginBehaviorKey,
          sys.title || sys.triggerValue,
        ),
      });
    }
  }

  const userSlash = await findBehaviorsByTargets([ALL_DMS_TARGET_ID], {
    enabledOnly: true,
  }).catch(() => []);
  for (const b of userSlash) {
    if (b.type === "system") continue;
    if (b.triggerType !== "slash_command") continue;
    if (!b.triggerValue) continue;
    desired.push({
      name: b.triggerValue,
      description: b.title || `behavior #${b.id}`,
    });
  }

  return desired;
}

export async function rebindDmOnlyCommandsAsGlobal(
  bot: Client,
): Promise<void> {
  if (!bot.application) return;

  const desired = await buildDesired();
  const desiredByName = new Map(desired.map((d) => [d.name, d]));

  // 1) Strip per-guild copies that earlier code (or discordx) may have
  //    pushed for any of these names — DM-only commands live globally.
  for (const [, guild] of bot.guilds.cache) {
    try {
      const cmds = await guild.commands.fetch();
      for (const cmd of cmds.values()) {
        if (desiredByName.has(cmd.name)) {
          await guild.commands.delete(cmd.id).catch(() => {});
        }
      }
    } catch {
      /* skip guilds we can't access */
    }
  }

  // 2) Sweep stale globals: any DM-only-context command whose name is
  //    no longer in the desired set. Heuristic: only touch commands
  //    whose contexts is exactly the DM-only pair so we don't kill
  //    plugin globals like /account or /relay that ALSO declare
  //    contexts including BotDM but pair them with Guild.
  const existing = await bot.application.commands.fetch();
  const existingByName = new Map(existing.map((c) => [c.name, c]));

  for (const [name, cmd] of existingByName) {
    if (desiredByName.has(name)) continue;
    const ctxs = (cmd as unknown as { contexts?: number[] }).contexts;
    if (
      ctxs &&
      ctxs.length > 0 &&
      ctxs.every(
        (c) =>
          c === InteractionContextType.BotDM ||
          c === InteractionContextType.PrivateChannel,
      )
    ) {
      await bot.application.commands.delete(cmd.id).catch(() => {});
    }
  }

  // 3) Create missing.
  for (const meta of desired) {
    if (existingByName.has(meta.name)) continue;
    try {
      await bot.application.commands.create({
        type: ApplicationCommandType.ChatInput,
        name: meta.name,
        description: meta.description,
        contexts: [
          InteractionContextType.BotDM,
          InteractionContextType.PrivateChannel,
        ],
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      botEventLog.record(
        "warn",
        "bot",
        `failed to register /${meta.name} as global DM-only command: ${msg}`,
      );
    }
  }
}
