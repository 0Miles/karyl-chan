/**
 * command-system/reconcile.service.ts — M1-C1 骨架實作
 *
 * CommandReconciler：軌二（behaviors）+ 軌三（plugin_commands）Discord 指令
 * 統一 reconcile 入口。對齊 C-runtime §2.2 介面定義 + §3.2 流程 2 + §3.3 三軸表。
 *
 * 狀態：dormant（M1-C1）。
 *   - 所有真實邏輯已實作（可供 M1-C2 接線）。
 *   - 不從 main.ts import，不掛任何 bot event listener。
 *
 * M1-C2 接線時：
 *   1. 在 bot ready handler 中呼叫 commandReconciler.reconcileAll()
 *   2. behavior-routes.ts 的 resync hook 改呼叫 reconcileForBehavior(id)
 *   3. 刪除舊 dm-slash-rebind.service.ts + rebindDmOnlyCommandsAsGlobal 呼叫
 *
 * 「軌一不動」保證（C-runtime §1 / M0-FROZEN §8）：
 *   - 本服務只認領 reconciler_owned_commands 名冊 + desired set 中的指令
 *   - 任何 featureKey 非 null 的 plugin_commands 由 PluginCommandRegistry 管，不觸碰
 *   - in-process 指令（picture-only-channel 等）不在 desired set，不動
 */

import {
  ApplicationCommandType,
  ApplicationIntegrationType,
  InteractionContextType,
  type Client,
  type Guild,
  type ApplicationCommandData,
  type ApplicationCommand,
} from "discord.js";
import { Op, QueryTypes } from "sequelize";
import {
  Behavior,
  type BehaviorRow,
} from "../behavior/models/behavior.model.js";
import { findAllDisabledBehaviorOverrides } from "../plugin-system/models/plugin-behavior-override.model.js";
import {
  PluginCommand,
  type PluginCommandRow,
} from "../plugin-system/models/plugin-command.model.js";
import {
  findPluginById,
  type PluginRow,
} from "../plugin-system/models/plugin.model.js";
import { botEventLog } from "../bot-events/bot-event-log.js";
import { sequelize } from "../../db.js";
import type {
  CommandScope,
  DiscordContext,
  DiscordIntegrationType,
  DiscordRegistrationSpec,
  ReconcileItemResult,
  ReconcileReport,
} from "./types.js";
import { RejectionError } from "./types.js";
import type {
  PluginManifest,
  ManifestPluginCommandV2,
  ManifestBehaviorV2,
  ManifestCommandOption,
} from "../plugin-system/plugin-registry.service.js";
import { manifestOptionToData } from "../plugin-system/plugin-command-registry.service.js";

// ── Discord 三軸對照表 ────────────────────────────────────────────────────────

const CONTEXT_MAP: Record<DiscordContext, InteractionContextType> = {
  Guild: InteractionContextType.Guild,
  BotDM: InteractionContextType.BotDM,
  PrivateChannel: InteractionContextType.PrivateChannel,
};

const INTEGRATION_MAP: Record<
  DiscordIntegrationType,
  ApplicationIntegrationType
> = {
  guild_install: ApplicationIntegrationType.GuildInstall,
  user_install: ApplicationIntegrationType.UserInstall,
};

// ── 輔助：三軸 string → 陣列解析 ─────────────────────────────────────────────

function parseContexts(raw: string): DiscordContext[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(
      (s): s is DiscordContext =>
        s === "Guild" || s === "BotDM" || s === "PrivateChannel",
    );
}

function parseIntegrationTypes(raw: string): DiscordIntegrationType[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(
      (s): s is DiscordIntegrationType =>
        s === "guild_install" || s === "user_install",
    );
}

// ── 輔助：行比對（指令是否需要 patch）────────────────────────────────────────

function commandNeedsPatch(
  existing: ApplicationCommand,
  desired: ApplicationCommandData,
): boolean {
  // 比對 description
  const existDesc = "description" in existing ? existing.description : "";
  const desiredDesc =
    "description" in desired
      ? ((desired as { description?: string }).description ?? "")
      : "";
  if (existDesc !== desiredDesc) return true;

  // 比對 contexts
  const existCtxSorted = (existing.contexts ?? []).slice().sort().join(",");
  const desiredCtx =
    (desired as { contexts?: InteractionContextType[] }).contexts ?? [];
  const desiredCtxSorted = desiredCtx.slice().sort().join(",");
  if (existCtxSorted !== desiredCtxSorted) return true;

  // 比對 integrationTypes
  const existItSorted = (existing.integrationTypes ?? [])
    .slice()
    .sort()
    .join(",");
  const desiredIt =
    (desired as { integrationTypes?: ApplicationIntegrationType[] })
      .integrationTypes ?? [];
  const desiredItSorted = desiredIt.slice().sort().join(",");
  if (existItSorted !== desiredItSorted) return true;

  return false;
}

// ── reconciler_owned_commands 名冊操作（原生 SQL，無 Sequelize model）──────────

interface OwnedCommandKey {
  name: string;
  scope: CommandScope;
  guildId: string | null;
}

async function loadOwnedCommands(): Promise<Set<string>> {
  // key format: `${scope}:${name}:${guildId ?? ""}`
  const rows = await sequelize.query<{
    name: string;
    scope: string;
    guildId: string | null;
  }>("SELECT name, scope, guildId FROM reconciler_owned_commands", {
    type: QueryTypes.SELECT,
  });
  const result = new Set<string>();
  for (const r of rows) {
    result.add(`${r.scope}:${r.name}:${r.guildId ?? ""}`);
  }
  return result;
}

async function upsertOwnedCommand(key: OwnedCommandKey): Promise<void> {
  const ownedAt = new Date().toISOString();
  if (key.scope === "global") {
    // SQLite：先刪再插（ON CONFLICT 語法與 partial index 不相容）
    await sequelize.query(
      `DELETE FROM reconciler_owned_commands
       WHERE name = :name AND scope = 'global' AND guildId IS NULL`,
      { replacements: { name: key.name } },
    );
    await sequelize.query(
      `INSERT INTO reconciler_owned_commands (name, scope, guildId, ownedAt)
       VALUES (:name, 'global', NULL, :ownedAt)`,
      { replacements: { name: key.name, ownedAt } },
    );
  } else {
    await sequelize.query(
      `DELETE FROM reconciler_owned_commands
       WHERE name = :name AND scope = 'guild' AND guildId = :guildId`,
      { replacements: { name: key.name, guildId: key.guildId } },
    );
    await sequelize.query(
      `INSERT INTO reconciler_owned_commands (name, scope, guildId, ownedAt)
       VALUES (:name, 'guild', :guildId, :ownedAt)`,
      { replacements: { name: key.name, guildId: key.guildId, ownedAt } },
    );
  }
}

async function deleteOwnedCommand(key: OwnedCommandKey): Promise<void> {
  if (key.scope === "global") {
    await sequelize.query(
      `DELETE FROM reconciler_owned_commands
       WHERE name = :name AND scope = 'global' AND guildId IS NULL`,
      { replacements: { name: key.name } },
    );
  } else {
    await sequelize.query(
      `DELETE FROM reconciler_owned_commands
       WHERE name = :name AND scope = 'guild' AND guildId = :guildId`,
      { replacements: { name: key.name, guildId: key.guildId } },
    );
  }
}

// ── deriveRegistrationCall（C-runtime §3.3 三軸 → Discord 登記形狀）──────────

/**
 * 依三軸計算 Discord API call shape。
 * 對齊 C-runtime §3.3 的 9 種合法組合（含 #8 非法修正）。
 * 非法組合回 RejectionError。
 *
 * 欄位 name/description 由呼叫方傳入（behaviors.slashCommandName / plugin_commands.name）。
 */
export function deriveRegistrationCall(
  name: string,
  description: string,
  scope: CommandScope,
  integrationTypes: DiscordIntegrationType[],
  contexts: DiscordContext[],
  options?: ManifestCommandOption[],
): DiscordRegistrationSpec {
  // 非法組合檢查（C-runtime §3.3 底部非法清單）
  if (integrationTypes.length === 0) {
    throw new RejectionError("integrationTypes 不得為空");
  }
  if (contexts.length === 0) {
    throw new RejectionError("contexts 不得為空");
  }
  if (scope === "guild") {
    if (integrationTypes.includes("user_install")) {
      throw new RejectionError("scope=guild 不支援 user_install");
    }
    if (
      integrationTypes.includes("guild_install") &&
      integrationTypes.includes("user_install")
    ) {
      throw new RejectionError(
        "scope=guild 不支援 guild_install+user_install 組合",
      );
    }
    // M-8 修：scope=guild + 含 BotDM 為非法
    if (contexts.some((c) => c !== "Guild")) {
      throw new RejectionError(
        "scope=guild 的 contexts 只能包含 Guild（BotDM/PrivateChannel 非法）",
      );
    }
  }

  const discordContexts = contexts.map((c) => CONTEXT_MAP[c]);
  const discordIntegrationTypes = integrationTypes.map(
    (t) => INTEGRATION_MAP[t],
  );

  const data: Record<string, unknown> = {
    type: ApplicationCommandType.ChatInput,
    name,
    description,
  };

  if (discordContexts.length > 0) {
    data["contexts"] = discordContexts;
  }
  if (discordIntegrationTypes.length > 0) {
    data["integrationTypes"] = discordIntegrationTypes;
  }
  if (options && options.length > 0) {
    data["options"] = options.map(manifestOptionToData);
  }

  return {
    scope,
    data: data as unknown as ApplicationCommandData,
  };
}

// ── DesiredItem：reconcile desired set 的元素 ────────────────────────────────

interface DesiredItem {
  name: string;
  spec: DiscordRegistrationSpec;
  source: "behavior" | "plugin_command";
  sourceId: number;
}

// ── CommandReconciler 主類別 ──────────────────────────────────────────────────

export class CommandReconciler {
  constructor(private readonly getBot: () => Client | null) {}

  // ── 公開 API ──────────────────────────────────────────────────────────────

  /**
   * 全量 reconcile（C-runtime §3.2 流程 2）。
   * 在 bot ready 事件繼 syncInProcessCommandsToDiscord + pluginCommandRegistry.reconcileAll
   * 之後呼叫，接管軌二 + 軌三 global 指令。
   *
   * 錯誤策略：每條 row 獨立 try/catch，單條失敗不阻擋其餘。
   */
  async reconcileAll(): Promise<ReconcileReport> {
    const bot = this.getBot();
    if (!bot?.application) {
      botEventLog.record(
        "warn",
        "bot",
        "command-reconciler: bot not ready, skipping reconcileAll",
      );
      return { created: 0, patched: 0, deleted: 0, errors: [] };
    }

    const report: ReconcileReport = {
      created: 0,
      patched: 0,
      deleted: 0,
      errors: [],
    };

    // 步驟 1：枚舉 desired set
    const desiredItems = await this.buildDesiredSet();

    // 步驟 3：拉 Discord 現況
    const discordState = await this.fetchDiscordState(bot);

    // 載入已知名冊（避免誤刪軌一）
    const ownedSet = await loadOwnedCommands();

    // 步驟 4：Diff & Apply
    for (const item of desiredItems) {
      try {
        const result = await this.applyOne(bot, item, discordState);
        if (result.action === "create") report.created++;
        else if (result.action === "patch") report.patched++;
        if (!result.ok) report.errors.push(result);
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        report.errors.push({
          ok: false,
          source: item.source,
          sourceId: item.sourceId,
          error,
        });
      }
    }

    // 步驟 4 續：stale 清除（名冊中有、但 desired set 沒有的指令）
    const desiredNames = new Set(
      desiredItems.map((i) => `${i.spec.scope}:${i.name}`),
    );

    for (const key of ownedSet) {
      // key format: `${scope}:${name}:${guildId ?? ""}`
      const [scope, name, guildIdPart] = key.split(":");
      if (!scope || !name) continue;
      const desiredKey = `${scope}:${name}`;
      if (!desiredNames.has(desiredKey)) {
        // stale：此指令已不在 desired set，從 Discord + 名冊刪除
        await this.deleteStale(
          bot,
          name,
          scope as CommandScope,
          guildIdPart || null,
        );
        report.deleted++;
      }
    }

    // 步驟 5：清舊版產物（dm-slash-rebind 遺留物）
    await this.cleanupLegacyDmSlashCommands(bot, desiredItems);

    // 步驟末：upsert 名冊
    for (const item of desiredItems) {
      if (item.spec.scope === "global") {
        await upsertOwnedCommand({
          name: item.name,
          scope: "global",
          guildId: null,
        }).catch((e: unknown) => {
          botEventLog.record(
            "warn",
            "bot",
            `command-reconciler: 名冊 upsert 失敗 ${item.name}: ${e instanceof Error ? e.message : String(e)}`,
          );
        });
      } else {
        // guild scope：為每個 bot 所在 guild 各登記一筆
        for (const guild of bot.guilds.cache.values()) {
          await upsertOwnedCommand({
            name: item.name,
            scope: "guild",
            guildId: guild.id,
          }).catch((e: unknown) => {
            botEventLog.record(
              "warn",
              "bot",
              `command-reconciler: 名冊 upsert 失敗 ${item.name}/${guild.id}: ${e instanceof Error ? e.message : String(e)}`,
            );
          });
        }
      }
    }

    botEventLog.record(
      "info",
      "bot",
      `command-reconciler: reconcileAll 完成 created=${report.created} patched=${report.patched} deleted=${report.deleted} errors=${report.errors.length}`,
    );

    return report;
  }

  /**
   * 增量 reconcile 單條 behavior（admin CRUD 後呼叫）。
   * 若 triggerType !== 'slash_command' 則為 no-op。
   */
  async reconcileForBehavior(behaviorId: number): Promise<ReconcileItemResult> {
    const bot = this.getBot();
    if (!bot?.application) {
      return {
        ok: false,
        source: "behavior",
        sourceId: behaviorId,
        error: "bot not ready",
      };
    }

    const row = await Behavior.findByPk(behaviorId);
    if (!row) {
      return {
        ok: false,
        source: "behavior",
        sourceId: behaviorId,
        error: "behavior not found",
      };
    }

    const behaviorRow = rowOfBehavior(row);

    // message_pattern 不在 Discord 指令登記範疇
    if (behaviorRow.triggerType !== "slash_command") {
      return {
        ok: true,
        source: "behavior",
        sourceId: behaviorId,
        action: "noop",
      };
    }

    if (!behaviorRow.enabled) {
      // disabled：從 Discord 刪除（若存在）
      await this.deleteIfExistsForBehavior(bot, behaviorRow);
      return {
        ok: true,
        source: "behavior",
        sourceId: behaviorId,
        action: "delete",
      };
    }

    const item = await this.behaviorToDesiredItem(behaviorRow);
    if (!item) {
      return {
        ok: false,
        source: "behavior",
        sourceId: behaviorId,
        error: "無法計算 desired spec（三軸非法或缺少 slashCommandName）",
      };
    }

    const discordState = await this.fetchDiscordState(bot);
    return this.applyOne(bot, item, discordState);
  }

  /**
   * 增量 reconcile 單條 plugin 自訂指令（plugin register/update 後呼叫）。
   * rowId 對應 plugin_commands.id（featureKey=null 的那半部）。
   */
  async reconcileForPluginCommand(rowId: number): Promise<ReconcileItemResult> {
    const bot = this.getBot();
    if (!bot?.application) {
      return {
        ok: false,
        source: "plugin_command",
        sourceId: rowId,
        error: "bot not ready",
      };
    }

    const row = await PluginCommand.findByPk(rowId);
    if (!row) {
      return {
        ok: false,
        source: "plugin_command",
        sourceId: rowId,
        error: "plugin_command row not found",
      };
    }

    const cmdRow = rowOfPluginCommand(row);
    if (cmdRow.featureKey !== null) {
      // 軌一指令，不由本服務管
      return {
        ok: true,
        source: "plugin_command",
        sourceId: rowId,
        action: "noop",
      };
    }

    const item = await this.pluginCommandToDesiredItem(cmdRow);
    if (!item) {
      return {
        ok: false,
        source: "plugin_command",
        sourceId: rowId,
        error:
          "無法計算 desired spec（schema_version 非 v2、三軸非法、或 plugin 不存在）",
      };
    }

    const discordState = await this.fetchDiscordState(bot);
    return this.applyOne(bot, item, discordState);
  }

  /**
   * 增量 reconcile 單一 guild（OQ-8 補強）。
   *
   * 在 bot 加入新 guild（guildCreate 事件）時呼叫，確保 scope='guild' 的
   * 軌二 behaviors 與軌三 plugin_commands 在該 guild 自動 register，
   * 不需要重啟才生效。
   *
   * 流程：
   *   1. 枚舉 desired set（只取 scope='guild' 的項目）
   *   2. 拉取該 guild 的 Discord 現況
   *   3. diff + apply create / patch（不做 stale 清除，讓 reconcileAll 負責全量 cleanup）
   *   4. 更新 reconciler_owned_commands 名冊（限此 guild）
   */
  async reconcileForGuild(guild: Guild): Promise<ReconcileReport> {
    const bot = this.getBot();
    if (!bot?.application) {
      botEventLog.record(
        "warn",
        "bot",
        `command-reconciler: reconcileForGuild(${guild.id}) bot not ready, skipping`,
      );
      return { created: 0, patched: 0, deleted: 0, errors: [] };
    }

    const report: ReconcileReport = {
      created: 0,
      patched: 0,
      deleted: 0,
      errors: [],
    };

    // 步驟 1：枚舉 desired set，只保留 scope='guild' 的項目
    const allDesired = await this.buildDesiredSet();
    const guildDesired = allDesired.filter((i) => i.spec.scope === "guild");

    if (guildDesired.length === 0) {
      return report;
    }

    // 步驟 2：拉取此 guild 的 Discord 現況
    const discordState = new Map<string, ApplicationCommand>();
    try {
      const guildCmds = await guild.commands.fetch();
      for (const cmd of guildCmds.values()) {
        discordState.set(`guild:${cmd.name}:${guild.id}`, cmd);
      }
    } catch (err) {
      botEventLog.record(
        "warn",
        "bot",
        `command-reconciler: reconcileForGuild(${guild.id}) 拉 guild commands 失敗：${err instanceof Error ? err.message : String(err)}`,
      );
      return report;
    }

    // 步驟 3：diff + apply
    for (const item of guildDesired) {
      const { name, spec, source, sourceId } = item;
      const key = `guild:${name}:${guild.id}`;
      const existing = discordState.get(key);
      try {
        if (!existing) {
          await guild.commands.create(spec.data);
          report.created++;
        } else if (commandNeedsPatch(existing, spec.data)) {
          await guild.commands.edit(existing.id, spec.data);
          report.patched++;
        }
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        report.errors.push({ ok: false, source, sourceId, error });
        botEventLog.record(
          "warn",
          "bot",
          `command-reconciler: reconcileForGuild(${guild.id}) ${name} 失敗：${error}`,
        );
      }
    }

    // 步驟 4：更新名冊（限此 guild 的 guild-scope 項目）
    for (const item of guildDesired) {
      await upsertOwnedCommand({
        name: item.name,
        scope: "guild",
        guildId: guild.id,
      }).catch((e: unknown) => {
        botEventLog.record(
          "warn",
          "bot",
          `command-reconciler: reconcileForGuild 名冊 upsert 失敗 ${item.name}/${guild.id}: ${e instanceof Error ? e.message : String(e)}`,
        );
      });
    }

    botEventLog.record(
      "info",
      "bot",
      `command-reconciler: reconcileForGuild(${guild.id}) 完成 created=${report.created} patched=${report.patched} errors=${report.errors.length}`,
    );

    return report;
  }

  // ── 私有：desired set 建構 ────────────────────────────────────────────────

  private async buildDesiredSet(): Promise<DesiredItem[]> {
    const items: DesiredItem[] = [];

    // OQ-11 最佳化：一次性讀取所有 plugin_behavior_overrides disabled rows，
    // 建 Map<pluginId, Set<behaviorKey>> 供後續 in-memory filter，避免 N+1。
    const disabledOverrides = await findAllDisabledBehaviorOverrides();

    // 步驟 1a：behaviors 表 WHERE enabled=true AND triggerType='slash_command'
    const behaviorRows = await Behavior.findAll({
      where: {
        enabled: true,
        triggerType: "slash_command",
      },
    });

    for (const row of behaviorRows) {
      const behaviorRow = rowOfBehavior(row);

      // OQ-11 過濾：source='plugin' 的 behavior 若 admin 已 override disabled，跳過
      if (
        behaviorRow.source === "plugin" &&
        behaviorRow.pluginId !== null &&
        behaviorRow.pluginBehaviorKey !== null
      ) {
        const disabledKeys = disabledOverrides.get(behaviorRow.pluginId);
        if (disabledKeys?.has(behaviorRow.pluginBehaviorKey)) {
          botEventLog.record(
            "info",
            "bot",
            `command-reconciler: behavior ${behaviorRow.id} (plugin=${behaviorRow.pluginId} key=${behaviorRow.pluginBehaviorKey}) 被 plugin_behavior_override 停用，跳過`,
          );
          continue;
        }
      }

      const item = await this.behaviorToDesiredItem(behaviorRow);
      if (item) items.push(item);
    }

    // 步驟 1b：plugin_commands WHERE featureKey IS NULL（軌三）
    const pluginCmdRows = await PluginCommand.findAll({
      where: {
        featureKey: { [Op.is]: null },
      },
    });

    for (const row of pluginCmdRows) {
      const cmdRow = rowOfPluginCommand(row);
      const item = await this.pluginCommandToDesiredItem(cmdRow);
      if (item) items.push(item);
    }

    return items;
  }

  private async behaviorToDesiredItem(
    row: BehaviorRow,
  ): Promise<DesiredItem | null> {
    if (!row.slashCommandName) return null;

    const integrationTypes = parseIntegrationTypes(row.integrationTypes);
    const contexts = parseContexts(row.contexts);

    // plugin source behaviors may carry slashHints.options from the manifest
    let slashOptions: ManifestCommandOption[] | undefined;
    if (
      row.source === "plugin" &&
      row.pluginId !== null &&
      row.pluginBehaviorKey !== null
    ) {
      const plugin = await findPluginById(row.pluginId);
      if (plugin) {
        try {
          const manifest = JSON.parse(plugin.manifestJson) as PluginManifest;
          const behavior = manifest.behaviors?.find(
            (b: ManifestBehaviorV2) => b.key === row.pluginBehaviorKey,
          );
          if (behavior?.slashHints?.options?.length) {
            slashOptions = behavior.slashHints.options;
          }
        } catch {
          // malformed manifest JSON — proceed without options
        }
      }
    }

    let spec: DiscordRegistrationSpec;
    try {
      spec = deriveRegistrationCall(
        row.slashCommandName,
        row.slashCommandDescription ?? row.title,
        row.scope,
        integrationTypes,
        contexts,
        slashOptions,
      );
    } catch (err) {
      if (err instanceof RejectionError) {
        botEventLog.record(
          "warn",
          "bot",
          `command-reconciler: behavior ${row.id} 三軸非法，跳過：${err.reason}`,
          { behaviorId: row.id },
        );
        return null;
      }
      throw err;
    }

    return {
      name: row.slashCommandName,
      spec,
      source: "behavior",
      sourceId: row.id,
    };
  }

  private async pluginCommandToDesiredItem(
    row: PluginCommandRow,
  ): Promise<DesiredItem | null> {
    // OQ-14 守衛：檢查 plugin 的 manifest schema_version 是否為 '2'
    const plugin = await findPluginById(row.pluginId);
    if (!plugin) return null;

    let manifest: PluginManifest | null = null;
    try {
      const parsed = JSON.parse(plugin.manifestJson) as PluginManifest;
      if (parsed.schema_version !== "2") {
        // v1 plugin，跳過（OQ-14）
        return null;
      }
      manifest = parsed;
    } catch {
      return null;
    }

    // 從 manifestJson 找到對應的 plugin_command 定義
    let cmdManifest: ManifestPluginCommandV2 | null = null;
    try {
      const parsed = JSON.parse(row.manifestJson) as ManifestPluginCommandV2;
      cmdManifest = parsed;
    } catch {
      return null;
    }

    if (!cmdManifest || !cmdManifest.name) return null;

    // 確認 plugin + command 都在 enabled 狀態
    if (!plugin.enabled) return null;
    if (plugin.status !== "active") return null;

    // 確認 adminEnabled（M1-A2 加欄，M1-C2 接線）：admin 可停用個別指令
    if (!row.adminEnabled) return null;

    const integrationTypes = cmdManifest.integration_types.filter(
      (t): t is DiscordIntegrationType =>
        t === "guild_install" || t === "user_install",
    );
    const contexts = cmdManifest.contexts.filter(
      (c): c is DiscordContext =>
        c === "Guild" || c === "BotDM" || c === "PrivateChannel",
    );
    const scope: CommandScope =
      cmdManifest.scope === "guild" ? "guild" : "global";

    let spec: DiscordRegistrationSpec;
    try {
      spec = deriveRegistrationCall(
        cmdManifest.name,
        cmdManifest.description,
        scope,
        integrationTypes,
        contexts,
        cmdManifest.options,
      );
    } catch (err) {
      if (err instanceof RejectionError) {
        botEventLog.record(
          "warn",
          "bot",
          `command-reconciler: plugin_command ${row.id} (${row.name}) 三軸非法，跳過：${err.reason}`,
          { pluginId: row.pluginId, cmdName: row.name },
        );
        return null;
      }
      throw err;
    }

    // manifest 用於 OQ-14 守衛（已在上方使用）
    void manifest;

    return {
      name: cmdManifest.name,
      spec,
      source: "plugin_command",
      sourceId: row.id,
    };
  }

  // ── 私有：Discord 現況拉取 ────────────────────────────────────────────────

  private async fetchDiscordState(
    bot: Client,
  ): Promise<Map<string, ApplicationCommand>> {
    // key: `${scope}:${name}:${guildId ?? ""}`
    const state = new Map<string, ApplicationCommand>();

    // 全域指令
    try {
      const globalCmds = await bot.application!.commands.fetch();
      for (const cmd of globalCmds.values()) {
        state.set(`global:${cmd.name}:`, cmd);
      }
    } catch (err) {
      botEventLog.record(
        "warn",
        "bot",
        `command-reconciler: 拉 global commands 失敗：${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // per-guild 指令
    for (const guild of bot.guilds.cache.values()) {
      try {
        const guildCmds = await guild.commands.fetch();
        for (const cmd of guildCmds.values()) {
          state.set(`guild:${cmd.name}:${guild.id}`, cmd);
        }
      } catch (err) {
        botEventLog.record(
          "warn",
          "bot",
          `command-reconciler: 拉 guild ${guild.id} commands 失敗：${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return state;
  }

  // ── 私有：Diff & Apply 單條 ───────────────────────────────────────────────

  private async applyOne(
    bot: Client,
    item: DesiredItem,
    discordState: Map<string, ApplicationCommand>,
  ): Promise<ReconcileItemResult> {
    const { name, spec, source, sourceId } = item;

    if (spec.scope === "global") {
      const key = `global:${name}:`;
      const existing = discordState.get(key);
      if (!existing) {
        // create
        try {
          await bot.application!.commands.create(spec.data);
          return { ok: true, source, sourceId, action: "create" };
        } catch (err) {
          return {
            ok: false,
            source,
            sourceId,
            action: "create",
            error: err instanceof Error ? err.message : String(err),
          };
        }
      } else {
        if (commandNeedsPatch(existing, spec.data)) {
          try {
            await bot.application!.commands.edit(existing.id, spec.data);
            return { ok: true, source, sourceId, action: "patch" };
          } catch (err) {
            return {
              ok: false,
              source,
              sourceId,
              action: "patch",
              error: err instanceof Error ? err.message : String(err),
            };
          }
        }
        return { ok: true, source, sourceId, action: "noop" };
      }
    } else {
      // guild scope：對每個 bot 所在 guild 操作
      let anyError: string | undefined;
      for (const guild of bot.guilds.cache.values()) {
        const key = `guild:${name}:${guild.id}`;
        const existing = discordState.get(key);
        try {
          if (!existing) {
            await guild.commands.create(spec.data);
          } else if (commandNeedsPatch(existing, spec.data)) {
            await guild.commands.edit(existing.id, spec.data);
          }
        } catch (err) {
          anyError = err instanceof Error ? err.message : String(err);
          botEventLog.record(
            "warn",
            "bot",
            `command-reconciler: guild ${guild.id} ${name} 操作失敗：${anyError}`,
          );
        }
      }
      if (anyError) {
        return {
          ok: false,
          source,
          sourceId,
          action: "patch",
          error: anyError,
        };
      }
      return { ok: true, source, sourceId, action: "noop" };
    }
  }

  // ── 私有：stale 清除 ───────────────────────────────────────────────────────

  private async deleteStale(
    bot: Client,
    name: string,
    scope: CommandScope,
    guildId: string | null,
  ): Promise<void> {
    try {
      if (scope === "global") {
        const cmds = await bot.application!.commands.fetch();
        const cmd = cmds.find((c) => c.name === name);
        if (cmd) await bot.application!.commands.delete(cmd.id);
      } else if (guildId) {
        const guild = bot.guilds.cache.get(guildId);
        if (guild) {
          const cmds = await guild.commands.fetch();
          const cmd = cmds.find((c) => c.name === name);
          if (cmd) await guild.commands.delete(cmd.id);
        }
      }
      await deleteOwnedCommand({ name, scope, guildId });
    } catch (err) {
      botEventLog.record(
        "warn",
        "bot",
        `command-reconciler: stale 清除失敗 ${scope}:${name}：${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async deleteIfExistsForBehavior(
    bot: Client,
    row: BehaviorRow,
  ): Promise<void> {
    if (!row.slashCommandName) return;
    const name = row.slashCommandName;
    const scope: CommandScope = row.scope === "guild" ? "guild" : "global";
    await this.deleteStale(bot, name, scope, null);
  }

  // ── 步驟 5：清舊版 dm-slash-rebind 遺留物 ────────────────────────────────

  /**
   * 清除 dm-slash-rebind 遺留的純 DM 形狀全域指令（C-runtime §3.2 步驟 5a）。
   * 識別條件：contexts = [BotDM, PrivateChannel]（只有 DM context）且 name 不在 desired set。
   */
  private async cleanupLegacyDmSlashCommands(
    bot: Client,
    desiredItems: DesiredItem[],
  ): Promise<void> {
    const desiredNames = new Set(desiredItems.map((i) => i.name));
    try {
      const globalCmds = await bot.application!.commands.fetch();
      for (const cmd of globalCmds.values()) {
        if (desiredNames.has(cmd.name)) continue;

        // 識別「純 DM context」指令（contexts 只有 BotDM + PrivateChannel）
        const ctxs = (cmd.contexts ?? []) as InteractionContextType[];
        const isDmOnly =
          ctxs.length === 2 &&
          ctxs.includes(InteractionContextType.BotDM) &&
          ctxs.includes(InteractionContextType.PrivateChannel);

        if (isDmOnly) {
          try {
            await bot.application!.commands.delete(cmd.id);
            botEventLog.record(
              "info",
              "bot",
              `command-reconciler: 清除 dm-slash-rebind 遺留指令 /${cmd.name}`,
            );
          } catch (err) {
            botEventLog.record(
              "warn",
              "bot",
              `command-reconciler: 清除遺留指令 /${cmd.name} 失敗：${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
      }
    } catch (err) {
      botEventLog.record(
        "warn",
        "bot",
        `command-reconciler: 清舊版產物步驟失敗：${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

// ── 輔助：Sequelize model instance → typed row ───────────────────────────────

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

function rowOfPluginCommand(
  model: InstanceType<typeof PluginCommand>,
): PluginCommandRow {
  return {
    id: model.getDataValue("id") as number,
    pluginId: model.getDataValue("pluginId") as number,
    guildId: (model.getDataValue("guildId") as string | null) ?? null,
    name: model.getDataValue("name") as string,
    discordCommandId:
      (model.getDataValue("discordCommandId") as string | null) ?? null,
    featureKey: (model.getDataValue("featureKey") as string | null) ?? null,
    manifestJson: model.getDataValue("manifestJson") as string,
    adminEnabled:
      model.getDataValue("adminEnabled") !== 0 &&
      model.getDataValue("adminEnabled") !== false,
  };
}
