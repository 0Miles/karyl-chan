# Bot-Side Runtime 模型 / Dispatcher 設計草案 — M0-C

> **狀態**：設計草案（v2，2026-05-01 重寫），尚未實作。本文件是 `fullstack-engineer` 在 P7 設計階段的交付物。
> **版本說明**：此為第二版，前版（v1）保留為歷史參考。
> **關聯文件**：M0-A（schema）、M0-B（SDK）、M0-D（Admin UI）

---

## 前言：本文件的閱讀約定

- **pseudo-TypeScript** 以 `interface` / `type` 描述介面形狀，不代表最終實作路徑。
- **行號引用** 格式：`檔名:行號`，基於 2026-05-01 時的程式碼快照。
- **M0-A 欄位對齊** — 本文件多處需依賴 M0-A 定義的新欄位（三軸：`scope` / `integrationTypes` / `contexts`）。M0-A 尚未完成時，本文件以「`behaviors` v2 預期欄位」標記；完成後須回頭對齊。

---

## 0. 三軌架構總覽

```
軌一：Guild Features（不動）
  └── plugin manifest guild_features → pluginCommandRegistry.sync() 的 per-feature 半部
  └── 5 個 in-process 指令 → in-process-command-registry.service.ts

軌二：Behaviors（webhook 接口層）
  └── source: custom | plugin | system
  └── trigger: slash_command | message_pattern（DM-only）
  └── 三軸可控（admin；system 三軸由 bot seed 固定）

軌三：Plugin 自訂指令
  └── plugin manifest commands[]（非 guild_features）
  └── 三軸由 manifest 寫死；admin 只能 on/off
```

---

## 1. 軌一「不動」清單

以下檔案與行號區段在 v2 重構期間**完全不動**：

| 檔案 | 保留範圍 | 說明 |
|------|---------|------|
| `src/modules/plugin-system/plugin-command-registry.service.ts` | **第 374–420 行** — `sync()` 的 per-feature 半部（`// ── Per-feature commands ─`）| 處理 `guild_features[].commands[]` 的 per-guild 控制邏輯，完整保留 |
| `src/modules/plugin-system/plugin-command-registry.service.ts` | **第 427–477 行** — `registerFeatureCommandInGuild()` | 由 feature 半部呼叫，不動 |
| `src/modules/plugin-system/plugin-command-registry.service.ts` | **第 486–513 行** — `syncFeatureCommandsForGuild()` | admin toggle hook，不動 |
| `src/modules/builtin-features/in-process-command-registry.service.ts` | **全部** | 5 個 in-process 內建指令 + modal dispatch，完整保留 |
| `src/modules/builtin-features/` 各 feature 實作 | 全部 | picture-only / role-emoji / todo-channel / rcon-forward 邏輯不動 |
| `src/modules/behavior/models/behavior-session.model.ts` | **全部** | session 模型本身不動（見第 4 節決策） |

> **邊界劃定原則**：`pluginCommandRegistry.sync()` 中的 global 半部（第 337–371 行，`// ── Top-level (truly global) commands ─`）屬於軌三新模型的**替代目標**，由 `CommandReconciler` 接管。該區段在 M1 實作時從 `sync()` 中移除，但 M0-C 僅定義介面，**不刪程式碼**。

---

## 2. 核心模組介面定義（pseudo-TypeScript）

### 2.1 三軸型別

M0-A 預期在 `behaviors` 表新增以下欄位（M0-A 完成後對齊）：

```typescript
// 對應 Discord InteractionContextType 的字串值
type DiscordContext = "Guild" | "BotDM" | "PrivateChannel";

// 對應 Discord ApplicationIntegrationType 的字串值
type DiscordIntegrationType = "guild_install" | "user_install";

// 指令的 Discord 作用域
type CommandScope = "global" | "guild";

/**
 * 「三軸」 = scope + integrationTypes + contexts
 * 存在 behaviors 表（軌二）與 plugin_commands 表（軌三）
 *
 * behaviors 表新增欄位（M0-A 定義；M0-FROZEN §1.4 鎖定）：
 *   scope: CommandScope         -- 'global' | 'guild'
 *   integrationTypes: string    -- sorted comma-joined，e.g. 'guild_install,user_install'
 *   contexts: string            -- sorted comma-joined，e.g. 'BotDM,PrivateChannel'
 *   （H-1 修：原寫 JSON array，與 M0-FROZEN 拍板的 comma-joined 不一致；應用層讀取後 split(',')）
 */
interface ThreeAxisSpec {
  scope: CommandScope;
  integrationTypes: DiscordIntegrationType[];
  contexts: DiscordContext[];
}
```

### 2.2 CommandReconciler

**建議路徑**：`src/modules/command-system/reconcile.service.ts`

```typescript
/**
 * 統一 reconcile 入口。
 *
 * 職責：
 *   1. 枚舉 DB 中啟用的 behaviors（軌二）與 plugin 自訂指令（軌三）
 *   2. 計算這些 rows 應在 Discord 端呈現的形狀（三軸 → registration call）
 *   3. 與 Discord 現況 diff，apply create / patch / delete
 *   4. 清理舊版產物（dm-slash-rebind 遺留物 + 軌三 global 半部舊登記）
 *
 * 「軌一不動」保證：
 *   reconcileAll() 只操作以下兩類 Discord 指令，不碰其他：
 *   - 已知 behaviors 表產出的指令（可從 triggerValue 反查）
 *   - 已知 plugin_commands 表 featureKey=null 的 rows
 *   任何 featureKey 非 null 的 plugin_commands 由現有 sync() 管理，
 *   本服務不觸碰。
 */
interface CommandReconciler {
  /**
   * 全量 reconcile。
   * 在 bot ready 事件中，繼 syncInProcessCommandsToDiscord() 與
   * pluginCommandRegistry.reconcileAll()（feature 半部）之後呼叫，
   * 接管軌二 + 軌三 global 指令的管理。
   *
   * 錯誤策略：每條 row 獨立 try/catch，單條失敗不阻擋其餘。
   * 完成後記 botEventLog info。
   */
  reconcileAll(): Promise<ReconcileReport>;

  /**
   * 增量 reconcile 單條 behavior（admin CRUD 後呼叫）。
   * behaviorId 對應 behaviors.id。
   * 若該 row 的 triggerType !== 'slash_command' 則為 no-op（message_pattern
   * 不在 Discord 指令登記範疇）。
   */
  reconcileForBehavior(behaviorId: number): Promise<ReconcileItemResult>;

  /**
   * 增量 reconcile 單條 plugin 自訂指令（plugin register / update 後呼叫）。
   * rowId 對應 plugin_commands.id（featureKey=null 的那半部）。
   */
  reconcileForPluginCommand(rowId: number): Promise<ReconcileItemResult>;
}

interface ReconcileReport {
  created: number;
  patched: number;
  deleted: number;
  errors: ReconcileItemResult[];
}

interface ReconcileItemResult {
  ok: boolean;
  source: "behavior" | "plugin_command";
  sourceId: number;
  action?: "create" | "patch" | "delete" | "noop";
  error?: string;
}
```

### 2.3 InteractionDispatcher

**建議路徑**：`src/modules/command-system/interaction-dispatcher.service.ts`

```typescript
/**
 * 統一的 Discord interactionCreate 入口。
 * 取代 main.ts 中的多重 try 分叉。
 *
 * 呼叫者（main.ts）：
 *   bot.on('interactionCreate', async (interaction) => {
 *     const outcome = await interactionDispatcher.dispatch(interaction);
 *     if (!outcome.claimed && interaction.isChatInputCommand()) {
 *       log.warn({ commandName: interaction.commandName }, 'unhandled slash command');
 *     }
 *   });
 */
interface InteractionDispatcher {
  dispatch(interaction: Interaction): Promise<DispatchOutcome>;
}

interface DispatchOutcome {
  /** 是否有 handler 宣告擁有此 interaction */
  claimed: boolean;
  /** 哪一層 handler 宣告擁有 */
  claimedBy?: "behavior_system" | "behavior_custom" | "behavior_plugin"
            | "plugin_command" | "in_process";
  /** 若 claimed=false，提供 fallback 訊息供 log */
  reason?: "unknown_command" | "disabled_plugin" | "no_handler";
  error?: string;
}
```

### 2.4 MessagePatternMatcher

**建議路徑**：`src/modules/command-system/message-pattern-matcher.service.ts`

```typescript
/**
 * 取代 webhook-behavior.events.ts 中的 registerWebhookBehaviorEvents()。
 *
 * 職責：
 *   - 監聽 messageCreate（DM only，見第 4 節關於 guild 的決定）
 *   - 查 behavior_sessions（active session 優先）
 *   - 枚舉適用 behaviors，依 matchesTrigger() 過濾 message_pattern triggers
 *   - 呼叫 WebhookForwarder.forward() 或系統 behavior handler
 *   - 管理 session 生命週期（startSession / endSession）
 *
 * 不處理 slash_command trigger（那是 InteractionDispatcher 的職責）。
 */
interface MessagePatternMatcher {
  /**
   * 掛載到 bot client。
   * 替代 registerWebhookBehaviorEvents(client)。
   */
  register(client: Client): void;

  /**
   * 供測試使用：直接傳入一條 DjsMessage 跑完整派發流程。
   */
  onMessage(djsMessage: DjsMessage): Promise<MessageMatchOutcome>;
}

interface MessageMatchOutcome {
  handled: boolean;
  sessionStarted?: boolean;
  sessionEnded?: boolean;
  behaviorId?: number;
  error?: string;
}
```

### 2.5 WebhookForwarder（v2）

**建議路徑**：`src/modules/command-system/webhook-forwarder.service.ts`（或沿用 `behavior/webhook-dispatch.service.ts` 並新增 source 路由層）

```typescript
/**
 * 取代分散在 user-slash-behavior.service.ts 與
 * webhook-behavior.events.ts dispatchAndHandle() 中的雙路邏輯。
 *
 * 統一 source=custom（v1 type='webhook'，CR-9 改名 source='custom'）與 source=plugin（type='plugin'）兩路。
 * source=system 不流過這裡——系統 behavior 直接由 InteractionDispatcher
 * 內的 system 分支呼叫對應 service function。
 */
interface WebhookForwarder {
  /**
   * @param behavior  behaviors 表的 row（含三軸欄位）
   * @param payload   Discord webhook 形狀的 body
   * @returns         含 ended / relayContent 的結果
   */
  forward(
    behavior: BehaviorRowV2,
    payload: RESTPostAPIWebhookWithTokenJSONBody,
  ): Promise<ForwardResult>;
}

interface ForwardResult {
  ok: boolean;
  ended: boolean;           // [BEHAVIOR:END] sentinel
  relayContent: string;     // stripped & trimmed
  status?: number;          // HTTP 狀態（失敗時）
  error?: string;
}

/**
 * BehaviorRowV2 = 現有 BehaviorRow + M0-A 新增的三軸欄位
 * 完整對齊待 M0-A 完成
 */
interface BehaviorRowV2 extends BehaviorRow {
  scope: CommandScope;
  integrationTypes: DiscordIntegrationType[];
  contexts: DiscordContext[];
}
```

---

## 3. Reconcile 流程

### 3.1 流程 1 — 軌一 guild_features（完全不動）

```
pluginCommandRegistry.reconcileAll()          ← 現有入口，不動
  └── sync(plugin, manifest)
        ├── [第 337–371 行] global 半部       ← M1 時由 CommandReconciler 接管
        └── [第 374–420 行] per-feature 半部  ← 永久保留，本文件不碰
              └── registerFeatureCommandInGuild()
```

**v2 boot 順序**（取代現有 ready handler 順序）：

```
1. syncInProcessCommandsToDiscord(bot)         ← 不動（軌一 in-process）
2. pluginCommandRegistry.reconcileAll()        ← 不動（軌一 feature 半部）
   注：全量 reconcileAll 仍跑，但 M1 後 global 半部 no-op（已由 CommandReconciler 接管）
3. commandReconciler.reconcileAll()            ← 新增（軌二 + 軌三）
   取代 rebindDmOnlyCommandsAsGlobal()
```

### 3.2 流程 2 — 軌二 behaviors + 軌三 plugin 自訂指令

```
CommandReconciler.reconcileAll()
  │
  ├─ 步驟 1：枚舉 desired set
  │     a. behaviors 表：WHERE enabled=true AND triggerType='slash_command'
  │        （軌二所有 source：custom / plugin / system）
  │     b. plugin_commands 表：WHERE featureKey IS NULL AND enabled=true
  │        （軌三，featureKey 非 null 的由 per-feature 路徑管，不碰）
  │
  ├─ 步驟 2：三軸 → Discord 登記形狀
  │     對每條 desired row 呼叫 deriveRegistrationCall(row)
  │     （詳見第 3.3 節「9 種組合表」）
  │
  ├─ 步驟 3：拉 Discord 現況
  │     a. bot.application.commands.fetch()    → global 指令集
  │     b. for each guild: guild.commands.fetch() → guild 指令集
  │     建立 discordState: Map<name, {global?, guilds: Set<guildId>}>
  │
  ├─ 步驟 4：Diff & Apply
  │     對每條 desired row 的 registrationCall：
  │       - 若 Discord 無此 name+scope：create
  │       - 若有但 description / options / contexts / integrationTypes 不同：patch（edit）
  │       - 若有且一致：noop
  │     對 discordState 中未被任何 desired row 認領的指令：
  │       - 若符合「由我們管的指令」條件（見下方標記規則）：delete
  │       - 否則：不動（屬於軌一 in-process 或 discordx legacy）
  │
  └─ 步驟 5：清舊版產物
        a. dm-slash-rebind 遺留物：
           全域指令中 contexts = [BotDM, PrivateChannel]（純 DM 形狀）
           且 name 不在 desired set 內 → delete
        b. 軌三 plugin_commands global 半部的舊版殘留：
           discordCommandId 存在但 plugin disabled / command 已從 manifest 移除
           （已由步驟 4 的 stale 清除機制覆蓋，此為雙保險）
```

**「由我們管的指令」標記規則**：

為了讓 diff 不誤刪軌一指令，reconcile 只認領以下來源的 Discord 指令：
1. 名稱出現在 `desired set` 中的（軌二 triggerValue 或軌三 command name）
2. 名稱出現在「reconcile 管理名冊」中的（啟動時建立，含上一次 reconcile 登記的所有名稱）

不在以上兩者中的指令（如 in-process 的 `/picture-only-channel`、feature 指令等）一律不動。

### 3.3 三軸 → Discord 登記呼叫形狀（8 種合法組合 + 1 種非法示例）

`scope` × `integrationTypes` × `contexts` 的合法組合：

| # | scope | integrationTypes | contexts | Discord 登記型別 | 備注 |
|---|-------|-----------------|----------|----------------|------|
| 1 | global | [guild_install] | [Guild] | `application.commands.create(...)` contexts=[Guild] | 全球 guild context |
| 2 | global | [guild_install] | [Guild, BotDM] | `application.commands.create(...)` contexts=[Guild,BotDM] | 全球可用（guild+DM） |
| 3 | global | [guild_install] | [BotDM, PrivateChannel] | `application.commands.create(...)` contexts=[BotDM,PrivateChannel] | **DM-only（現有 dm-slash-rebind 產物形狀）** |
| 4 | global | [user_install] | [BotDM, PrivateChannel] | `application.commands.create(...)` integrationTypes=[UserInstall] contexts=[BotDM,PrivateChannel] | user-install DM only |
| 5 | global | [user_install] | [Guild, BotDM, PrivateChannel] | `application.commands.create(...)` integrationTypes=[UserInstall] contexts=[全部] | user-install 全 context |
| 6 | global | [guild_install, user_install] | [Guild, BotDM, PrivateChannel] | `application.commands.create(...)` integrationTypes=[兩者] contexts=[全部] | 雙 install 全 context |
| 7 | guild | [guild_install] | [Guild] | `guild.commands.create(...)` per each guild | per-guild 指令（等同現有 per-feature 路徑） |
| 8 | guild | [guild_install] | [Guild, BotDM] | ❌ **非法** | M-8 修：scope=guild + 含 BotDM 違反 I-3 invariant 與 R-4 拍板，應由 deriveRegistrationCall 拒絕 |
| 9 | global | [guild_install] | [Guild, BotDM, PrivateChannel] | `application.commands.create(...)` contexts=[全部] | guild_install 全 context |

**非法組合（明列拒絕，在 Admin UI 層與 reconcile 層雙重攔截）**：

| 非法組合 | 拒絕理由 |
|---------|---------|
| scope=guild + integrationTypes=[user_install] | Guild-scoped 指令無法與 user-install 結合；Discord API 直接拒絕 |
| scope=guild + contexts=[BotDM] | Guild 指令不能只在 DM 出現 |
| scope=guild + contexts=[PrivateChannel] | 同上 |
| scope=global + integrationTypes=[] | integrationTypes 不得為空（Discord API 要求至少一個） |
| contexts=[] | contexts 不得為空（Discord API 要求至少一個） |
| scope=guild + integrationTypes=[guild_install, user_install] | Guild 指令不支援 user_install；Discord 直接拒絕 |

**`deriveRegistrationCall()` 偽碼**：

```typescript
function deriveRegistrationCall(
  row: BehaviorRowV2 | PluginCommandRowV2,
): DiscordRegistrationSpec | RejectionError {
  const { scope, integrationTypes, contexts } = row;

  // 非法組合檢查
  if (integrationTypes.length === 0) return reject("integrationTypes empty");
  if (contexts.length === 0) return reject("contexts empty");
  if (scope === "guild") {
    if (integrationTypes.includes("user_install")) return reject("guild+user_install");
    if (contexts.every(c => c !== "Guild")) return reject("guild scope requires Guild context");
  }

  const base: ApplicationCommandData = {
    type: ApplicationCommandType.ChatInput,
    // M-9 修：v2 後 behaviors 表沒有 triggerValue 欄位（已拆 slashCommandName / messagePatternValue）
    // plugin_commands 表有 name 欄位
    name: row.slashCommandName ?? row.name,
    description: row.description || row.title,
    // options 由 behaviors 表 / plugin manifest 提供
  };

  if (contexts.length > 0) {
    base.contexts = contexts.map(c => CONTEXT_MAP[c]);
  }
  if (integrationTypes.length > 0) {
    base.integrationTypes = integrationTypes.map(t => INTEGRATION_MAP[t]);
  }

  return { scope, data: base };
}
```

---

## 4. InteractionDispatcher 派發路徑

### 4.1 派發順序（第一個 claim 即停）

```
interactionCreate(interaction)
  │
  ├─ [1] isChatInputCommand()
  │    └─ BehaviorDispatcher（behaviors 表，triggerType='slash_command'）
  │         ├─ source=system  → SystemBehaviorHandler（/admin-login /manual /break）
  │         ├─ source=custom  → WebhookForwarder.forward(behavior, payload)
  │         └─ source=plugin  → WebhookForwarder.forward(behavior, payload)
  │              注：plugin behavior 的 forward 走「裸 webhook」路徑（見第 6 節）
  │
  ├─ [2] isChatInputCommand()
  │    └─ PluginCommandDispatcher（plugin_commands 表，featureKey=null）
  │         └─ dispatchChatInputCommand() → HMAC 簽署 POST 至 plugin /commands/<name>
  │         └─ autocomplete → dispatchAutocomplete()（不動，維持現有路徑）
  │
  ├─ [3] isChatInputCommand() || isModalSubmit()
  │    └─ InProcessDispatcher（in-process-command-registry）
  │         └─ dispatchInProcessInteraction()（不動）
  │
  └─ fallback：claimed=false，log warn "unhandled slash command"
```

> **設計決策**：system behavior 放在第 [1] 順位（behaviors 表），由 `source=system` 分支擷取，不另立第 0 層。理由：system rows 本來就是 behaviors 表的一部分，保持 behaviors 表是唯一 slash trigger 查找點，避免兩個 DB query 競速（現有 main.ts 已先查 `findAllSystemBehaviors()` 再查 `dispatchUserSlashBehavior()`，v2 合併成一次查詢）。

### 4.2 Autocomplete 路徑

Autocomplete 互動只可能來自軌三（plugin 自訂指令），因為軌二 behaviors 不支援 autocomplete（沒有 options 宣告）。

```
isAutocomplete()
  └─ PluginCommandDispatcher
       └─ dispatchAutocomplete()（維持現有 plugin-interaction-dispatch.service.ts 路徑，不動）
```

### 4.3 Fallback 策略

| 情況 | 處理方式 |
|------|---------|
| 所有層均未 claim | `claimed=false`，main.ts log warn（不 reply 使用者，避免洩漏內部狀態） |
| behaviors 表查詢失敗 | catch → log error → 繼續嘗試下一層（不短路整個 handler） |
| plugin disabled / missing dispatchHmacKey | `claimed=true`（已宣告擁有），reply 使用者 ephemeral 錯誤訊息 |
| in-process featureKey disabled | `claimed=true`，reply "此伺服器已停用此功能" |

---

## 5. MessagePatternMatcher 流程

### 5.1 適用範圍決策：DM-only

**決定：message_pattern trigger 只支援 DM context（`ChannelType.DM`），不支援 guild channel。**

理由：
1. **效能**：guild messageCreate 是高頻事件（所有文字頻道的每則訊息）。每則訊息都需對 behaviors 表做一次查詢（含 user target / group target / all_dms 三層），在有大型 guild 的環境中會造成顯著 DB 壓力。
2. **語意**：現有 behaviors 的「target」模型（user → group → all_dms）是以 **用戶** 為維度，而非以 **頻道/伺服器** 為維度。Guild trigger 的需求需要全新的 target 設計（channel target / guild target），超出 M0 範圍。
3. **Discord 限制**：bot 在 guild 頻道中讀取訊息需要 `MESSAGE_CONTENT` intent 且受到 Discord 審核限制；DM 已有此 intent 且使用中。
4. **現有行為**：`webhook-behavior.events.ts:269` 第一行即 `if (message.channel.type !== ChannelType.DM) return;`，v2 維持此語意。

若未來需要 guild channel pattern，另立 `GuildPatternMatcher` 並設計 channel-target 模型，不污染現有 DM behaviors 語意。

### 5.2 取代現有 webhook-behavior.events.ts 的對應關係

| 現有邏輯（webhook-behavior.events.ts） | v2 對應 |
|---------------------------------------|---------|
| `registerWebhookBehaviorEvents(client)` | `MessagePatternMatcher.register(client)` |
| `buildPayload(message)` | 移入 `MessagePatternMatcher` 內部（private） |
| `collectApplicableBehaviors(userId)` — user → group → all_dms 三層 | 移入 `MessagePatternMatcher` 內部；**audience 欄位對齊（見下）** |
| `dispatchAndHandle()` | 拆出，呼叫 `WebhookForwarder.forward()` 或 `SystemBehaviorHandler` |
| `relayBack()` | 移入 `MessagePatternMatcher` 內部 |
| session active → 直接 POST 不評估 trigger | 保留邏輯，session 仍由 `behavior_sessions` 管理 |
| `behavior.stopOnMatch` 語意 | 保留 |
| `[BEHAVIOR:END]` sentinel 觸發 `endSession` | 保留 |

**Audience 欄位對齊（M0-A 依賴）**：

若 M0-A 以 `audience` 取代現有的「user target / group target / all_dms」三層查找，`MessagePatternMatcher` 的 `collectApplicableBehaviors()` 等效替換為：

```typescript
// M0-A 定義 audience 欄位後的查詢：
// 取出所有 audience 包含此 userId（直接對映）或 audience=all_dms 的 behaviors
// 若 M0-A 保留原有 behavior_targets 表結構，三層查找邏輯不變
```

**目前假設**：M0-A 未完成時，`collectApplicableBehaviors()` 維持現有三層邏輯（user → group → all_dms），三軸欄位不影響此查找。

### 5.3 continuous session 去留決策

**決定：保留 `behavior_sessions` 表（PK=userId 單活躍 session 語意）。**

理由：
1. **功能完整性**：continuous session 是已上線功能，有使用者依賴。廢除需要等效替代方案且會破壞現有行為。
2. **架構適配**：PK=userId 的單活躍 session 與「一個用戶同時只能有一個持續轉發」的 UX 決策一致。若未來需要多 session，再改；現在廢除是 premature simplification。
3. **無替代收益**：廢除 session 表後，bot 重啟後無法恢復 continuous 狀態，對用戶體驗是退步。

`behavior_sessions` 表結構與 model（`behavior-session.model.ts`）在 v2 中**完全不動**。

`[BEHAVIOR:END]` sentinel 的「觸發 endSession」語意繼續保留（見第 6 節裸 webhook 相容契約）。

---

## 6. 舊三條退場路徑

### 6.1 dm-slash-rebind.service.ts（要退場）

**退場計畫**：

```
M0（本次）：介面設計，不動原始碼
M1：
  Step 1：CommandReconciler.reconcileAll() 第一次跑時，
          執行「清舊產物」步驟（第 3.2 節步驟 5a）：
          掃描 bot.application.commands 中 contexts=[BotDM,PrivateChannel]（純 DM 形狀）
          且 name 不在 desired set 的 global 指令，逐一 delete
  Step 2：dm-slash-rebind.service.ts 整檔刪除
  Step 3：main.ts 中的 rebindDmOnlyCommandsAsGlobal() 呼叫移除
          behavior-routes.ts 中的 rebindDmSlashService() 呼叫移除，
          改為呼叫 commandReconciler.reconcileForBehavior(id)
```

**覆蓋現有行為**：

| dm-slash-rebind 現有行為 | CommandReconciler 等效行為 |
|------------------------|--------------------------|
| 枚舉 system behaviors + all_dms user slash behaviors | 枚舉 behaviors 表 WHERE triggerType='slash_command' AND enabled=true |
| 刪除 per-guild 副本 | reconcile diff 步驟：guild scope 指令若 desired set 不含 guild 指令，delete |
| 刪除純 DM global 舊版（名稱不在 desired set 中） | 步驟 5a 清舊產物 |
| 建立缺少的 DM-only global 指令 | 步驟 4 create |

### 6.2 in-process 的 5 個內建（保留）

`in-process-command-registry.service.ts` 全部保留，邏輯不動。

`dispatchInProcessInteraction()` 在 InteractionDispatcher 中作為第 [3] 層呼叫（不動）。

### 6.3 plugin-command-registry.service.ts 的 global 半部（移交）

| 現有半部 | v2 歸屬 | 時程 |
|---------|---------|------|
| 第 337–371 行：`sync()` global 半部（`application.commands.create(data)`） | 由 `CommandReconciler` 接管（軌三） | M1 |
| 第 374–420 行：`sync()` per-feature 半部 | **保留不動**（軌一） | 永久 |
| `reconcileAll()` 第 536–556 行 | M1 後：global 半部改為 no-op / 委派給 CommandReconciler；feature 半部呼叫保留 | M1 |

**M0 不動任何程式碼**，僅設計介面。

### 6.4 user-slash-behavior.service.ts + system-behavior.service.ts（統一到 dispatcher）

| 舊模組 | v2 等效 | 退場時程 |
|-------|--------|---------|
| `dispatchUserSlashBehavior()` in `user-slash-behavior.service.ts` | `InteractionDispatcher` 第 [1] 層的 `source=custom` / `source=plugin` 分支 | M1 |
| `runManualForInteraction()` / `runBreakForInteraction()` in `system-behavior.service.ts` | `InteractionDispatcher` 第 [1] 層的 `source=system` 分支（繼續呼叫同一 service function） | 保留 service function，移除 main.ts 直接呼叫 |
| `runManualForMessage()` / `runBreakForMessage()` in `system-behavior.service.ts` | `MessagePatternMatcher` 內的 system behavior handler | 保留 function，由新 matcher 呼叫 |
| main.ts 中的三重 try 分叉（system / user-slash / in-process / plugin） | 單一 `interactionDispatcher.dispatch(interaction)` | M1 |

---

## 7. 裸 Plugin Webhook 相容契約

### 7.1 POST Schema

**Bot 對 plugin behavior URL 的 POST 完整對齊 `RESTPostAPIWebhookWithTokenJSONBody`**：

```typescript
// 與 Discord native channel webhook POST 相同形狀
interface PluginBehaviorWebhookBody extends RESTPostAPIWebhookWithTokenJSONBody {
  // 繼承 Discord 原生欄位：
  //   content?: string
  //   username?: string
  //   avatar_url?: string
  //   embeds?: APIEmbed[]
  //   allowed_mentions?: AllowedMentionsTypes
  //   components?: APIActionRowComponent[]
  //   files?: ...
  //   payload_json?: string
  //   attachments?: APIAttachment[]
  //   flags?: MessageFlags
  //   thread_name?: string
  //   applied_tags?: string[]
  //   poll?: APIPoll
}
```

此形狀**完全相容** Discord 原生 channel webhook POST，plugin 可以直接接 Discord webhook 消費邏輯。

### 7.2 HMAC 簽署策略決策

**決定：Plugin behavior（source=plugin，type='plugin'，behaviors 表）不由 bot 主動簽署；plugin 可在 admin UI 的 behavior 設定欄位 `webhookSecret` 達成自訂簽署效果。**

詳細抉擇：

| 選項 | 說明 | 採用？ |
|------|------|-------|
| A：bot 用 `dispatchHmacKey` 簽署 plugin behavior | 沿用 plugin 自訂指令的 HMAC 路徑 | 否 |
| B：bot 不簽署，plugin 在 admin behavior UI 設 `webhookSecret` | 裸 webhook 相容，接入成本低 | **是** |

選 B 的理由：
1. **相容性目標**：「裸 webhook」設計意圖就是讓 plugin 的 behavior URL 可以是任何標準 HTTP webhook，包括非 karyl-chan 的第三方服務（Slack incoming webhook、Make.com 等）。這些服務不理解 `X-Karyl-Signature`，強制簽署會破壞相容性。
2. **Plugin 自訂指令走 HMAC**（因為指令邏輯需要信任 interaction_id / user info，偽造有安全風險）。**Plugin behavior 走裸 webhook**（payload 只是 Discord 訊息形狀，無需信任 bot 身份），安全模型不同。
3. **Admin 控制**：若 plugin owner 想要驗簽，在 admin/behaviors 頁面填 `webhookSecret`，bot 會加上 `X-Karyl-Signature` / `X-Karyl-Signature-V1`（現有 `webhook-dispatch.service.ts` 的 HMAC 路徑）。這是 opt-in 而非強制。

**結論**：
- `source=plugin`，`type='plugin'`，`behaviors` 表中的 row → bot POST 時，若 `webhookSecret` 為 null，不加簽署標頭（裸 webhook）；若有 `webhookSecret`，走現有 v0+v1 雙簽路徑。
- `plugin_commands` 表的 plugin 自訂指令 → 繼續強制用 `dispatchHmacKey` 簽署（不變）。

### 7.3 [BEHAVIOR:END] sentinel 保留決定

**決定：保留 `[BEHAVIOR:END]` sentinel 語意。**

理由：
1. 現有 plugin 可能已依賴此 sentinel 結束 continuous session。廢除是 breaking change。
2. sentinel 語意（後端主動結束 session）是合理的 UX 設計：webhook 服務端判斷對話已完成，無需用戶手動 /break。
3. 在「裸 webhook」場景中，plugin 可以選擇不使用 sentinel（純轉發），不影響基本功能。

`BEHAVIOR_END_TOKEN = "[BEHAVIOR:END]"` 保留在 `webhook-dispatch.service.ts`（或 v2 的 `WebhookForwarder` 中）。

### 7.4 Error / Response 形狀

```
bot POST to plugin behavior URL
  ├─ HTTP 2xx → 解析 body 為 APIMessage，提取 relayContent，檢查 [BEHAVIOR:END]
  ├─ HTTP 4xx/5xx → ForwardResult { ok: false, status, error: body.slice(0,500) }
  └─ network error → ForwardResult { ok: false, error: "network error: <msg>" }

relayContent 邏輯（不變）：
  rawContent = response.content
  ended = BEHAVIOR_END_RE.test(rawContent)
  relayContent = ended ? rawContent.replace(BEHAVIOR_END_RE, '').trim() : rawContent.trim()
```

---

## 8. 與 M0-A 表結構欄位的對齊需求

以下對映在 M0-A 完成後需回頭驗證（目前為「預期欄位」假設）：

| 本文件使用的欄位 | 預期所在表 | M0-A 對應欄位名稱 | 備注 |
|----------------|-----------|----------------|------|
| `BehaviorRowV2.scope` | `behaviors` | `scope` | `'global' \| 'guild'` |
| `BehaviorRowV2.integrationTypes` | `behaviors` | `integrationTypes` | sorted comma-joined string（H-1 修；M0-FROZEN §1.4） |
| `BehaviorRowV2.contexts` | `behaviors` | `contexts` | sorted comma-joined string（H-1 修；M0-FROZEN §1.4） |
| `behaviors.source` | `behaviors` | `source` | `'custom' \| 'plugin' \| 'system'` |
| plugin_commands v2 的三軸 | `plugin_commands` | 待 M0-D 定義 | 軌三 manifest 寫死三軸 |

**現有 behaviors 表欄位使用**（已確認，不變）：

| 本文件引用 | 現有欄位 | 位置 |
|-----------|---------|------|
| `behavior.triggerValue` | `behaviors.triggerValue` | behavior.model.ts:56 |
| `behavior.triggerType` | `behaviors.triggerType` | behavior.model.ts:48 |
| `behavior.type` | `behaviors.type` (`'webhook' \| 'plugin' \| 'system'`) | behavior.model.ts:93 |
| `behavior.pluginId` | `behaviors.pluginId` | behavior.model.ts:99 |
| `behavior.pluginBehaviorKey` | `behaviors.pluginBehaviorKey` | behavior.model.ts:103 |
| `behavior.webhookSecret` | `behaviors.webhookSecret` | behavior.model.ts:69 |
| `behavior.enabled` | `behaviors.enabled` | behavior.model.ts:83 |
| session PK | `behavior_sessions.userId` | behavior-session.model.ts:22 |

---

## 9. 開放問題（M1+ 解決）

| # | 問題 | 建議 |
|---|------|------|
| OQ-1 | `behaviors.source` 欄位是否在 M0-A 中以新 column 形式加入，還是由 `type='system'` 推導？ | 建議加獨立 `source` column，語意更明確 |
| OQ-2 | 軌三 plugin 自訂指令的三軸在 `plugin_commands` 表還是 manifest 讀取？若從 manifest 動態讀，reconcile 時需 manifest in memory | M0-D 定義後對齊 |
| OQ-3 | `CommandReconciler` 管理的「登記名冊」（避免誤刪軌一指令）以什麼形式持久化？DB table vs in-memory Set（重啟後重建） | 建議 DB table `reconciler_owned_commands(name, scope, guildId)`，重啟安全 |
| OQ-4 | `guild` scope 的軌二 behavior（admin 可設 scope=guild）需要 bot 在每個 guild 登記 — bot 加入新 guild 時需增量 register。guildCreate handler 邏輯需對齊 | M1 實作時設計 |
| OQ-5 | plugin behavior（source=plugin）的 admin UI 入口是在哪個頁面建立？M0-B 需確認 | M0-B 對齊 |
| OQ-6 | continuous session 的 timeout 機制（session 存在但 behavior 被 disable 的 edge case 現在靠「dispatch 後發現 behavior disabled 再 endSession」處理）是否在 v2 改為 DB-side expiry？ | 建議 M1+ 加 `expiresAt` 欄位，但不阻擋 M0-C |

---

## 附錄 A：M0 三大設計風險拍板記錄

### 風險 1：message_pattern 在 guild context 的支援 — **不支援**（已拍板）

**拍板答案**：v2 的 `MessagePatternMatcher.onMessage()` 在第一行 gate `channel.type !== ChannelType.DM → return`，guild context message 全部丟棄。

**理由**（三點）：
1. 效能：guild messageCreate 是高頻事件，O(n×m) 查表代價在大型 guild 不可接受。
2. 語意錯配：现有 behavior target 模型以「用戶」為維度，guild channel 需要全新 `channel_target` 設計，超出 M0 範圍。
3. 現行程式碼已有此 gate（`webhook-behavior.events.ts:269`），v2 維持語意不是退步。

**後續**：若未來有 guild channel pattern 需求，另立 `GuildPatternMatcher` + `channel_target` 表，不污染 behaviors 語意。

---

### 風險 2：HMAC 簽署策略 — **自訂指令簽 / plugin behavior 不簽**（已拍板）

**拍板答案**：

| 路徑 | 簽署方式 |
|------|---------|
| 軌三 plugin_command dispatch（bot → plugin `/commands/<name>`） | 強制 `X-Karyl-Signature-V1`，使用 `plugin.dispatchHmacKey` |
| 軌二 custom behavior（v1 type='webhook'，CR-9 改名 source='custom'） | 沿用 v1：依 `webhookAuthMode` 欄位決定簽署方式（'token' / 'hmac' / NULL），對應 M0-FROZEN CR-2 兩 mode 並存 |
| 軌二 plugin behavior（v1 type='plugin'，源自 plugin manifest behaviors[]） | **預設不簽**（裸 HTTP POST，CR-2 無模式）；admin 在 UI 設 `webhookSecret` + `webhookAuthMode` 即啟用對應 mode（opt-in） |
| 軌二 system behavior（type='system'） | 不適用（不發外部 HTTP） |

**理由**：plugin behavior 的 `webhook_path` 設計目標是可直接被 Discord 原生 channel webhook 系統呼叫。Discord 不帶 HMAC，強制簽署會讓 plugin 必須實作 signed/unsigned 雙路徑，破壞「裸 webhook 相容」的核心設計目標。安全驗證透過 admin 設定 `webhookSecret` opt-in 達成，與 admin behavior 路徑一致。

---

### 風險 3：continuous session（behavior_sessions）去留 — **保留**（已拍板）

**拍板答案**：`behavior_sessions` 表（`behavior-session.model.ts` 全檔）與 `startSession / endSession / findActiveSession` 語意完全不動。`[BEHAVIOR:END]` sentinel 保留。

**理由**：
1. bot 重啟後 session 持續依賴 DB 持久化，廢除是功能退步。
2. PK=userId 的單活躍 session 語意符合「一用戶同時只有一個持續轉發」的 UX 決策。
3. v2 唯一異動是呼叫點從 `webhook-behavior.events.ts` 搬移到 `MessagePatternMatcher`，表結構與 model 不動。

---

## 附錄 B：對其他子任務的硬依賴 / 需對齊命名欄位

| 對齊點 | 依賴方向 | 具體需求 |
|--------|---------|---------|
| **M0-A schema** | C 依賴 A | `behaviors` 表新增 `source` 欄位（enum: `'custom'/'plugin'/'system'`）；三軸欄位名稱 `scope / integrationTypes / contexts`（或 snake_case 版本）需確認；`plugin_commands` 表的 v2 表名與三軸欄位需確認 |
| **M0-A schema** | C 依賴 A | 若 M0-A 以 `audience` 欄位取代現有 `behavior_targets` 三層結構，`MessagePatternMatcher.collectApplicableBehaviors()` 的查詢邏輯需對應調整 |
| **M0-B SDK** | C 與 B 對齊 | `BehaviorSource` 型別（`'custom'/'plugin'/'system'`）與 B 的 `ManifestBehavior` behaviors 表 source 語意一致；`webhookSecret` opt-in HMAC 的 header 名稱已在 B §6.2 定義為 `X-Plugin-Webhook-Token`，但本文採用現有 `X-Karyl-Signature-V1` — **需二選一對齊，建議採 B 的定義（`X-Plugin-Webhook-Token` 作為裸 token，有 HMAC 需求走 `X-Karyl-Signature-V1`）** |
| **M0-D admin UI** | D 依賴 C | behavior 三軸的 `scope/integrationTypes/contexts` 欄位由 admin UI 設定後寫入 DB；`CommandReconciler.reconcileForBehavior(behaviorId)` 是 admin CRUD 後的觸發點，D 需確認 API handler 的呼叫時機 |
| **M0-B assertNoCollisions** | B 依賴 C 確認 | B §4.3 標記 `manual/break/login` 若改走軌二 system behavior，從 plugin command reserved set 移除。**C 的結論**：`manual/break/login` 是 `source=system` 的 behaviors 表 row，不屬於 `plugin_commands` 表，因此 plugin command 的 reserved set **不需包含這三個名稱**。但建議在 `assertNoCollisions` 額外查 behaviors 表的 `triggerType='slash_command'` rows，避免 plugin command 與 behavior slash trigger 名稱碰撞（否則 Layer 1 永遠先攔截，plugin command 的對應指令永遠不會執行到 Layer 2） |
| **M1 實作** | M1 依賴 C | CommandReconciler、InteractionDispatcher、MessagePatternMatcher 的介面定義（本文件）是 M1 的 Task Prompt 輸入 |
