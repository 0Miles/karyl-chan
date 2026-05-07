/**
 * behavior/system-seed.service.ts — v2 system behavior idempotent seed
 *
 * v1 → v2 重構（M1-A1 / M1-C2）期間，system seed 從 boot 路徑被移除，
 * v2 schema 中的 ensureSystemLoginBehavior / ensureSystemManualBehavior /
 * ensureSystemBreakBehavior 三個 helper 也被改成 no-op + TODO，沒人補回來。
 * 結果是 behaviors 表裡沒有 source='system' 的 row → CommandReconciler 的
 * desired set 不含 /login /manual /break → Discord 端不再登記，且 cleanup
 * 步驟還主動清掉 dm-slash-rebind 遺留的 DM-only 全域指令。
 *
 * 此檔在 main.ts run() 內 migrations 跑完後呼叫一次，補出三條 system row。
 *
 * Idempotent 規則：
 *   - 以 (source='system' AND systemKey=X) 為唯一性鍵（對齊 CR-7 unique
 *     index `behaviors_v2_system_uq`）。
 *   - 若 row 已存在 → 完全不動（admin 可能改過 slashCommandName / 三軸 /
 *     enabled，不應覆蓋）。
 *   - 若不存在 → 用 v1 等價形狀 INSERT：
 *       scope='global'
 *       integrationTypes='guild_install'  (lex-sorted，單值)
 *       contexts='BotDM,PrivateChannel'   (lex-sorted)
 *       triggerType='slash_command'
 *       audienceKind='all'
 *       enabled=true
 *       webhookUrl/webhookSecret/webhookAuthMode/pluginId/pluginBehaviorKey 全 NULL
 *       placementGuildId/placementChannelId NULL
 *
 * I-2 / I-3 / I-4 / I-5 / I-6 / I-7 全部對齊（I-3 對 source='system' 豁免，
 * 所以 BotDM context + global scope 合法）。
 *
 * 啟動順序：
 *   sequelize.sync() → runPendingMigrations() → ensureSystemBehaviors()
 *   → bot.login() → bot 'ready' → commandReconciler.reconcileAll()
 * 這樣 reconcileAll 跑時 desired set 已含三條 system row。
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
 * Idempotent upsert: 確保三條 system behavior row 存在於 behaviors 表。
 * 已存在的 row 不動（保留 admin 可能修改過的欄位）；缺的 row INSERT。
 *
 * 必須在 sequelize.sync() + runPendingMigrations() 之後呼叫，
 * 且必須在 commandReconciler.reconcileAll()（bot ready 內）之前完成。
 */
export async function ensureSystemBehaviors(): Promise<{
  created: BehaviorSystemKey[];
  existing: BehaviorSystemKey[];
}> {
  const created: BehaviorSystemKey[] = [];
  const existing: BehaviorSystemKey[] = [];

  // 落後值清單（self-heal）：v2 重構初期 seed 寫死 'guild_install'，導致 user-install
  // 安裝但無共處 guild 的使用者在 BotDM 看不到 system slash command。
  // 對既存 system row，若 integrationTypes 還停留在純 'guild_install'，patch 為 dual-install。
  // 不覆蓋 admin 已主動修改成其他值（e.g. 'user_install' 單獨）的場景。
  const STALE_INTEGRATION_TYPES = new Set<string>(["guild_install"]);

  for (const seed of SEEDS) {
    const found = await Behavior.findOne({
      where: { source: "system", systemKey: seed.systemKey },
    });
    if (found) {
      existing.push(seed.systemKey);
      const currentIntegration = (found.getDataValue("integrationTypes") as string | null) ?? "";
      if (STALE_INTEGRATION_TYPES.has(currentIntegration)) {
        await found.update({ integrationTypes: "guild_install,user_install" });
        botEventLog.record(
          "info",
          "bot",
          `system-seed: self-heal ${seed.systemKey} integrationTypes '${currentIntegration}' → 'guild_install,user_install'`,
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
      // 三軸字串為 lexicographically-sorted comma-joined（A-schema D-1）。
      // dual-install：對應 v1 dm-slash-rebind register 不傳 integrationTypes 時
      // Discord 自動繼承 app integration_types_config（GuildInstall+UserInstall）的行為。
      // 純 'guild_install' 會讓 user-install bot 但無共處 guild 的使用者在 BotDM 看不到 /login。
      integrationTypes: "guild_install,user_install",
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
      `system-seed: 補建 ${created.length} 條 system behavior（${created.join(", ")}）`,
      { created, existing },
    );
  }

  // sanity check：三條 systemKey 全部都該到位
  const missing = SYSTEM_BEHAVIOR_KEYS.filter(
    (k) => !created.includes(k) && !existing.includes(k),
  );
  if (missing.length > 0) {
    botEventLog.record(
      "warn",
      "bot",
      `system-seed: 預期 3 條 system behavior 全部到位，但仍缺 ${missing.join(", ")}`,
      { missing },
    );
  }

  return { created, existing };
}
