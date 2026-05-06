# Plugin SDK v1 → v2 Migration Guide

> **版本**：SDK v2（schema_version `"2"`），對應 M1-B/M1-E 完成後的狀態。
> **適用對象**：使用 `@karyl-chan/plugin-sdk` 開發的所有 plugin 作者。
> **破壞性警告**：v2 manifest 與 v1 **不相容**。Bot 端 `validateManifest` 收到
> `schema_version !== "2"` 時立即拒絕，回傳錯誤，plugin 無法完成 register。

---

## 必讀：破壞性變更清單

| 項目 | v1 做法 | v2 做法 |
|------|---------|---------|
| Manifest 版本 | `schema_version: "1"` | `schema_version: "2"` |
| 指令陣列 key | `commands: [...]` | `pluginCommands: [...]` |
| 指令定義 function | `defineCommand(...)` | `definePluginCommand(...)` |
| 三軸（scope/integration_types/contexts） | 省略，bot 端推斷預設 | 必填，plugin 作者明確宣告 |
| DM behavior 陣列 | `dm_behaviors: [...]` | `behaviors: [...]` |
| DM behavior webhook 路徑 | 無（統一走 `endpoints.dm_behavior_dispatch`） | 每條 behavior 自帶 `webhook_path` |
| Plugin config 型別 | `PluginConfig` | `PluginConfigV2` |
| buildManifest 呼叫 | 需要手動呼叫 `buildManifest()` | 廢棄；SDK 在 `definePlugin().start()` 內部自動建構 |
| 指令 endpoint key | `endpoints.command` | `endpoints.plugin_command` |
| DM behavior dispatch endpoint | `endpoints.dm_behavior_dispatch` | 廢棄 |

---

## 步驟 1：升級 schema_version

`schema_version` 已由 `definePlugin` 內部的 `buildManifestV2` 自動設定為 `"2"`。
Plugin 作者**不需要**手動設定，只要完成以下各步驟，bot 收到的 manifest 就會是 v2 格式。

若 plugin 有自定義 manifest 邏輯呼叫過 `buildManifest`，請移除（見步驟 6）。

---

## 步驟 2：`commands[]` → `pluginCommands[]`（補三軸）

### 改動說明

將 `definePlugin` config 的 `commands` key 改為 `pluginCommands`，
並在每個指令定義加上三個必填欄位：`scope`、`integrationTypes`、`contexts`。

### Before（v1）

```typescript
import { defineCommand, definePlugin } from "@karyl-chan/plugin-sdk";

export default definePlugin({
  key: "my-plugin",
  // ...
  commands: [
    defineCommand({
      name: "uuid",
      description: "Generate a v4 UUID",
      contexts: ["Guild", "BotDM", "PrivateChannel"],
      handler: () => "...",
    }),
    defineCommand({
      name: "radio",
      description: "Internet radio in voice channels",
      contexts: ["Guild"],
      defaultMemberPermissions: "ManageGuild",
      handler: async (ctx) => { /* ... */ },
    }),
  ],
});
```

### After（v2）

```typescript
import { definePlugin, definePluginCommand } from "@karyl-chan/plugin-sdk";

export default definePlugin({
  key: "my-plugin",
  // ...
  pluginCommands: [
    // 全通路指令（Guild + DM）：scope=global + 雙 install type
    definePluginCommand({
      name: "uuid",
      description: "Generate a v4 UUID",
      scope: "global",
      integrationTypes: ["guild_install", "user_install"],
      contexts: ["Guild", "BotDM", "PrivateChannel"],
      handler: () => "...",
    }),
    // Guild-only 指令：scope=guild + guild_install only
    definePluginCommand({
      name: "radio",
      description: "Internet radio in voice channels",
      scope: "guild",
      integrationTypes: ["guild_install"],
      contexts: ["Guild"],
      defaultMemberPermissions: "ManageGuild",
      handler: async (ctx) => { /* ... */ },
    }),
  ],
});
```

### 三軸選擇指南

依指令用途選擇三軸組合（不合法組合見附錄 B）：

| 情境 | scope | integrationTypes | contexts |
|------|-------|-----------------|---------|
| 全通路（Guild + DM 皆可用） | `"global"` | `["guild_install", "user_install"]` | `["Guild", "BotDM", "PrivateChannel"]` |
| 傳統 Guild-only 指令 | `"guild"` | `["guild_install"]` | `["Guild"]` |
| 個人安裝型 DM 指令 | `"global"` | `["user_install"]` | `["BotDM", "PrivateChannel"]` |
| Guild 全域指令（無 DM） | `"global"` | `["guild_install"]` | `["Guild"]` |

**實際範例（來自 utility plugin 升級）：**

`/uuid`（原 v1 `contexts: ["Guild","BotDM","PrivateChannel"]`）→
```typescript
scope: "global",
integrationTypes: ["guild_install", "user_install"],
contexts: ["Guild", "BotDM", "PrivateChannel"],
```

**實際範例（來自 radio plugin 升級）：**

`/radio`（原 v1 `contexts: ["Guild"]`）→
```typescript
scope: "guild",
integrationTypes: ["guild_install"],
contexts: ["Guild"],
```

---

## 步驟 3：`dm_behaviors[]` → `behaviors[]`（補 webhook_path）

### 改動說明

將 `dm_behaviors` key 改為 `behaviors`，每條 behavior 必須加上 `webhook_path`（以 `/` 開頭的相對路徑）。

原本統一的 `endpoints.dm_behavior_dispatch` dispatch 路徑廢棄；
v2 改為每條 behavior 各自在 `webhook_path` 掛一個獨立 HTTP 路由，bot 直接打對應 URL。

### Before（v1）

```typescript
definePlugin({
  // ...
  dm_behaviors: [
    {
      key: "chat",
      name: "聊天模式",
      description: "與 AI 聊天",
      config_schema: [/* ... */],
    },
  ],
  endpoints: {
    command: "/commands/{command_name}",
    dm_behavior_dispatch: "/dm-behaviors/{behavior_key}",
  },
});
```

### After（v2）

```typescript
import { defineBehavior, definePlugin } from "@karyl-chan/plugin-sdk";

definePlugin({
  // ...
  behaviors: [
    defineBehavior({
      key: "chat",
      description: "與 AI 聊天",
      webhookPath: "/webhooks/chat",     // 對應 manifest behaviors[].webhook_path
      handler: async (ctx) => {
        // ctx.body = 外部 POST 的 raw body 或 bot 合成的 slash payload
        // ctx.behaviorKey === "chat"
        return { content: "Hello!" };
      },
    }),
  ],
  // endpoints.dm_behavior_dispatch 已移除，不需要填
});
```

### Plugin HTTP server 加掛 webhook 路由

`defineBehavior` 的 `webhookPath` 需對應 plugin Fastify server 上的實際路由。
SDK 的 `createPluginServer` 已自動為每條 behavior 在 `webhookPath` 掛 POST 路由，
**plugin 作者不需要手動 `server.post(webhookPath, ...)` — 只要 `defineBehavior` + `handler` 即可。**

### 若 behavior 也需要 slash 入口

如果 v1 的 `dm_behavior` 同時有對應的 `commands[]` slash command，
v2 的做法是在 `behaviors[]` 加 `slashHints`，**並從 `pluginCommands[]` 移除重複的 slash 定義**：

```typescript
defineBehavior({
  key: "chat",
  description: "與 AI 聊天",
  webhookPath: "/webhooks/chat",
  slashHints: {
    suggestedName: "chat",
    suggestedDescription: "開始 AI 對話",
  },
  handler: async (ctx) => { /* ... */ },
}),
```

---

## 步驟 4：更新 `definePlugin()` 呼叫（PluginConfigV2）

### 型別名稱改變

| v1 型別 | v2 型別 | 說明 |
|---------|---------|------|
| `PluginConfig` | `PluginConfigV2` | `definePlugin` 的傳入型別 |
| `CommandDefinition` | `PluginCommandDefinition` | `definePluginCommand` 的參數型別 |

`PluginConfig` 型別保留（廢棄標記 `@deprecated`），型別檢查不會立即出錯，
但 runtime 傳入 `PluginConfig`（含 `commands` key）時，SDK 仍走 v1 deprecated path，
bot 收到的 manifest 仍然是 v1（schema_version "1"），**注冊會被拒絕**。

必須確保傳入 `definePlugin` 的 config 物件使用 `pluginCommands` key（v2 格式），
才能觸發 SDK v2 路徑並生成 schema_version "2" 的 manifest。

### Before（v1）

```typescript
import { definePlugin } from "@karyl-chan/plugin-sdk";
import type { PluginConfig } from "@karyl-chan/plugin-sdk";

const config: PluginConfig = {
  key: "my-plugin",
  name: "My Plugin",
  version: "1.0.0",
  rpcMethodsUsed: ["interactions.respond"],
  storage: { guildKv: false },
  commands: [/* ... */],
};

export default definePlugin(config);
```

### After（v2）

```typescript
import { definePlugin } from "@karyl-chan/plugin-sdk";
import type { PluginConfigV2 } from "@karyl-chan/plugin-sdk";

const config: PluginConfigV2 = {
  key: "my-plugin",
  name: "My Plugin",
  version: "1.0.0",
  rpcMethodsUsed: ["interactions.respond"],
  storage: { guildKv: false },
  pluginCommands: [/* ... */],   // ← 改 key
  behaviors: [/* ... */],        // ← 若有 dm_behaviors，改這裡
};

export default definePlugin(config);
```

---

## 步驟 5：將 `defineCommand()` 改為 `definePluginCommand()`

所有 `defineCommand` 呼叫改為 `definePluginCommand`，並補上三軸（見步驟 2）。

### Import 修改

```typescript
// Before（v1）
import { defineCommand, definePlugin } from "@karyl-chan/plugin-sdk";

// After（v2）
import { definePlugin, definePluginCommand } from "@karyl-chan/plugin-sdk";
```

`defineCommand` 在 SDK v2 仍有 export（避免 import 立即爆炸），
但 **runtime 呼叫會拋出 `Error: defineCommand removed in SDK v2`**。
必須在 build 前全部替換。

---

## 步驟 6：`buildManifest()` 廢棄 — 移除呼叫

v2 不再需要 plugin 手動呼叫 `buildManifest()`。
`definePlugin().start()` 內部自動呼叫 `buildManifestV2(config, pluginUrl)` 生成 manifest 並向 bot 注冊。

### Before（v1，若有手動呼叫）

```typescript
import { buildManifest } from "@karyl-chan/plugin-sdk";

const manifest = buildManifest({
  key: "my-plugin",
  pluginUrl: process.env.PLUGIN_URL ?? "http://my-plugin:3000",
  commands: [/* ... */],
  // ...
});
```

### After（v2）

直接刪除 `buildManifest` 的 import 與呼叫。`definePlugin().start()` 自動處理。

若需要在 plugin 程式碼中取得 manifest 物件（例如日誌或測試），可用：

```typescript
import { buildManifestV2 } from "@karyl-chan/plugin-sdk/manifest-builder";
// 或直接 import plugin instance 的 config 組合
```

---

## 步驟 7：驗證 manifest（本機 dry-run）

### 方法一：pnpm build 型別檢查

```bash
pnpm build
# 若有缺漏三軸欄位，TypeScript 會立即報錯：
# error TS2345: Argument of type '{ name: string; description: string; ... }'
# is not assignable to parameter of type 'PluginCommandDefinition'.
# Property 'scope' is missing ...
```

### 方法二：觀察 plugin 啟動日誌

```bash
docker compose up karyl-utility-plugin
# 正確輸出（v2 register 成功）：
# {"level":"info","msg":"karyl-utility plugin listening","port":3000}
# {"level":"info","msg":"registered with bot","pluginId":"karyl-utility"}
#
# 失敗輸出（v1 manifest 被拒）：
# {"level":"error","msg":"register failed","status":400,
#  "body":{"error":"unsupported schema_version (got \"1\", expected \"2\")"}}
```

### 方法三：curl 取 manifest

```bash
# Plugin 啟動後，manifest 由 bot 在 register 時取得；plugin 本身不直接暴露 /manifest。
# 觀察 bot logs 確認 validateManifest 通過：
docker logs karyl-chan | grep -E "plugin.*register|validateManifest"
```

---

## 附錄 A：v1 欄位完整對照表

| v1 欄位 | v2 位置 | 動作 |
|---------|---------|------|
| `schema_version: "1"` | `schema_version: "2"` | SDK 自動設定，不需手動改 |
| `manifest.commands[]` | `manifest.plugin_commands[]` | 改 key；補三軸三欄 |
| `manifest.dm_behaviors[]` | `manifest.behaviors[]` | 改 key；補 `webhook_path` |
| `manifest.endpoints.command` | `manifest.endpoints.plugin_command` | SDK 自動設定 |
| `manifest.endpoints.dm_behavior_dispatch` | 廢棄 | 刪除 |
| `PluginConfig` 型別 | `PluginConfigV2` 型別 | import 更新 |
| `CommandDefinition` 型別 | `PluginCommandDefinition` 型別 | import 更新 |
| `ManifestConfig` 型別 | 廢棄，不再需要 | 刪除 |
| `Manifest` 型別 | `PluginManifestV2` 型別 | 若有用到需更新 |
| SDK `defineCommand()` | `definePluginCommand()` | function 改名 + 補三軸 |
| SDK `buildManifest()` | 廢棄 | 刪除呼叫 |
| `commands[].contexts` | `plugin_commands[].contexts` + `scope` + `integration_types` | 拆成三個必填欄位 |

---

## 附錄 B：三軸合法組合速查表

| # | scope | integration_types | contexts（代表值） | 合法？ |
|---|-------|-------------------|--------------------|--------|
| 1 | `guild` | `["guild_install"]` | `["Guild"]` | ✅ 標準 guild 指令 |
| 2 | `guild` | `["guild_install"]` | `["BotDM"]` | ❌ guild scope 不支援 BotDM |
| 3 | `guild` | `["guild_install"]` | `["PrivateChannel"]` | ❌ guild scope 不支援 PrivateChannel |
| 4 | `guild` | `["user_install"]` | 任意 | ❌ guild scope 不可含 user_install |
| 5 | `guild` | `["guild_install","user_install"]` | 任意 | ❌ guild scope 不可含 user_install |
| 6 | `global` | `["guild_install"]` | `["Guild"]` | ✅ 傳統全域 guild 指令 |
| 7 | `global` | `["guild_install"]` | `["BotDM"]` | ❌ guild_install 無法觸達 BotDM |
| 8 | `global` | `["user_install"]` | `["BotDM","PrivateChannel"]` | ✅ 個人安裝型 DM 指令 |
| 9 | `global` | `["guild_install","user_install"]` | `["Guild","BotDM","PrivateChannel"]` | ✅ 全通路指令 |

**非法組合規則摘要（validateManifest 強制執行）：**

- **V-C1**：`scope: "guild"` 時，`contexts` 不能包含 `"BotDM"` 或 `"PrivateChannel"`
- **V-C2**：`scope: "guild"` 時，`integration_types` 不能包含 `"user_install"`
- **V-C3**：`scope: "global"` 且 `integration_types` 不含 `"user_install"` 時，`contexts` 不能包含 `"BotDM"` 或 `"PrivateChannel"`

---

## 附錄 C：utility 與 radio plugin 升級摘要（M1-E 參考實例）

### karyl-utility plugin（v1 → v2）

- 15 個 `defineCommand` → 15 個 `definePluginCommand`
- `commands:` → `pluginCommands:`
- 三軸：`scope: "global"`, `integrationTypes: ["guild_install","user_install"]`, `contexts: ["Guild","BotDM","PrivateChannel"]`
- 無 dm_behaviors，無 behaviors 需升級

### karyl-radio plugin（v1 → v2）

- 1 個 `defineCommand`（`/radio`）→ 1 個 `definePluginCommand`
- `commands:` → `pluginCommands:`
- 三軸：`scope: "guild"`, `integrationTypes: ["guild_install"]`, `contexts: ["Guild"]`（voice 指令，Guild-only 合理）
- `defaultMemberPermissions: "ManageGuild"` 保持不變（v2 相容欄位）
- 無 dm_behaviors，無 behaviors 需升級
