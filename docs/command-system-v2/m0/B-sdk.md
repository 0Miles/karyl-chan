# Plugin SDK v2 介面與 Manifest Schema 設計草案 — M0-B

> **狀態**：設計草案 v2（M0-B 完整版），尚未實作。
> **版本**：schema_version `"2"`（破壞性升級，v1 manifest 一律拒絕）
> **對應票**：指令架構 v2 重構 M0-B
> **基於實際讀取**：
> - `karyl-chan-plugins/packages/sdk/src/types.ts`（L1-73）
> - `karyl-chan-plugins/packages/sdk/src/manifest.ts`（L1-85）
> - `karyl-chan-plugins/packages/sdk/src/plugin.ts`（L1-218）
> - `karyl-chan-plugins/packages/sdk/src/index.ts`（L1-18）
> - `karyl-chan/src/modules/plugin-system/plugin-registry.service.ts`（L48-334）

---

## 1. 新 Manifest v2 Schema

### 1.1 頂層結構

```typescript
interface PluginManifestV2 {
  schema_version: "2";                      // 字串常量，不接受任何其他值

  plugin: {
    id: string;                             // [a-z0-9][a-z0-9-]* （不變）
    name: string;
    version: string;
    description?: string;
    author?: string;
    homepage?: string;
    url: string;                            // plugin base URL（http/https）
    healthcheck_path?: string;              // 保留相容，實作固定 /health
  };

  rpc_methods_used?: string[];
  storage?: {
    guild_kv?: boolean;
    guild_kv_quota_kb?: number;
    requires_secrets?: boolean;
  };
  config_schema?: ManifestConfigField[];    // plugin 級 admin config（不變）

  // ── 軌一：Guild features（不動）──────────────────────────────────────
  guild_features?: ManifestGuildFeatureV2[];

  // ── 軌二：Behaviors（webhook 接口層）─────────────────────────────────
  behaviors?: ManifestBehavior[];

  // ── 軌三：Plugin 自訂指令（plugin 鎖死三軸）──────────────────────────
  plugin_commands?: ManifestPluginCommand[];

  events_subscribed_global?: string[];

  endpoints?: {
    events?: string;
    plugin_command?: string;               // 取代 v1 的 endpoints.command
    guild_feature_action?: string;
    // 注意：behaviors 不走 endpoints，每條 behavior 自帶 webhook_path
    // 注意：v1 endpoints.dm_behavior_dispatch 在 v2 廢棄
  };
}
```

---

### 1.2 軌一：`guild_features[]`（unchanged from v1）

```typescript
interface ManifestGuildFeatureV2 {
  key: string;
  name: string;
  icon?: string;
  description?: string;
  enabled_by_default?: boolean;
  events_subscribed?: string[];
  config_schema?: ManifestConfigField[];
  surfaces?: string[];
  overview_metrics?: Array<{ key: string; label: string; type: string }>;
  commands?: ManifestCommand[];            // guild-scoped slash，隨 feature toggle
}
```

**設計說明**：`guild_features[]` 完全沿用 v1 `ManifestGuildFeature`，僅改名為
`ManifestGuildFeatureV2` 以表示它屬於 v2 schema。內部欄位結構不變。

---

### 1.3 軌二：`behaviors[]`（webhook 接口層，admin 可控三軸）

```typescript
interface ManifestBehavior {
  /**
   * 唯一識別鍵，在該 plugin 內不重複。
   * 格式：[a-z0-9][a-z0-9-_]* （建議用底線分隔，與 command name 的 `-` 區分）
   */
  key: string;

  /** 顯示名稱，展示於 admin UI behaviors 管理頁面。 */
  name: string;

  /** 描述，讓 admin 了解此 behavior 的功能。 */
  description?: string;

  /**
   * Webhook 接收路徑（相對於 plugin.url）。
   * 例如 "/webhooks/notify"，最終 bot 呼叫的 URL 為
   * `{plugin.url}{webhook_path}`。
   *
   * 裸 webhook 相容契約（見第 6 節）：
   * - 若 slashHints 不存在，此路徑必須直接接受 Discord 原生 channel
   *   webhook payload（RESTPostAPIWebhookWithTokenJSONBody），
   *   且可被 admin 當作 native Discord channel webhook 填入 Guild channel。
   * - 若 slashHints 存在，bot 會在 admin 設定 slash trigger 後將
   *   slash interaction 以 plugin RPC 形式 POST 到此路徑。
   */
  webhook_path: string;

  /**
   * 可選 slash trigger 元資訊。
   * 存在時，admin 在 /admin/behaviors 頁面可以把此 behavior 接成
   * slash command trigger；三軸（scope/integration_types/contexts）
   * 由 admin 在 UI 設定，plugin manifest 不寫死。
   *
   * 不存在時：此 URL 是純 webhook 接口，可直接當 native Discord
   * channel webhook 使用，不出現在 slash command 管理列表中。
   */
  slashHints?: {
    /** 建議的 slash command name（admin 可覆蓋）。 */
    suggested_name?: string;
    /** 指令說明文字（admin 可覆蓋）。 */
    suggested_description?: string;
    /** 指令 options 定義（給 admin UI 渲染用，admin 不可改結構）。 */
    options?: ManifestCommandOption[];
  };

  config_schema?: ManifestConfigField[];  // per-behavior admin config
  supports_continuous?: boolean;          // 沿用 v1 dm_behaviors 語意
}
```

**重點**：behaviors 的三軸（scope/integration_types/contexts）**完全不在 manifest 寫**，
由 admin 在 UI 操作後儲存到 bot 的 `behavior_configs` 表。Plugin 只宣告「我能接什麼 HTTP 請求」。

---

### 1.4 軌三：`plugin_commands[]`（plugin 鎖死三軸，admin 只能 on/off）

```typescript
interface ManifestPluginCommand {
  /** Discord slash command name，格式 [a-z0-9][a-z0-9-]{0,31}。 */
  name: string;

  /**
   * 指令說明文字。必填，且必須是非空字串。
   * v2 新增強制要求：description 空字串視為驗證失敗。
   */
  description: string;

  /**
   * 三軸：plugin manifest 寫死，admin 不可改。
   * Bot 端 validateManifest 必須拒絕任何試圖由 admin API patch 這三欄的請求。
   */
  scope: "guild" | "global";
  integration_types: Array<"guild_install" | "user_install">;
  contexts: Array<"Guild" | "BotDM" | "PrivateChannel">;

  options?: ManifestCommandOption[];

  /**
   * Discord permission bitfield（plugin manifest 寫死，admin 不可改）。
   * 格式同 v1：PermissionFlagsBits key 名稱字串，例如 "ManageGuild"。
   */
  default_member_permissions?: string;

  default_ephemeral?: boolean;
  required_capability?: string;
}
```

**重點**：`scope`、`integration_types`、`contexts` 三欄在 v2 manifest 全為**必填**，
admin API 層必須保證這三欄不能被 PATCH 覆寫。

---

## 2. v1 → v2 對應表

| v1 欄位 | v2 位置 | 備注 |
|---------|---------|------|
| `manifest.commands[]` | `plugin_commands[]` | 三軸必須明確填入；v1 contexts 省略代表 `["Guild"]` |
| `manifest.dm_behaviors[]` | `behaviors[]` | trigger 預設純 webhook；若需要 slash 入口，補 `slashHints` |
| `manifest.guild_features[].commands[]` | `guild_features[].commands[]` | 不變 |
| `manifest.endpoints.command` | `manifest.endpoints.plugin_command` | 路由鍵改名 |
| `manifest.endpoints.dm_behavior_dispatch` | 廢棄；改為各 behavior 自帶 `webhook_path` | — |
| `schema_version: "1"` | `schema_version: "2"` | 破壞性升級 |

### 細部說明

**`manifest.commands[]` → `plugin_commands[]`**

v1 的 `commands[]` 沒有強制 scope/integration_types/contexts，由 bot 端推斷預設值。
v2 要求 plugin 作者明確宣告三軸：

```
v1: { name: "ask", description: "...", contexts: ["BotDM", "PrivateChannel"] }
v2: {
  name: "ask",
  description: "...",
  scope: "global",
  integration_types: ["guild_install", "user_install"],
  contexts: ["BotDM", "PrivateChannel"]
}
```

**`manifest.dm_behaviors[]` → `behaviors[]`**

v1 的 `dm_behavior` 是一個「行為描述」，不帶 webhook 路徑，由 `endpoints.dm_behavior_dispatch`
統一接收後 bot 端 multiplex。v2 改為每條 behavior 自帶 `webhook_path`，bot 直接打對應 URL：

```
v1: { key: "chat", name: "聊天模式", description: "...", config_schema: [...] }
v2: {
  key: "chat",
  name: "聊天模式",
  description: "...",
  webhook_path: "/webhooks/chat",
  config_schema: [...]
}
```

若 v1 的 dm_behavior 有附帶 slash command 觸發入口（透過 `manifest.commands[]` 間接對應），
v2 需要在對應的 `behaviors[]` 條目加上 `slashHints`，並從 `plugin_commands[]` 移除。

---

## 3. 新 SDK TypeScript 介面定義（命名建議）

### 3.1 型別層（`types.ts`）

```typescript
// ── 沿用不變 ──────────────────────────────────────────────────────────
export interface Logger { ... }             // 不變
export interface CommandContext { ... }     // 不變（軌三沿用）
export type CommandReply = ...;             // 不變
export interface CommandOption { ... }      // 改名為 ManifestCommandOption
export type InteractionContext = "Guild" | "BotDM" | "PrivateChannel";  // 不變

// ── 新增：軌二 Behavior handler 型別 ──────────────────────────────────

/**
 * Webhook 原始 payload，對應 Discord RESTPostAPIWebhookWithTokenJSONBody。
 * Plugin 可選擇只用其中欄位，或直接 pass-through 給 Discord。
 */
export interface WebhookPayload {
  content?: string;
  username?: string;
  avatar_url?: string;
  embeds?: unknown[];
  allowed_mentions?: unknown;
  components?: unknown[];
  files?: unknown[];        // multipart 不支援，保留型別相容
  tts?: boolean;
  flags?: number;
}

/**
 * Behavior handler 接收到的上下文。
 * 比 CommandContext 輕量：不帶 Discord interaction 語意，只帶 HTTP 原語。
 */
export interface BehaviorContext {
  /** Plugin key（= manifest.plugin.id）。 */
  pluginKey: string;
  /** Behavior key（來自 manifest behaviors[].key）。 */
  behaviorKey: string;
  /**
   * 原始請求 body。
   * - 若由 bot slash trigger 呼叫：內容為 bot 合成的 slash interaction payload。
   * - 若由外部 webhook 呼叫：內容為呼叫方 POST 的 body（plugin 自行解析）。
   */
  body: unknown;
  /** HTTP headers（已移除 Authorization）。 */
  headers: Record<string, string>;
  /** Logger。 */
  log: Logger;
  /** Bot RPC（同 CommandContext.botRpc）。 */
  botRpc(path: string, body?: unknown): Promise<unknown | null>;
}

/**
 * Behavior handler 回傳值。
 * - 若要回應 webhook 呼叫方：回傳 WebhookPayload 或 string（= { content: string }）。
 * - 若不需回應（fire-and-forget）：回傳 null 或 undefined。
 */
export type BehaviorReply = WebhookPayload | string | null | undefined;
```

### 3.2 `defineBehavior`（軌二）

```typescript
/**
 * 定義一個 behavior（軌二 webhook 接口層條目）。
 * 回傳定義物件不變（類型化建構子，同 defineCommand 的 pattern）。
 *
 * @param def.key        唯一識別鍵，對應 manifest behaviors[].key
 * @param def.description 說明文字
 * @param def.webhookPath  掛載於 plugin HTTP server 的路徑（對應 manifest behaviors[].webhook_path）
 * @param def.slashHints   可選；若存在，SDK 在 server 上額外掛一條 slash dispatch 路由
 * @param def.handler      接收 BehaviorContext，回傳 BehaviorReply
 */
export function defineBehavior(def: BehaviorDefinition): BehaviorDefinition;

export interface BehaviorDefinition {
  key: string;
  description: string;
  webhookPath: string;
  slashHints?: {
    suggestedName?: string;
    suggestedDescription?: string;
    options?: CommandOption[];
  };
  handler: (ctx: BehaviorContext) => BehaviorReply | Promise<BehaviorReply>;
}
```

### 3.3 `definePluginCommand`（軌三）

```typescript
/**
 * 定義一條 plugin 自訂指令（軌三）。
 * 三軸（scope/integrationTypes/contexts）在此寫死，SDK 生成 manifest 時
 * 原樣輸出；bot 端不接受 admin patch 這三個欄位。
 *
 * 取代既有 v1 `defineCommand`（後者已 @deprecated，見 §3.5）。
 */
export function definePluginCommand(
  def: PluginCommandDefinition,
): PluginCommandDefinition;

export interface PluginCommandDefinition {
  name: string;
  description: string;

  /** 三軸，manifest 寫死。 */
  scope: "guild" | "global";
  integrationTypes: Array<"guild_install" | "user_install">;
  contexts: InteractionContext[];

  options?: CommandOption[];
  defaultMemberPermissions?: string;
  defaultEphemeral?: boolean;
  requiredCapability?: string;

  handler: (ctx: CommandContext) => CommandReply | Promise<CommandReply>;
}
```

### 3.4 `definePlugin`（新形狀）

```typescript
export interface PluginConfigV2 {
  key: string;
  name: string;
  version: string;
  description?: string;
  rpcMethodsUsed: string[];
  storage?: { guildKv?: boolean };

  /** 軌三：plugin 自訂指令（三軸寫死）。 */
  pluginCommands?: PluginCommandDefinition[];

  /** 軌二：webhook 接口層條目。 */
  behaviors?: BehaviorDefinition[];

  /**
   * 軌一：guild feature 定義。
   * 目前 SDK 端只攜帶 manifest metadata；
   * feature 的 slash commands 由 bot 端 guild-feature sync 管理。
   */
  guildFeatures?: GuildFeatureDefinition[];

  onReady?: (server: FastifyInstance) => void | Promise<void>;
}

export interface GuildFeatureDefinition {
  key: string;
  name: string;
  icon?: string;
  description?: string;
  enabledByDefault?: boolean;
  eventsSubscribed?: string[];
  configSchema?: ManifestConfigField[];
  surfaces?: string[];
  overviewMetrics?: Array<{ key: string; label: string; type: string }>;
  commands?: PluginCommandDefinition[];  // guild-scoped，不帶 handler（bot 端 dispatch）
}

/**
 * @deprecated PluginConfig — 請改用 PluginConfigV2 + definePlugin
 */
export interface PluginConfig { ... }    // 保留型別相容，廢棄標記

export function definePlugin(config: PluginConfigV2): PluginInstance;
```

### 3.5 既有 API 去留

| 名稱 | v2 狀態 | 說明 |
|------|---------|------|
| `defineCommand` | **廢棄** → 改用 `definePluginCommand` | 軌三的型別化建構子 |
| `CommandContext` | **保留** | 軌三 handler 沿用 |
| `CommandReply` | **保留** | 軌三 handler 沿用 |
| `CommandOption` | **保留**（可選改名 `ManifestCommandOption`） | 兩軌共用 |
| `InteractionContext` | **保留** | 軌三三軸型別 |
| `buildManifest` | **廢棄** → SDK 內部自動建構 | v2 不再需要 plugin 手動呼叫 |
| `ManifestConfig` | **廢棄** → `PluginConfigV2` | — |
| `Manifest` | **廢棄** → `PluginManifestV2` | — |

---

## 4. Validation 規則表（給 bot 端 `validateManifest` 用）

### 4.1 頂層必要檢查

| 規則 ID | 欄位 | 檢查 | 失敗行為 |
|---------|------|------|---------|
| V-01 | `schema_version` | 必須等於字串 `"2"`（不接受整數 2、不接受 `"1"`） | 拒絕，回 `unsupported schema_version` |
| V-02 | `plugin.id` | `/^[a-z0-9][a-z0-9-]*$/`（不變） | 拒絕 |
| V-03 | `plugin.url` | 必須是 http/https，通過 SSRF guard（不變） | 拒絕 |
| V-04 | `behaviors` / `plugin_commands` / `guild_features` | 若存在必須是 array | 拒絕 |
| V-05 | `plugin_commands[].description` | 必須是非空字串（v2 新增強制要求） | 拒絕 |
| V-06 | `plugin_commands[].scope` | 必須是 `"guild"` 或 `"global"` | 拒絕 |
| V-07 | `plugin_commands[].integration_types` | 必須是 `["guild_install"]`、`["user_install"]` 或 `["guild_install","user_install"]` 之一 | 拒絕 |
| V-08 | `plugin_commands[].contexts` | 必須是 `{"Guild","BotDM","PrivateChannel"}` 的非空子集 | 拒絕 |
| V-09 | `behaviors[].webhook_path` | 必須以 `/` 開頭，不能為空；**同 plugin 內 `webhook_path` 必須唯一**（H-9 / OQ-2 升級為阻擋）| 拒絕 |
| V-10 | `behaviors[].slashHints.contexts` | 若存在，必須是 `{"Guild","BotDM","PrivateChannel"}` 的子集 | 拒絕 |

### 4.2 三軸非法組合（`plugin_commands` 適用）

下表窮盡全部 9 種代表性三軸組合（scope × integrationTypes × 代表 contexts），用以推導通用規則：

| # | scope | integration_types | contexts（代表值） | 合法？ | 說明 |
|---|-------|-------------------|--------------------|--------|------|
| 1 | `guild` | `["guild_install"]` | `["Guild"]` | ✅ 合法 | 標準 guild 指令，最常見 |
| 2 | `guild` | `["guild_install"]` | `["BotDM"]` | ❌ **非法** | guild scope 不應出現於 BotDM；BotDM 無 guildId，指令無意義 |
| 3 | `guild` | `["guild_install"]` | `["PrivateChannel"]` | ❌ **非法** | 同上，PrivateChannel 無 guild binding |
| 4 | `guild` | `["user_install"]` | `["Guild"]` | ❌ **非法** | scope=guild 代表 per-guild 邏輯，user_install 裝置類型矛盾 |
| 5 | `guild` | `["user_install"]` | `["BotDM"]` | ❌ **非法** | scope=guild + user_install + BotDM 三重矛盾 |
| 6 | `guild` | `["guild_install","user_install"]` | `["Guild"]` | ❌ **非法** | scope=guild 不得包含 user_install（規則 V-C2）|
| 7 | `global` | `["guild_install"]` | `["Guild"]` | ✅ 合法 | 傳統全域 guild 指令 |
| 8 | `global` | `["guild_install"]` | `["BotDM"]` | ❌ **非法** | guild_install 無法觸達 BotDM；需要 user_install 才能在 DM 使用 |
| 9 | `global` | `["user_install"]` | `["BotDM","PrivateChannel"]` | ✅ 合法 | 個人安裝型 DM 指令，最典型的 user_install 用途 |
| ✚ | `global` | `["guild_install","user_install"]` | `["Guild","BotDM","PrivateChannel"]` | ✅ 合法 | 全通路指令（最廣泛，補充第 10 種以完整覆蓋）|

**規則摘要**（validateManifest 用兩條規則窮盡所有組合，不需逐一列舉）：

- **V-C1**：`scope: "guild"` 時，`contexts` 不能包含 `"BotDM"` 或 `"PrivateChannel"`（guild 指令無 DM context 意義）
- **V-C2**：`scope: "guild"` 時，`integration_types` 不能包含 `"user_install"`（guild scope 綁定 guild_install 裝置類型）
- **V-C3**：`scope: "global"` 且 `integration_types` 不含 `"user_install"` 時，`contexts` 不能包含 `"BotDM"` 或 `"PrivateChannel"`（純 guild_install 無法觸達 DM contexts）

任何 `plugin_commands[]` 條目違反 V-C1、V-C2 或 V-C3 者，validateManifest 立即拒絕整個 manifest。

### 4.3 名稱碰撞規則（`assertNoCollisions` 更新）

沿用現行 `assertNoCollisions` 邏輯，但調整 reserved set 來源：

| 變更 | v1 做法 | v2 做法 |
|------|---------|---------|
| Reserved 靜態集合來源 | 硬編碼 `["manual", "break", "login"]` | 改為從 bot system command registry 動態讀取（M0-C 整合點）|
| `manual` / `break` / `login` | 在 reserved set 中 | 若這些指令改走軌二 system behavior，從 plugin command reserved set 移除，改由 system behavior 名稱衝突規則管理 |
| 碰撞範圍 | 跨 plugin 的 `commands[]` 名稱 | 改為跨 plugin 的 `plugin_commands[]` 名稱；`behaviors[].key` 衝突由另一張表管理 |

**v2 的 assertNoCollisions 碰撞範圍擴大**：

seenNames set 橫跨以下三個來源（不分軌）：
1. `plugin_commands[].name`
2. `behaviors[].slashHints.suggested_name`（有 slashHints 且有 suggested_name 的才納入）
3. `guild_features[N].commands[].name`

**Reserved names 機制改寫**：v1 hardcode `["manual","break","login"]` 改為動態載入。

```typescript
// validateManifest(input, systemBehaviorKeys: string[]) — M1 實作
// PluginRegistry.register() 呼叫時注入 systemBehaviorKeys
// systemBehaviorKeys 來源：config.plugin.systemBehaviors 或 SystemBehaviorRegistry
```

具體實作是 M1 任務，此處僅確立機制。

**M0-C 對齊需求**：`assertNoCollisions` 的 reserved set 必須等 M0-C（system behavior 遷移）
確定哪些原生指令改走軌二後才能最終化。本草案標記此為開放問題（見第 7 節）。

---

## 5. 舊版相容性結論

### 5.1 破壞性升級聲明

**v1 manifest 一律拒絕。**

Bot 端 `validateManifest` 收到 `schema_version !== "2"` 時立即回傳：

```
{ ok: false, error: "unsupported schema_version (got \"1\", expected \"2\"). v1 manifests are no longer accepted. See migration guide." }
```

不提供自動升級路徑（不轉換 v1 → v2），plugin 作者必須手動改寫。

### 5.2 Plugin 作者 Migration Guide 框架

（內文於 M1 撰寫，此處僅列標題結構）

```
# Plugin SDK v1 → v2 Migration Guide

## 必讀：破壞性變更清單

## 步驟 1：升級 schema_version
## 步驟 2：commands[] → plugin_commands[]（補三軸）
## 步驟 3：dm_behaviors[] → behaviors[]（補 webhook_path）
## 步驟 4：更新 definePlugin() 呼叫（PluginConfigV2）
## 步驟 5：將 defineCommand() 改為 definePluginCommand()
## 步驟 6：buildManifest() 廢棄 — 移除呼叫
## 步驟 7：驗證 manifest（本機 dry-run）
## 附錄：v1 欄位完整對照表
```

---

## 6. 重要設計風險拍板（M0 內決定）

### 6.1 風險一：裸 webhook 相容契約 — HTTP method + payload schema 拍板

**拍板結論：採用 `RESTPostAPIWebhookWithTokenJSONBody`（discord-api-types v10）。**

**理由**：
1. Discord 原生 channel webhook 的 POST body 即為 `RESTPostAPIWebhookWithTokenJSONBody`。若 behavior URL 要支援「直接被貼進 Discord webhook 設定」，後端就必須接受完全相同的 payload schema。
2. GitHub、Grafana、Datadog 等主流工具的「Discord-compatible webhook」也遵從此 schema，採用此格式不限縮使用場景。
3. SDK 的 `WebhookPayload` 型別直接對齊此 schema，plugin 作者的 IDE 補完與 Discord 文件對得上。

Plugin 宣告的每一條 `behaviors[].webhook_path` **必須**支援：

| 項目 | 規格 |
|------|------|
| HTTP method | `POST` |
| Content-Type | `application/json` |
| Payload schema | `RESTPostAPIWebhookWithTokenJSONBody`（discord-api-types v10）— 拍板 |
| Response | `204 No Content`（已處理）或 `200 OK` + JSON body（若呼叫方需要 response） |
| Timeout budget | bot 端 5 秒（不變）；呼叫方 native Discord 無限制 |

`RESTPostAPIWebhookWithTokenJSONBody` 最小欄位集（供 plugin 實作參考）：

```typescript
{
  content?: string;
  username?: string;
  avatar_url?: string;
  embeds?: APIEmbed[];
  allowed_mentions?: APIAllowedMentions;
  components?: APIActionRowComponent[];
  tts?: boolean;
  flags?: MessageFlags;
}
```

### 6.2 風險二：HMAC 簽署策略拍板

**拍板結論：behaviors 不簽，plugin_commands 繼續簽。**

| 情境 | 是否 HMAC 簽署 | 機制 |
|------|---------------|------|
| **behaviors（軌二）webhook 呼叫**（bot → plugin） | **不簽** | 裸 HTTP POST；如需驗身，admin 在 admin/behaviors UI 設定 `webhookSecret`，bot 在 header 帶 `X-Plugin-Webhook-Token: <secret>` |
| **plugin_commands（軌三）dispatch**（bot → plugin） | **繼續簽**（`dispatchHmacKey`） | 現行 HMAC-SHA256 機制不變；M1 實作沿用 `createPluginServer` 的 HMAC 驗證路徑 |
| Admin 設定 `webhookSecret` 的情況 | Bot 帶 `X-Plugin-Webhook-Token` header | Plugin SDK 提供 `verifyWebhookToken(req, secret)` 輔助函式（M1 新增）|

**理由**：
1. Discord 原生 channel webhook 呼叫不帶 HMAC。若 behaviors 帶簽，Discord 直呼時驗簽必然失敗，plugin 需維護「signed/unsigned 雙路徑」，破壞「裸 webhook 相容」契約。
2. behaviors 的安全邊界是「URL 保密 + optional webhookSecret」，與 Discord 原生 webhook 安全模型一致。
3. plugin_commands 是 bot 私有 RPC 呼叫（不走 Discord），安全邊界是 HMAC 簽署，兩軌分治，不混用。

| | plugin_commands（軌三） | behaviors（軌二） |
|---|---|---|
| 簽署方式 | HMAC-SHA256（`dispatchHmacKey`） | 無（裸 HTTP）|
| 安全保障 | bot 生成的 `dispatchHmacKey`，每 plugin 獨立 | URL 保密 + optional `X-Plugin-Webhook-Token` |
| Admin 可設定 | 無 | webhookSecret（可選）|
| Discord 原生相容 | 否（需 bot 中介） | 是（可直接貼 URL）|

### 6.3 原生 Discord Channel Webhook 使用流程（Admin 操作）

當 `behaviors[].slashHints` 不存在時，admin 可以直接：

1. 複製 `{plugin.url}{webhook_path}` 作為 URL
2. 在 Discord Guild 的某 channel 設定「建立 webhook」→ 貼入 URL
3. Discord 會 POST `RESTPostAPIWebhookWithTokenJSONBody` 格式訊息給 plugin

Plugin 收到 Discord webhook payload 後可直接處理（例如：relay、log、trigger action），
不需要任何 SDK 包裝。**此契約由 plugin 作者自行實現，SDK 不強制驗證。**

---

## 7. 開放問題（M1+ 解決）

| 編號 | 問題 | 阻擋哪裡 |
|------|------|---------|
| OQ-1 | `assertNoCollisions` 的 reserved set 要等 M0-C 確定哪些系統指令改走軌二後才能最終化 | Validation 規則 4.3 |
| ~~OQ-2~~ | ~~`behaviors[].webhook_path` 是否需要唯一性驗證~~ | **已升級為阻擋（H-9）**：V-09 規則已寫死「同 plugin 內必須唯一」，M1-B 落地時實作 |
| OQ-3 | `slashHints.options` 結構是否允許 sub_command？若允許，admin UI 需對應複雜度升級 | SDK + admin UI |
| OQ-4 | Admin 設定 behavior 三軸後，bot 端儲存在哪張表（`behavior_configs`？`plugin_guild_features`？）— 需要 db-expert 設計 schema | M0-D |
| OQ-5 | `GuildFeatureDefinition.commands[]` 在 SDK 端帶 `handler` 還是不帶？（guild feature command dispatch 走 bot 端 guild-feature sync，不走 plugin command handler 路徑）目前建議：SDK 端 `commands[]` 不帶 handler，由 `onReady` hook 手動掛路由 | SDK plugin.ts 實作 |
| OQ-6 | `defineBehavior` 的 handler 是否需要分「slash trigger mode」和「native webhook mode」兩個 handler？或由 plugin 自行 inspect `ctx.body` 判斷？— 建議後者，保持 API 簡單 | SDK types.ts |

---

## 附錄 A：完整 v1 欄位廢棄清單

| v1 欄位 | 廢棄原因 |
|---------|---------|
| `schema_version: "1"` | 版本升級，破壞性替換 |
| `manifest.commands[]` | 改為 `plugin_commands[]`（三軸必填） |
| `manifest.dm_behaviors[]` | 改為 `behaviors[]`（補 webhook_path） |
| `manifest.endpoints.dm_behavior_dispatch` | 各 behavior 自帶 webhook_path，集中 dispatch 路由廢棄 |
| `manifest.endpoints.command` | 改名為 `manifest.endpoints.plugin_command` |
| SDK `defineCommand()` | 改為 `definePluginCommand()` |
| SDK `buildManifest()` | SDK 內部自動建構，plugin 不再手動呼叫 |
| SDK `ManifestConfig` 型別 | 改為 `PluginConfigV2` |
| SDK `Manifest` 型別 | 改為 `PluginManifestV2` |
| SDK `PluginConfig` 型別 | 改為 `PluginConfigV2`，舊型別廢棄標記保留一版 |

---

## 附錄 B：與 M0-A / M0-C / M0-D 的對齊需求

| 對齊點 | 依賴方向 | 說明 |
|--------|---------|------|
| M0-A（指令架構總覽表） | B 依賴 A | `plugin_commands[]` 的三軸欄位名稱和語意必須與 M0-A 的「軌三欄位規格」完全一致 |
| M0-C（system behavior 遷移） | B ← C 需確認 | `assertNoCollisions` reserved set 來源；`manual`/`break`/`login` 是否改走軌二 system behavior 決定後，B 的 Validation 4.3 才能最終化 |
| M0-D（admin UI behaviors 管理頁面） | D 依賴 B | `behaviors[].slashHints` 欄位決定 admin UI 需要渲染哪些可配置欄位；`webhookSecret` admin config 的 UX 設計需 D 端確認 |
| M1（plugin migration guide） | M1 依賴 B | 本文件 5.2 節的標題框架是 M1 的輸入 |
