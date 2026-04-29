# Plugin 開發指南

> **版本對應**:karyl-chan plugin protocol `schema_version: "1"`
> **狀態**:Phase 2 完整實作中。本指南隨架構演進同步更新,改架構時請順手改文件。

karyl-chan 的 plugin 是「同 docker network 的 sibling 服務」,不是 in-process 模組。Plugin 啟動時主動向 bot 註冊 manifest、bot 將 Discord 事件 / DM behavior / slash command 派送給它,plugin 透過 RPC 反向操作 bot。

## 目錄

1. [核心概念](#核心概念)
2. [Quick Start:寫一個 echo plugin](#quick-start)
3. [Manifest 規格](#manifest-規格)
4. [認證與生命週期](#認證與生命週期)
5. [Bot → Plugin 事件派送](#bot--plugin-事件派送)
6. [Bot → Plugin DM behavior 派送](#bot--plugin-dm-behavior-派送)
7. [Bot → Plugin Slash command 派送](#bot--plugin-slash-command-派送)
8. [Plugin → Bot RPC](#plugin--bot-rpc)
9. [Per-guild 設定 (config_schema)](#per-guild-設定)
10. [HMAC 簽章規格](#hmac-簽章規格)
11. [部署:docker-compose 整合](#部署)
12. [Admin UI 整合點](#admin-ui-整合點)
13. [限制與已知缺口](#限制與已知缺口)
14. [參考實作](#參考實作)

---

## 核心概念

| 概念 | 說明 |
|---|---|
| **Plugin** | 一個獨立 docker container,啟動後 POST `/api/plugins/register` 給 bot,並維持 30s heartbeat |
| **Manifest** | Plugin 用一份 JSON 描述自己:能力 (rpc_methods_used)、提供的 dm_behaviors / guild_features / commands、訂閱的 events、HTTP endpoints 路徑 |
| **Plugin token** | Bot 在 register 成功後給 plugin 一把 bearer token,plugin 用它呼叫 `/api/plugin/*` RPC。token 在 plugin 重新 register 或 admin disable 時失效 |
| **`KARYL_PLUGIN_SECRET`** | Bot 與所有 plugin 共享的對稱秘密。同時用於:(1) plugin 第一次 register 時的 setup secret (header `X-Plugin-Setup-Secret`)、(2) `/dm/*/dispatch`、`/events`、`/commands/*` 三條 bot→plugin 路徑的 HMAC 簽章 |
| **Status vs Enabled** | `status` 是 runtime liveness (heartbeat 驅動,>75s 沒收到變 inactive)。`enabled` 是 admin 在 admin UI 切的開關。**兩者都需 true 才會收到事件 / dispatch** |

### 兩條 bot↔plugin 軸線

```
                        ┌──────────────────────────┐
   register / heartbeat │                          │
   ─────────────────────▶│           bot           │
                        │   (karyl-chan, :3000)    │
   /events              │                          │
   /commands/<name>     │                          │
   /dm/<key>/dispatch   │                          │
   ◀─────────────────────│           ─ ─ ─          │
   (HMAC v0)             │           ↕              │
                        │                          │
   /api/plugin/*  ──────▶│                          │
   (Bearer plugin_token) │                          │
                        └──────────────────────────┘
```

* **Bot → Plugin**:HMAC 用 `KARYL_PLUGIN_SECRET`(plugin 先驗章再處理)
* **Plugin → Bot**:Bearer plugin token(bot 從 in-memory token store 驗證)

兩條軸線**獨立**,不要把 plugin token 用來簽 bot→plugin 的請求,也不要在 RPC 中送 HMAC headers。

---

## Quick Start

最小 plugin:接 DM 並回「收到」+ 原文。完整參考實作在 `/home/miles/workspace/echo-webhook/`。

### 1. 環境變數

```bash
# .env
KARYL_PLUGIN_SECRET=<跟 bot 同一把 32-byte hex,openssl rand -hex 32>
KARYL_BOT_URL=http://karyl-chan:3000   # docker network 內 sibling 解析
PLUGIN_URL=http://my-plugin:3000        # bot 用來連我們回來的位址
PORT=3000
```

### 2. Manifest

```typescript
// src/manifest.ts
export const manifest = {
  schema_version: "1",
  plugin: {
    id: "my-plugin",            // dns-safe slug, [a-z0-9][a-z0-9-]*
    name: "My Plugin",
    version: "0.1.0",
    description: "...",
    url: process.env.PLUGIN_URL ?? "http://my-plugin:3000",
  },
  rpc_methods_used: [],          // 此 plugin 不主動 RPC,僅被動回應
  storage: { guild_kv: false },  // 不申請 bot KV
  dm_behaviors: [{
    key: "echo",
    name: "Echo",
    supports_continuous: false,
    config_schema: [],
  }],
  endpoints: { dm_behavior_dispatch: "/dm/{behavior_key}/dispatch" },
};
```

### 3. 註冊 + heartbeat

啟動後 POST manifest 到 bot,拿到 token,每 30s 心跳。失敗就 exponential backoff retry。

```typescript
async function register() {
  const res = await fetch(`${BOT_URL}/api/plugins/register`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Plugin-Setup-Secret": SETUP_SECRET,
    },
    body: JSON.stringify({ manifest }),
  });
  if (!res.ok) throw new Error(`register: HTTP ${res.status}`);
  const data = await res.json(); // { plugin: {...}, token, heartbeat: { interval_seconds } }
  return data;
}

async function heartbeat(token: string) {
  await fetch(`${BOT_URL}/api/plugins/heartbeat`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
}
```

完整版(含 401 自動 re-register、backoff、unref'd timer)見 `echo-webhook/src/plugin-client.ts`。

### 4. 接 dispatch

```typescript
// POST /dm/echo/dispatch
// Bot 簽章在 X-Karyl-Signature / X-Karyl-Timestamp,我們驗章後處理
server.post("/dm/echo/dispatch", async (req, reply) => {
  if (!verifyHmac(req, SHARED_SECRET)) {
    return reply.code(401).send({ error: "bad signature" });
  }
  const payload = JSON.parse(req.body); // Discord webhook shape
  const replyBody = JSON.stringify({
    id: randomUUID(),
    channel_id: "echo",
    content: `收到\n${payload.content ?? ""}`,
    author: { id: "echo-bot", username: "echo", bot: true },
  });
  // 給 response 也簽,bot 端會驗,沒簽會被拒
  signResponse(reply, replyBody, SHARED_SECRET);
  return reply.send(replyBody);
});
```

### 5. 接到 docker network

```yaml
# docker-compose.yml
services:
  my-plugin:
    image: my-plugin:local
    build: .
    container_name: my-plugin
    environment:
      - KARYL_PLUGIN_SECRET=${KARYL_PLUGIN_SECRET:-}
      - KARYL_BOT_URL=http://karyl-chan:3000
      - PLUGIN_URL=http://my-plugin:3000
      - PORT=3000
    networks:
      - karyl-chan-net

networks:
  karyl-chan-net:
    external: true   # bot 已建好,我們不要重建
```

### 6. 在 admin UI 設一條 plugin behavior

啟動 plugin → 確認 admin `/admin/plugins` 看得到自己 → 進 `/admin/behaviors` → 「新增行為」→ 卡片內把「行為類型」切成 Plugin → 選 plugin + dm_behavior key → Save。

DM bot 隨意打字 → 看到 `收到\n<原文>` 回覆 = 端對端通。

---

## Manifest 規格

完整 schema:`src/modules/plugin-system/plugin-registry.service.ts:PluginManifest`。Bot 在 register 時驗證,malformed 直接 400。

```jsonc
{
  "schema_version": "1",          // 固定值,bot 不接受其他版本

  "plugin": {
    "id": "<slug>",               // 必填。^[a-z0-9][a-z0-9-]*$
    "name": "<display name>",     // 必填
    "version": "<semver-ish>",    // 必填
    "description": "...",         // 選填
    "author": "...",              // 選填
    "homepage": "https://...",    // 選填
    "url": "http://<host>:<port>", // 必填。bot 用此位址 POST 你的 endpoints。http(s) only
    "healthcheck_path": "/health"  // 選填,預設 "/health"
  },

  "rpc_methods_used": [           // plugin 會用到的 RPC,baked into token scope
    "messages.send",
    "storage.kv_get", "storage.kv_set"
    // … 全清單見「Plugin → Bot RPC」章節
  ],

  "storage": {
    "guild_kv": true,             // 申請使用 bot 的 plugin_kv 表
    "guild_kv_quota_kb": 64,      // per-plugin per-guild 的硬上限,bot 會 enforce
    "requires_secrets": false     // true 表示 plugin 自管加密 storage(rcon password 等)
  },

  "guild_features": [             // 0..N
    {
      "key": "main",              // unique within plugin
      "name": "...",
      "icon": "material-symbols:image",   // Iconify name
      "description": "...",
      "enabled_by_default": false,
      "events_subscribed": [      // 該 feature 訂閱的 Discord events,見「事件派送」
        "guild.message_create"
      ],
      "config_schema": [          // admin 在 guild 頁填的設定,見「Per-guild 設定」
        { "key": "warn_template", "type": "text", "label": "...", "default": "..." }
      ],
      "surfaces": [               // 在 admin UI 顯示位置
        "overview_card", "bot_functions_tab"
      ],
      "overview_metrics": [       // plugin 推送的 counters(Phase 3)
        { "key": "blocked_today", "label": "今日攔截", "type": "counter" }
      ],
      "commands": [               // 0..N — 此 feature 的 guild-scoped 指令
        {                         //   per-guild 註冊;feature 在某 guild
          "name": "warn",         //   被 toggle 關掉時,Discord 端會把
          "description": "...",   //   command 從該 guild 刪除,user 看不到
          "options": [...]
        }
      ]
    }
  ],

  "dm_behaviors": [               // 0..N。User 在 BehaviorsPage 可選為 type=plugin 行為的目標
    {
      "key": "forward",
      "name": "Webhook Forward",
      "description": "...",
      "supports_continuous": true,        // 回 [BEHAVIOR:END] 可結束 continuous session
      "config_schema": [...]              // 暫未在 admin 暴露,Phase 3 會接上
    }
  ],

  "commands": [                   // 0..N。**頂層 commands = 真正的全域指令**
    {                             // 永遠以 application-global 註冊,
      "name": "ping",             // 跨 DM + 所有 guild 都看得到。
      "description": "...",       // 不被任何 per-guild feature toggle 影響;
      "default_ephemeral": true,  // 只跟 plugin 整體 enabled flag 連動。
      "contexts": ["Guild", "BotDM", "PrivateChannel"],
      "integration_types": ["guild_install", "user_install"],
      "default_member_permissions": "MANAGE_GUILD",
      "options": [...]            // Discord option 樹,見下節
    }
  ],
  // 🔑 對比:
  //   manifest.commands[]                       → 全域指令(/account /relay)
  //   manifest.guild_features[].commands[]     → guild feature 指令
  //                                              per-guild 註冊,toggle 直接控制可見性
  // 同一份 manifest 內所有指令名稱必須唯一(不分階層)。

  "events_subscribed_global": [], // 不綁特定 feature 的 plugin-level event 訂閱(rare)

  "endpoints": {                  // bot 用的 url path 模板,{placeholder} 會被替換
    "events": "/events",                                    // 預設
    "command": "/commands/{command_name}",                  // 預設
    "guild_feature_action": "/feature/{feature_key}/action", // 暫未派送
    "dm_behavior_dispatch": "/dm/{behavior_key}/dispatch"   // 預設
  }
}
```

### Slash command options 樹

`commands[].options[]` 完全沿用 Discord 的 ApplicationCommandOption 結構,manifest 用以下 type 字串(對應 discord.js enum):

| type | Discord enum |
|---|---|
| `sub_command` | Subcommand |
| `sub_command_group` | SubcommandGroup |
| `string` | String |
| `integer` | Integer |
| `boolean` | Boolean |
| `user` | User |
| `channel` | Channel |
| `role` | Role |
| `mentionable` | Mentionable |
| `number` | Number |
| `attachment` | Attachment |

`channel_types` 接 `["GUILD_TEXT", "DM", "GUILD_VOICE", "GROUP_DM", "GUILD_CATEGORY", "GUILD_ANNOUNCEMENT", "ANNOUNCEMENT_THREAD", "PUBLIC_THREAD", "PRIVATE_THREAD", "GUILD_STAGE_VOICE", "GUILD_FORUM"]` 字串(會被 map 成 ChannelType enum)。

範例(`/picture-only-channel set #target`):

```jsonc
{
  "name": "picture-only-channel",
  "description": "管理圖片限制頻道",
  "default_member_permissions": "MANAGE_CHANNELS",
  "options": [
    {
      "type": "sub_command",
      "name": "set",
      "description": "把頻道設為圖片限制",
      "options": [
        {
          "type": "channel",
          "name": "channel",
          "description": "目標頻道",
          "required": true,
          "channel_types": ["GUILD_TEXT"]
        }
      ]
    },
    { "type": "sub_command", "name": "unset", "description": "解除", "options": [...] }
  ]
}
```

### `config_schema` 欄位類型

```jsonc
{
  "key": "channel_id",        // 唯一 key,plugin 在 RPC 拿到的 config object 用此 key
  "type": "channel",          // 見下表
  "label": "監控頻道",
  "description": "...",       // 選填
  "required": false,          // 選填
  "default": null,            // 選填
  "options": [                // 僅 type=select 用
    { "value": "low", "label": "低" }
  ]
}
```

| type | 說明 / UI |
|---|---|
| `text` | 單行文字 |
| `textarea` | 多行 |
| `number` | 數字 |
| `boolean` | toggle |
| `select` | dropdown,需提供 `options` |
| `channel` | guild channel 選擇器 |
| `role` | role 選擇器 |
| `user` | user snowflake 輸入 |
| `url` | URL with format validation |
| `secret` | password input,**bot 用 `encryptSecret()` 加密儲存**,plugin 收到 dispatch 時是 decrypted plaintext |
| `regex` | text + regex syntax check |

---

## 認證與生命週期

### 註冊流程

```
plugin                                    bot
  │                                        │
  ├─ POST /api/plugins/register ──────────▶│
  │   header: X-Plugin-Setup-Secret        │
  │   body: { manifest }                   │
  │                                        ├─ constant-time compare setup secret
  │                                        ├─ validate manifest schema
  │                                        ├─ check command name collisions
  │                                        ├─ upsert plugins row
  │                                        ├─ mint plugin token (rotate)
  │                                        ├─ rebuild event subscription index
  │                                        ├─ sync slash commands to Discord
  │◀────────── 200 ────────────────────────┤
  │   { plugin: {id,pluginKey,name,version,enabled},
  │     token: "<cleartext, only-once>",
  │     heartbeat: { path, interval_seconds: 30 } }
  │                                        │
  ├─ store token in memory                 │
  │                                        │
  ├─ POST /api/plugins/heartbeat ─────────▶│  every 30s
  │   header: Authorization: Bearer <token>│
  │◀────────── 200 ────────────────────────┤
```

### Token 生命週期

* Token 是 32-byte 隨機 hex,**僅在 register 回應中以 cleartext 出現一次**;bot 端只存 SHA-256 hash
* 每次 plugin re-register(plugin 重啟 / manifest 改),會 mint 新 token,舊 token 立刻失效(token cache 以 pluginId 去重)
* Heartbeat TTL:1 小時 rolling。若 plugin 30s 心跳一次,實際永不過期
* 若 bot 重啟,in-memory token cache 會清空。Plugin 下一個 RPC 會 401,plugin 應該偵測並重新 register

### 心跳超時

* Plugin 必須在 75s 內 heartbeat(預設你 30s 一次,單次 dropped beat 沒事)
* Bot reaper 每 30s 跑一次,超時的 plugin status → `inactive`,token 失效
* `inactive` plugin 不收 events / dispatch / interactions,但 `enabled` 維持原值,plugin 重新 register 即恢復

### Re-register 行為

* 同 `pluginKey` 的 plugin 重新 register = 更新 manifest snapshot + 換 token
* `enabled` flag **不會被 reset**(admin 設的 disable 不會因 plugin 重啟而 re-enabled)
* 既有的 `plugin_guild_features.configJson` 保留
* `plugin_kv` 保留

---

## Bot → Plugin 事件派送

Bot 收到 Discord 事件後,從 manifest 的 `events_subscribed_global` + 各 guild_feature 的 `events_subscribed` 收集每個 plugin 想要的 type,fan-out POST 給訂閱的 plugin。**Fire-and-forget**:plugin 回任何 status code 都不影響 bot 流程,plugin 想做事透過 RPC 反向呼叫。

### Endpoint

預設 `POST {plugin.url}/events`(可在 `endpoints.events` 改)。

### Headers

```
Content-Type: application/json
X-Karyl-Timestamp: <unix epoch seconds>
X-Karyl-Signature: v0=<hex sha256>
```

簽章規格:見[HMAC 章節](#hmac-簽章規格)。

### Body shape

```jsonc
{
  "type": "guild.message_create",   // event type 字串
  "data": { /* 因 type 而異,見下 */ }
}
```

### 目前已實作 event types

| type | data shape | 觸發來源 |
|---|---|---|
| `dm.message_create` | `{id, channel_id, guild_id:null, content, author, attachments, timestamp}` | bot.on('messageCreate') 過濾 DM |
| `guild.message_create` | 同上但 `guild_id` 有值 | bot.on('messageCreate') 過濾 guild |
| `guild.message_reaction_add` | `{message_id, channel_id, guild_id, user_id, emoji:{id,name,animated}}` | bot.on('messageReactionAdd') |
| `guild.message_reaction_remove` | 同上 | bot.on('messageReactionRemove') |

> Bot 自己的 messages / reactions 不會 dispatch(避免 plugin 透過 RPC 發訊息後又收到自己的回音)。

### 訂閱範例

```jsonc
{
  "guild_features": [{
    "key": "auto-mod",
    "name": "...",
    "events_subscribed": ["guild.message_create"]
  }]
}
```

訂閱會在 `register` / `setEnabled` 後立即生效(bot 重建 in-memory subscription index)。

### Timeout 與失敗處理

* Bot 5s timeout per dispatch,超時 abort
* Plugin offline / 5xx 都僅 log,不重試
* Plugin 收事件後想做事,**不要透過 response body 表達**,呼叫 RPC

---

## Bot → Plugin DM behavior 派送

DM behavior 跟 event 派送是不同概念:event 是「raw Discord 事件 fan-out」,dm_behavior 是「user 在 BehaviorsPage 設定一條規則,符合 trigger 條件時派送到指定的 plugin dm_behavior」。

### 觸發路徑

1. User 透過 DM 跟 bot 對話
2. bot `messageCreate` event 觸發 webhook-behavior.events
3. 找出 user 對應的 active behaviors(user target / group target / all_dms),按優先順序評估
4. trigger 命中後,看 behavior.type:
   * `webhook` → bot 直接 POST behavior.webhookUrl(舊路徑)
   * `plugin` → bot 找 behavior.pluginId 的 plugin row → POST plugin DM endpoint

### Endpoint

預設 `POST {plugin.url}/dm/{behavior_key}/dispatch`(可在 `endpoints.dm_behavior_dispatch` 改)。`{behavior_key}` 會被替換成 manifest 的 `dm_behaviors[].key`。

### Headers

同 events,HMAC 簽章。

### Body shape

完整的 Discord webhook payload(`RESTPostAPIWebhookWithTokenJSONBody`):

```jsonc
{
  "content": "<user 的 DM 文字,attachments 會 \\n 接 URL>",
  "username": "<user 顯示名>",
  "avatar_url": "https://cdn.discordapp.com/...",
  "embeds": [...],                  // 若 DM 有 embed
  "allowed_mentions": { "parse": [] }
}
```

### Response 規格

**Plugin 必須回:**

```jsonc
{
  "id": "<任意 string,通常 uuid>",
  "channel_id": "<任意 string,通常 'echo' 或 plugin 自己的標記>",
  "content": "<回給 user 的訊息文字>",
  "author": { "id": "...", "username": "...", "bot": true },
  "timestamp": "<ISO 8601>"
}
```

* Bot 把 `content` 拿出來 relay 到 user 的 DM
* **Response 必須帶 HMAC headers**(`X-Karyl-Timestamp`, `X-Karyl-Signature`),簽 response body bytes。Bot 會強制驗章,沒簽 / 簽錯 → bot 標記 dispatch 失敗,**不 relay**(否則 attacker 可在 network 上偽造 response 注入 user DM)

### `[BEHAVIOR:END]` sentinel

對 `forwardType: "continuous"` 的 behavior:

* 第一次 trigger 命中,bot 開 session 持續轉發後續 DM 到此 plugin
* Plugin 想結束 session 時,在 response 的 `content` 內含 `[BEHAVIOR:END]` 字串(case-insensitive)
* Bot 會剝除 token 後 relay 剩下文字 + 自動 endSession

範例:

```typescript
// Plugin 想結束:
content: "OK 我先掰拜 [BEHAVIOR:END]"
// Bot 會 relay "OK 我先掰拜" 並結束 session
```

### Continuous session 注意

* `supports_continuous: false` 的 dm_behavior 不會被開啟 continuous session,即使 behavior 設成 continuous mode
* Session 持久化在 DB(`behavior_sessions` 表),bot 重啟後 user 下一次 DM 就恢復

---

## Bot → Plugin Slash command 派送

當 user 在 Discord 打 plugin 註冊的 slash command,bot 收 interaction 後:

1. **立即 defer**:`interaction.deferReply({ ephemeral: true })`(Discord 3 秒 ack timer)
2. **POST 到 plugin** `/commands/<command_name>` 帶 interaction details
3. **不等 plugin response body 處理**:plugin 回應方式是用 RPC `interactions.respond` / `interactions.followup`,有 15 分鐘 window

### Endpoint

預設 `POST {plugin.url}/commands/{command_name}`(可在 `endpoints.command` 改)。

### Body shape

```jsonc
{
  "interaction_id": "...",
  "interaction_token": "...",       // !!! Plugin 必須在 RPC 中回傳此 token
  "application_id": "...",
  "command_name": "ping",
  "sub_command_name": null,         // 若有 subcommand
  "sub_command_group": null,
  "options": [                      // discord.js _hoistedOptions 結構
    { "name": "channel", "type": 7, "value": "123456..." }
  ],
  "guild_id": "...",
  "channel_id": "...",
  "user": { "id": "...", "username": "...", "global_name": "..." },
  "member": { "permissions": "<bigint as string>" } | null,  // null = DM
  "locale": "zh-TW" | null
}
```

### Plugin 處理範例

```typescript
server.post("/commands/ping", async (req, reply) => {
  if (!verifyHmac(req, SHARED_SECRET)) return reply.code(401).send();
  const payload = req.body;

  // ... do work ...

  // 透過 RPC 完成 deferred reply
  await fetch(`${BOT_URL}/api/plugin/interactions.respond`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${PLUGIN_TOKEN}`,
    },
    body: JSON.stringify({
      interaction_token: payload.interaction_token,
      content: "pong",
      ephemeral: true,
    }),
  });

  // 對 bot 回 200 即可,response body 不重要
  return reply.send({ ok: true });
});
```

### Autocomplete

Discord autocomplete 沒有 defer,**必須在 3 秒內同步回**。Bot 對 plugin 的 autocomplete 派送有 1.5 秒 budget,timeout 就 fail-open(回空 choices)。

Endpoint:`POST {plugin.url}/commands/{command_name}/autocomplete`

Body:

```jsonc
{
  "interaction_id": "...",
  "command_name": "...",
  "focused": { "name": "<被聚焦欄位名>", "value": "<目前打字內容>", "type": 3 },
  "guild_id": "...",
  "user": { "id": "..." }
}
```

Plugin 必須在 1.5s 內**同步**回(不走 RPC):

```jsonc
{
  "choices": [
    { "name": "顯示文字", "value": "送回給 bot 的值" }
  ]
}
```

### 命名衝突

兩個 plugin 不能 declare 同名 command。Register 時 bot 跑 `findCommandCollisions`,撞名第二個 plugin 的 register **直接 400 拒絕**,error message 含先到的 owner pluginId。

> **Phase 1.5 限制**:plugin command 跟 in-process discordx command(`/picture-only-channel` 等)的撞名沒檢查,operator 自己負責不要撞。

---

## Plugin → Bot RPC

所有 RPC endpoint 在 `/api/plugin/*`(注意 singular,跟 admin 端的 `/api/plugins/*` 區分),用 plugin token 認證:

```
Authorization: Bearer <plugin token>
Content-Type: application/json
```

每次 RPC bot 會:
1. 驗 token in-memory 有效
2. 查 plugin row 仍 `enabled` + `status='active'`(token cache 可能 outlive disable,每次都重檢)
3. 驗 manifest 的 `rpc_methods_used` 含此 method,沒 declare 的 method 一律 403

### Method 清單(Phase 1.5 / 2.A)

#### Messages

##### `messages.send`

```http
POST /api/plugin/messages.send
{
  "channel_id": "...",
  "content": "...",                  // 至少要有 content 或 embeds 之一
  "embeds": [...],
  "allowed_mentions": { "parse": [] } // 預設 parse=[],防 @everyone 意外炸場
}
→ { "id": "...", "channel_id": "..." }
```

##### `messages.edit`

```http
POST /api/plugin/messages.edit
{ "channel_id", "message_id", "content"?, "embeds"? }
```

> ⚠️ Phase 1.5 only the route stub exists; full handler 預計在 Phase 2 補。檢查 server 端 `plugin-rpc-routes.ts` 看當下狀態。

##### `messages.delete`

```http
POST /api/plugin/messages.delete
{ "channel_id", "message_id" }
→ { "ok": true }
```

##### `messages.add_reaction`

```http
POST /api/plugin/messages.add_reaction
{ "channel_id", "message_id", "emoji" }   // emoji 可以是 Unicode 或 "<name:id>"
→ { "ok": true }
```

#### Interactions

##### `interactions.respond`

完成一個 deferred slash command 回覆:

```http
POST /api/plugin/interactions.respond
{
  "interaction_token": "...",        // 從 dispatch payload 帶來
  "content": "...",
  "embeds": [...],
  "ephemeral": true
}
→ { "ok": true }
```

`ephemeral` 旗標只是訊號,實際 ephemerality 在 bot defer 那刻就鎖定。Bot 預設 `ephemeral: true` defer。

##### `interactions.followup`

額外 follow-up 訊息(Discord 限 5 個 follow-up per interaction):

```http
POST /api/plugin/interactions.followup
{ "interaction_token", "content"?, "embeds"?, "ephemeral"? }
→ { "ok": true, "id": "<discord message id>" }
```

#### Storage

##### `storage.kv_get`

```http
POST /api/plugin/storage.kv_get
{ "guild_id": "...", "key": "..." }
→ { "found": true, "value": "<string>", "bytes": 42 }
   or { "found": false, "value": null }
```

##### `storage.kv_set`

```http
POST /api/plugin/storage.kv_set
{ "guild_id", "key", "value" }   // value 是 string,plugin 自己決定是否 JSON serialize
→ { "ok": true, "bytes": 42, "total_bytes": 1024, "quota_bytes": 65536 }
```

* `key` max 200 chars
* `value` 單筆 hard cap 64 KB
* Per-plugin per-guild 配額從 `manifest.storage.guild_kv_quota_kb` 推導(預設 64 KB)
* 超 quota → 413

##### `storage.kv_delete`

```http
POST /api/plugin/storage.kv_delete
{ "guild_id", "key" } → { "removed": true }
```

##### `storage.kv_list`

```http
POST /api/plugin/storage.kv_list
{ "guild_id", "prefix"?, "limit"? = 100, "offset"? = 0 }
→ { "keys": [...], "total": 42 }
```

* Prefix 用 SQL LIKE escape(`%` / `_` 不會被當 wildcard)
* Max limit 500

#### 自我資訊

##### `GET /api/plugin/me`

```http
→ { "id": 1, "pluginKey": "...", "version": "...", "enabled": true,
    "status": "active", "scopes": ["messages.send", ...] }
```

用於 plugin 想 verify 自己的 effective scope(避免 declare 但 not granted 的混淆)。

### Manifest scope declaration

Plugin token 簽發時 scope set 從 manifest `rpc_methods_used` 來。沒 declare 的 method,bot 端 onRequest 階段就 403。

正確聲明範例:

```jsonc
"rpc_methods_used": [
  "messages.send",
  "messages.add_reaction",
  "storage.kv_get",
  "storage.kv_set",
  "interactions.respond"
]
```

---

## Per-guild 設定

Bot 端 `plugin_guild_features` 表存每個 plugin × guild × featureKey 的:
* `enabled` flag(admin 切的)
* `configJson`(admin 填的 config_schema 值,`secret`-typed 欄位用 `encryptSecret()` 加密)
* `metricsJson`(plugin push 來的 counters,Phase 3)

### Admin 改 config 時

* `PUT /api/plugins/:id/guilds/:guildId/features/:featureKey { enabled?, config? }`
* Bot 用 `encryptSecret()` 加密 `secret`-typed fields(同 webhook secret)
* Plugin 收 dispatch 時 config 是 **decrypted plaintext**(bot 在 dispatch 前解密)

### Plugin 怎麼拿 config

> ⚠️ Phase 1.5 還沒整合 — event dispatch payload 仍**未帶** feature_config。預計 Phase 2 加 `data.feature_configs` 欄位。
>
> Workaround:plugin 在收事件後用 `storage.kv_get` 自己讀(plugin 自己跟 admin UI 的 PUT endpoint 之間有人工同步成本),或等 Phase 2 補。

未來預期 payload:

```jsonc
{
  "type": "guild.message_create",
  "data": {
    "id": "...",
    /* … message fields … */
    "feature_configs": {
      "<featureKey>": { /* decrypted config object */ }
    }
  }
}
```

---

## HMAC 簽章規格

雙向相同規格(只差 secret)。

### 簽章字串

```
v0:<unix_seconds>:<request_or_response_body_bytes_verbatim>
```

* `v0` 是 SCHEME 前綴
* `<unix_seconds>` 是 `Math.floor(Date.now() / 1000).toString()`
* body 是**原始 bytes**,不是 re-stringified JSON

### Header

```
X-Karyl-Timestamp: <unix_seconds>
X-Karyl-Signature: v0=<hex_lowercase_sha256_hmac>
```

### Algorithm

```typescript
const hex = crypto.createHmac("sha256", secret)
  .update(`v0:${ts}:${body}`)
  .digest("hex");
const headerValue = `v0=${hex}`;
```

### 驗證

* Timestamp ±300s 容忍(防 replay)
* Compare 用 `crypto.timingSafeEqual()`,長度不等先 return false

### 常見踩坑

| 症狀 | 原因 |
|---|---|
| 簽章對不上 | 用 parsed-then-restringified body 簽,而非原始 raw bytes |
| Plugin response 401 從 bot | response 沒簽 / 用了不同 secret |
| `X-Karyl-Timestamp` parse 失敗 | 用 ms 而非 sec |
| Replay 攻擊 | 沒檢查 timestamp range |

`echo-webhook/src/hmac.ts` 是現成簽章工具參考。

---

## 部署

### docker-compose.yml 模板

```yaml
services:
  my-plugin:
    build: .
    image: my-plugin:local
    container_name: my-plugin
    env_file:
      - .env
    environment:
      - PORT=3000
      - KARYL_PLUGIN_SECRET=${KARYL_PLUGIN_SECRET:-}
      - KARYL_BOT_URL=${KARYL_BOT_URL:-http://karyl-chan:3000}
      - PLUGIN_URL=${PLUGIN_URL:-http://my-plugin:3000}
    networks:
      - karyl-chan-net
    restart: unless-stopped
    healthcheck:
      # node:alpine 的 BusyBox wget 對 'localhost' 解析到 ::1 但 fastify 預設綁 0.0.0.0(IPv4)
      # 一定要用 127.0.0.1
      test: ["CMD-SHELL", "wget -qO- http://127.0.0.1:3000/health || exit 1"]
      interval: 10s
      timeout: 3s
      retries: 5

networks:
  karyl-chan-net:
    external: true                    # bot 已建,我們不重建
    name: karyl-chan-net
```

### Dockerfile 模板(Node + multi-stage)

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build
RUN npm prune --omit=dev

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package.json ./
USER node
EXPOSE 3000
CMD ["node", "dist/index.js"]
```

### 第一次啟動順序

```bash
# 1. 確認 karyl-chan-net 存在
docker network ls | grep karyl-chan-net || docker network create karyl-chan-net

# 2. .env 中的 KARYL_PLUGIN_SECRET 必須跟 bot 同
grep '^KARYL_PLUGIN_SECRET=' /path/to/karyl-chan/.env > .env

# 3. up
docker compose up --build -d

# 4. 看 log 確認 register 成功
docker logs my-plugin | grep "registered with bot"
```

---

## Admin UI 整合點

* `/admin/plugins` — 列出所有 plugin、status / enabled、manifest 預覽、enable/disable toggle
* `/admin/behaviors` — 新增 behavior 時可選「行為類型: Plugin」+ 從 dropdown 選 plugin + dm_behavior key
* `/admin/guilds/[id]`(Bot Functions tab) — Phase 2.D 規劃中,後端 API 已 ready,前端待補。手動透過:
  ```http
  GET /api/plugins/guilds/<guildId>/features
  PUT /api/plugins/<id>/guilds/<guildId>/features/<featureKey> { enabled?, config? }
  ```
  操作 feature on/off 跟 config

---

## 限制與已知缺口

依當下實作狀態,plugin 開發前需要 awareness 的事:

| 缺口 | 影響 | 預計補上 |
|---|---|---|
| Event dispatch 沒帶 `feature_configs` | plugin 必須自己 RPC `storage.kv_get` 拿 config | Phase 2 |
| Slash command 命名空間沒檢查 in-process discordx commands 撞名 | operator 必須避免取跟 picture-only/todo/role-emoji/rcon-forward 同名 | Phase 2 |
| `default_member_permissions` 字串 → bigint 翻譯沒做 | manifest 設了 perms 但 Discord 不會 enforce(任何人能看到 command) | Phase 2 |
| `required_capability` 沒 enforce | manifest 宣告但 bot dispatch 前不查 admin capability | Phase 2 |
| Component(button/select)/Modal 互動 routing 沒做 | plugin 發訊息含 button,user 點下 bot 不知 route 給誰。設計用 `<plugin_id>:` custom_id prefix | Phase 2 |
| `messages.edit` route 是 stub | 不要假設可用 | Phase 2 |
| `metrics.report` RPC 不存在 | overview_metrics 這欄位 manifest 接受但無人推送 | Phase 3 |
| Per-plugin HMAC key | 共用 `KARYL_PLUGIN_SECRET`,單個 secret 洩漏會影響全部 plugin | Phase 3 |
| Per-plugin RPC rate limit | 單一 plugin 可 saturate bot RPC | Phase 3 |
| Plugin disable 時 plugin_guild_features rows 行為 | 目前保留 row + disabled flag。若 admin 永久移除 plugin row(尚無 UI),CASCADE 刪除 | — |

寫 plugin 前掃過這張表,提早決定是否撞到限制。

---

## 參考實作

* **echo-webhook**(`/home/miles/workspace/echo-webhook/`)— 最簡 dm_behavior plugin 範例。
  * `src/manifest.ts` — manifest 樣板
  * `src/plugin-client.ts` — register + heartbeat + 401 retry
  * `src/server.ts` — `/dm/echo/dispatch` HMAC 驗章 + sign response
  * `src/hmac.ts` — 簽章 helper

* Bot 端核心檔案(改架構時要改的地方):
  * `src/modules/plugin-system/plugin-registry.service.ts` — manifest validation + 登記表
  * `src/modules/plugin-system/plugin-event-bridge.service.ts` — event subscription index + dispatch
  * `src/modules/plugin-system/plugin-dispatch.service.ts` — DM behavior dispatch
  * `src/modules/plugin-system/plugin-interaction-dispatch.service.ts` — slash command interaction routing
  * `src/modules/plugin-system/plugin-command-registry.service.ts` — Discord application command sync
  * `src/modules/plugin-system/plugin-routes.ts` — `/api/plugins/*`(register / heartbeat / admin)
  * `src/modules/plugin-system/plugin-rpc-routes.ts` — `/api/plugin/*`(plugin → bot RPC)

* Schema 改動的進入點:`src/migrations/` 編號 `20260429*`(plugins / behavior-plugin-type / plugin-kv / plugin-commands / plugin-guild-features)

---

## 改本文件的時機

* manifest schema 加 / 改欄位 → 第 3 節(Manifest 規格)
* 新 RPC method → 第 8 節(Plugin → Bot RPC)
* 新 event type → 第 5 節(Bot → Plugin 事件派送)
* 新 Phase / 已知缺口收尾 → 第 13 節(限制與已知缺口)
* 認證 / 簽章方式變化 → 第 4、10 節
