/**
 * Idempotent seed for the three v2 system behaviors (admin-login / manual / break).
 *
 * Uniqueness key: (source='system', systemKey) — aligned with unique index
 * `behaviors_v2_system_uq`. Existing rows are never overwritten because admin
 * may have edited slashCommandName / contexts / enabled / etc.
 *
 * I-2 / I-3 / I-4 / I-5 / I-6 / I-7 invariants all satisfied (I-3 exempts
 * source='system', so BotDM context + global scope is legal).
 */

import {
  Behavior,
  SYSTEM_BEHAVIOR_KEYS,
  type BehaviorSystemKey,
} from "./models/behavior.model.js";
import { botEventLog } from "../bot-events/bot-event-log.js";

interface SystemBehaviorSeed {
  systemKey: BehaviorSystemKey;
  slashCommandName: string;
  title: string;
  description: string;
  slashCommandDescription: string;
  sortOrder: number;
}

// dual-install: matches v1 dm-slash-rebind behaviour, which omitted
// integrationTypes so Discord defaulted to the app's full integration_types_config
// (GuildInstall + UserInstall). A user-installed bot with no shared guild
// cannot see global slash commands registered with guild_install only.
const DUAL_INTEGRATION_TYPES = "guild_install,user_install";

// Stale singleton value left by an earlier v2 seed; self-heal upgrades it to
// dual-install. Anything else (admin-modified) is left alone.
const STALE_GUILD_INSTALL_ONLY = "guild_install";

const SEEDS: SystemBehaviorSeed[] = [
  {
    systemKey: "admin-login",
    slashCommandName: "login",
    title: "發送登入連結",
    description:
      "私訊 bot `/login`(或符合觸發條件)時,發送一次性 admin 登入連結給授權使用者。系統行為,不可刪除或更換目標對象。",
    slashCommandDescription: "取得 admin 後台一次性登入連結(僅授權使用者)",
    sortOrder: -1000,
  },
  {
    systemKey: "manual",
    slashCommandName: "manual",
    title: "查看可用行為列表",
    description:
      "私訊 bot `/manual`(或符合觸發條件)時,列出此使用者在私訊可用的所有 behaviors。系統行為,不可刪除或更換目標對象。",
    slashCommandDescription: "查看你在私訊可用的行為列表",
    sortOrder: -999,
  },
  {
    systemKey: "break",
    slashCommandName: "break",
    title: "結束持續轉發",
    description:
      "私訊 bot `/break`(或符合觸發條件)時,結束此使用者目前的持續轉發 session。系統行為,不可刪除或更換目標對象。",
    slashCommandDescription: "結束目前正在進行的持續轉發",
    sortOrder: -998,
  },
];

/**
 * Idempotent upsert: ensure the three system behavior rows exist. Must run
 * after migrations and before commandReconciler.reconcileAll() so the
 * desired set includes them.
 */
export async function ensureSystemBehaviors(): Promise<{
  created: BehaviorSystemKey[];
  existing: BehaviorSystemKey[];
}> {
  const created: BehaviorSystemKey[] = [];
  const existing: BehaviorSystemKey[] = [];

  const rows = await Behavior.findAll({
    where: {
      source: "system",
      systemKey: SEEDS.map((s) => s.systemKey),
    },
  });
  const rowByKey = new Map(
    rows.map(
      (row) =>
        [row.getDataValue("systemKey") as BehaviorSystemKey, row] as const,
    ),
  );

  for (const seed of SEEDS) {
    const row = rowByKey.get(seed.systemKey);
    if (row) {
      existing.push(seed.systemKey);
      const currentIntegration = row.getDataValue("integrationTypes") as
        | string
        | null;
      if (currentIntegration === STALE_GUILD_INSTALL_ONLY) {
        await row.update({ integrationTypes: DUAL_INTEGRATION_TYPES });
        botEventLog.record(
          "info",
          "bot",
          `system-seed: self-heal ${seed.systemKey} integrationTypes '${currentIntegration}' → '${DUAL_INTEGRATION_TYPES}'`,
          { systemKey: seed.systemKey, before: currentIntegration },
        );
      }
      continue;
    }

    await Behavior.create({
      title: seed.title,
      description: seed.description,
      enabled: true,
      sortOrder: seed.sortOrder,
      stopOnMatch: true,
      forwardType: "one_time",
      source: "system",
      triggerType: "slash_command",
      messagePatternKind: null,
      messagePatternValue: null,
      slashCommandName: seed.slashCommandName,
      slashCommandDescription: seed.slashCommandDescription,
      scope: "global",
      integrationTypes: DUAL_INTEGRATION_TYPES,
      contexts: "BotDM,PrivateChannel",
      placementGuildId: null,
      placementChannelId: null,
      audienceKind: "all",
      audienceUserId: null,
      audienceGroupName: null,
      webhookUrl: null,
      webhookSecret: null,
      webhookAuthMode: null,
      pluginId: null,
      pluginBehaviorKey: null,
      systemKey: seed.systemKey,
    });
    created.push(seed.systemKey);
  }

  if (created.length > 0) {
    botEventLog.record(
      "info",
      "bot",
      `system-seed: 補建 ${created.length} 條 system behavior(${created.join(", ")})`,
      { created, existing },
    );
  }

  // Fail-fast on missing keys: a system slash command never being registered
  // would silently break /login etc., so we'd rather crash boot than warn.
  const missing = SYSTEM_BEHAVIOR_KEYS.filter(
    (k) => !created.includes(k) && !existing.includes(k),
  );
  if (missing.length > 0) {
    throw new Error(
      `system-seed: 預期 3 條 system behavior 全部到位,但仍缺 ${missing.join(", ")}`,
    );
  }

  return { created, existing };
}
