/**
 * command-system/types.ts — M1-C1 骨架型別定義
 *
 * 對齊 C-runtime §2.1 介面定義。
 * 所有型別在此集中宣告，四個 service 共用。
 *
 * 狀態：dormant（M1-C1），不從 main.ts import，不接線。
 * M1-C2 接線時：
 *   - 從 main.ts import CommandReconciler / InteractionDispatcher / MessagePatternMatcher
 *   - 移除舊 stub：dm-slash-rebind / user-slash-behavior / webhook-behavior.events
 */

import type {
  ApplicationCommandData,
  RESTPostAPIWebhookWithTokenJSONBody,
} from "discord.js";
import type { BehaviorRow } from "../behavior/models/behavior.model.js";

// ── 三軸核心型別（C-runtime §2.1）────────────────────────────────────────────

/**
 * 對應 Discord InteractionContextType 的字串值。
 * M0-FROZEN §1.1 鎖定列舉。
 */
export type DiscordContext = "Guild" | "BotDM" | "PrivateChannel";

/**
 * 對應 Discord ApplicationIntegrationType 的字串值。
 * M0-FROZEN §1.1 鎖定列舉。
 */
export type DiscordIntegrationType = "guild_install" | "user_install";

/**
 * 指令的 Discord 作用域。
 * M0-FROZEN §1.1 鎖定列舉。
 */
export type CommandScope = "global" | "guild";

/**
 * 三軸規格：scope + integrationTypes + contexts。
 * behaviors 表（軌二）與 plugin_commands 表（軌三）共用。
 *
 * DB 儲存格式（M0-FROZEN §1.4）：
 *   integrationTypes / contexts 為 lexicographically-sorted comma-joined string，
 *   應用層讀取後 split(',') 轉成陣列。
 */
export interface ThreeAxisSpec {
  scope: CommandScope;
  integrationTypes: DiscordIntegrationType[];
  contexts: DiscordContext[];
}

// ── Discord 登記規格（deriveRegistrationCall 的輸出）────────────────────────

/**
 * reconciler 傳給 Discord API 的完整登記規格。
 * - scope='global'：呼叫 `application.commands.create(data)`
 * - scope='guild'：per each guild 呼叫 `guild.commands.create(data)`
 */
export interface DiscordRegistrationSpec {
  scope: CommandScope;
  data: ApplicationCommandData;
}

// ── 非法組合錯誤（deriveRegistrationCall 回傳）───────────────────────────────

/**
 * 三軸組合違反 C-runtime §3.3 非法規則時回傳。
 * M-8 修：scope=guild + 含 BotDM 為非法。
 */
export class RejectionError extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(`三軸組合非法：${reason}`);
    this.name = "RejectionError";
    this.reason = reason;
  }
}

// ── ReconcileReport / ReconcileItemResult（C-runtime §2.2）──────────────────

export interface ReconcileItemResult {
  ok: boolean;
  source: "behavior" | "plugin_command";
  sourceId: number;
  action?: "create" | "patch" | "delete" | "noop";
  error?: string;
}

export interface ReconcileReport {
  created: number;
  patched: number;
  deleted: number;
  errors: ReconcileItemResult[];
}

// ── DispatchOutcome（C-runtime §2.3）────────────────────────────────────────

export interface DispatchOutcome {
  /** 是否有 handler 宣告擁有此 interaction */
  claimed: boolean;
  /** 哪一層 handler 宣告擁有 */
  claimedBy?:
    | "behavior_system"
    | "behavior_custom"
    | "behavior_plugin"
    | "plugin_command"
    | "in_process";
  /** 若 claimed=false，提供 fallback 訊息供 log */
  reason?: "unknown_command" | "disabled_plugin" | "no_handler";
  error?: string;
}

// ── MessageMatchOutcome（C-runtime §2.4）────────────────────────────────────

export interface MessageMatchOutcome {
  handled: boolean;
  sessionStarted?: boolean;
  sessionEnded?: boolean;
  behaviorId?: number;
  error?: string;
}

// ── ForwardResult（C-runtime §2.5 / §7.4）───────────────────────────────────

export interface ForwardResult {
  ok: boolean;
  /** [BEHAVIOR:END] sentinel 是否出現在 response.content */
  ended: boolean;
  /** 已 strip sentinel + trim 的 content，可直接 relay 給用戶 */
  relayContent: string;
  /** HTTP 狀態（失敗時） */
  status?: number;
  /** 錯誤描述（失敗時） */
  error?: string;
}

// ── BehaviorRowV2（BehaviorRow 的三軸解析版）────────────────────────────────

/**
 * BehaviorRow + 解析後的三軸陣列（應用層從 comma-joined string split 後的結果）。
 * WebhookForwarder / InteractionDispatcher 使用此型別，不用 raw string。
 */
export interface BehaviorRowV2 extends BehaviorRow {
  integrationTypesParsed: DiscordIntegrationType[];
  contextsParsed: DiscordContext[];
}

// ── PluginCommandRowV2（plugin_commands 三軸的運行時解析結果）───────────────

/**
 * plugin_commands 表 row 的運行時形狀。
 * featureKey IS NULL 的 row 才屬於軌三（由 CommandReconciler 管）。
 * manifestJson 內存有 ManifestPluginCommand 的 JSON。
 *
 * 三軸從 manifest 的 ManifestPluginCommand 欄位讀取：
 *   scope / integration_types / contexts（snake_case，manifest 格式）
 */
export interface PluginCommandRowV2 {
  id: number;
  pluginId: number;
  guildId: string | null;
  name: string;
  discordCommandId: string | null;
  featureKey: string | null;
  manifestJson: string;
  /** 從 manifestJson 解析後的 ManifestPluginCommand 三軸 */
  scope: CommandScope;
  integrationTypes: DiscordIntegrationType[];
  contexts: DiscordContext[];
  description: string;
}

// ── WebhookForwarder 輸入 payload 型別別名────────────────────────────────────

/**
 * Bot 對 behavior webhook URL POST 的 body 形狀。
 * 完整對齊 RESTPostAPIWebhookWithTokenJSONBody（C-runtime §7.1）。
 */
export type BehaviorWebhookPayload = RESTPostAPIWebhookWithTokenJSONBody;
