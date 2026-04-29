# Plugin 架構檢視與改進計劃

> 撰寫於 2026-04-28,於 Phase 1.5 → Phase 2 過渡期。本文件記錄在
> 開發 echo-webhook / accounting-plugin / messaging-plugin 三個
> 範例 plugin 與相關後端、admin UI 過程中發現的架構限制與改進方向。
>
> 已隨開發完成的修正(Tier 1):reserved 指令名衝突、system behaviors
> 優先序、plugin × slash_command 不合規組合、reaper 事件索引重建、
> manifest contexts/integration_types 欄位、messages.send_dm RPC、
> All Servers feature 預設值管理 — 已落地,不在本文件再次列出。

## 嚴重度標準

- **🔴 critical** — 安全 / 資料完整性問題,使用前必須修
- **🟡 major** — 功能受限或開發體驗極差,影響 plugin 可用範圍
- **🟢 minor** — 邊角案例或最佳化空間

---

## 安全性

### 🔴 KARYL_PLUGIN_SECRET 全域共用 (S1)

所有 plugin 與 bot 共享同一把 HMAC 簽章金鑰。一個 plugin 漏洞 → 攻擊者
拿到 secret → 可冒充 bot 對任一 plugin 發 dispatch、可冒充任一 plugin
回傳 response。Plugin 數量越多風險越大。

**改進方向**

- Bot 在 register 成功時為每個 plugin 額外 mint 一把 sign key (32-byte
  hex),回傳給 plugin、bot 端存 SHA-256 hash 與明文(明文必須留,因為
  bot 簽 dispatch 時要用)。後續 dispatch / response 都用 per-plugin
  key,KARYL_PLUGIN_SECRET 只保留 register 階段的初始信任憑證。
- 每次 re-register 換 key,舊 key 立即失效。
- Plugin 端要記得 secret;若 bot 重啟丟失明文(例如改 in-memory only),
  下一次 dispatch 會 401,plugin 自動 re-register 即可。

**位置**:`src/modules/behavior/webhook-dispatch.service.ts`、
`src/modules/plugin-system/plugin-rpc-routes.ts`、各 plugin client `hmac.ts`。

### 🟡 required_capability 未 enforce (S2)

Manifest 接受 `commands[].required_capability` 與
`guild_features[].required_capability` 但 bot 在 dispatch 前**完全沒檢查**
admin 是否擁有該 capability。Plugin 作者宣告了「這指令需要
`mod.warn` capability」但任何能看到該指令的使用者都能觸發。

**改進方向**

- 在 `plugin-interaction-dispatch.service.ts` dispatch 前查
  `findUserCapabilities(interaction.user.id, guildId)`,缺 capability
  直接 ephemeral reply 拒絕。
- 對 dm_behavior 的 trigger 路徑也要套(若 manifest 宣告了 cap)。

### 🟡 default_member_permissions 字串 → bigint 翻譯缺失 (S3)

Manifest 寫 `default_member_permissions: "MANAGE_GUILD"` 但
plugin-command-registry **沒翻譯成 Discord 要求的 bigint string**,
最終 ApplicationCommand 沒設這個欄位。Discord 端不會幫忙隱藏指令,
所有人都看得到 `/relay`。

**修法明確**:`manifestToApplicationCommand` 加:
```ts
import { PermissionFlagsBits } from "discord.js";
if (cmd.default_member_permissions) {
  const flag = (PermissionFlagsBits as Record<string, bigint>)[cmd.default_member_permissions];
  if (flag !== undefined) data.defaultMemberPermissions = flag.toString();
}
```

### 🟢 Plugin manifest 沒被 sign (S4)

第一次 register 拿著明文 manifest 去比 setup secret。攻擊者若搶到
KARYL_PLUGIN_SECRET 與正確 manifest 結構,就能在 docker network 上偽
造另一個 plugin 註冊。緩解方式:setup secret 配合 IP whitelist 或
docker network policy(目前 docker compose 已是 sibling network,實務
上難偽造,但邏輯上仍是漏洞)。

---

## 資料儲存

### 🔴 KV 層僅支援 guild_id 作為 bucket (D1)

`storage.kv_get/set` 強制要求 `guild_id`。為了實做 accounting-plugin,
我們把 `user_id` 塞進 `guild_id` 欄位,語意錯誤、配額計算不直觀(
per-user 配額借用 per-guild 限制)、admin UI 端 `findFeatureRowsByGuild`
會把這些「user as guild」row 一起抓出來。

**改進方向**

把 KV 改為多 bucket type:
```sql
plugin_kv (
    pluginId,
    bucketType TEXT NOT NULL,    -- 'guild' | 'user' | 'channel' | 'global'
    bucketId   TEXT NOT NULL,    -- 對應的 id;global 時固定 ""
    key,
    value,
    UNIQUE(pluginId, bucketType, bucketId, key)
)
```
RPC 改:`storage.kv_get({ bucket_type, bucket_id, key })`。配額也按
bucketType 分(per-user 量級 vs per-guild 量級不同)。

### ✅ KV 沒有 atomic increment (D2) — FIXED 2026-04-29

新增 `storage.kv_increment` RPC。實作用 in-process per-key promise
chain (`Map<lockKey, Promise>`) 序列化同一 key 的並發 RMW,**不**用
DB-level transaction。Accounting plugin 的 `nextId()` 已換用此 RPC,
10 個並發 add 都拿到不同 id;:memory: SQLite 單元測試也通過(見
`tests/plugin-kv.test.ts`)。

> ⚠️ **走過的彎路**:第一版用 `BEGIN IMMEDIATE` transaction,在
> file-based prod DB 跑得好,但 vitest 用 `:memory:` SQLite 時
> sequelize pool 縮成單連線,parallel `BEGIN IMMEDIATE` 會撞到
> 「cannot start a transaction within a transaction」。改用
> per-key in-process mutex 兩端通吃。
>
> 限制:bot 必須是 single-process,multi-process 部署需要回頭做
> DB-level lock(`UPSERT` with arithmetic 或 transaction + queue)。

### 🟡 KV list 是 N+1 fetch (D3)

`kv_list` 只回 keys,plugin 拿到後要 N 次 `kv_get`。30 天記帳 list
變成 30+ RPC round-trip。

**改進**:`kv_list` 加 `include_values: true` 旗標,後端一次性 SELECT
key, value 回傳。要注意 quota:不能讓 plugin 一次撈 64KB × 100 把
RAM 壓爆。

### 🟢 secret-typed config 在 dispatch payload 中是 plaintext (D4)

`encryptSecret()` 加密了在 storage 中的值,但 dispatch 前 bot 解密、
明文走 HTTPS over docker network 給 plugin。docker network 已隔離還
ok,但 plugin 自己 log 時容易意外吃到。可選加上「mask preview / full
plaintext only on explicit reveal」flag,plugin 端 wrapper 預設遮罩。

---

## 派送與 RPC

### 🔴 Plugin 5s timeout 沒有 DLQ / retry / metrics (R1)

Event dispatch / DM dispatch / interaction dispatch 都是 fire-and-forget
+ 5s timeout。Plugin 暫時 down 期間的 events 全部丟失,沒有 metrics 顯
示掉了多少筆。

**改進**

最小:加 `bot_event_log` 一筆 warn-level 紀錄(已部分實作)+
`plugin_dispatch_metrics` 表存 success / failure / latency_ms 累計。
中等:用 in-process queue 暫存掉 dispatch,plugin 回來後重送 N 筆。
完整:DLQ table + admin 重放 UI。

### 🟡 沒有 plugin → bot RPC rate limit (R2)

Plugin token 認證後可無限制呼叫 RPC。一個壞掉的 plugin 跑 infinite
loop 呼叫 `messages.send` 可以打爆 bot CPU + Discord rate limit。

**改進**:對每個 (pluginId, method) 加 token bucket(例如 100 req/sec
per method,或全 RPC 共用 1000 req/sec)。超出 → 429。

### 🟡 Component / Modal interaction 無路由機制 (R3)

Plugin 透過 `messages.send` 帶 button,user 點下來 bot 不知 route
給哪個 plugin。設計上預期 `custom_id` 用 `<plugin_key>:<...>` 前綴
做路由,但目前 main.ts 沒實作 prefix 路由 — 點了沒反應。

**改進**:在 `interactionCreate` 加 component branch,parse custom_id
prefix → 找對應 plugin → POST 到 `endpoints.component_action`(新增的
manifest 欄位)。

### 🟡 Per-guild slash command sync 缺失 (R4)

當 admin 在某 guild 關掉 plugin feature 時,該 guild 的 plugin slash
commands 仍然可見。原因:plugin command 全用 global scope 註冊
(`bot.application.commands.create`),沒辦法 per-guild filter。

**改進方向**(取一)

(a) 改 plugin command scope='guild' 路徑:每個 enabled 的 guild
個別 register。Toggle off → 從 該 guild 刪 command。startup 時建
所有 (pluginId, guildId) 組合表並 reconcile 到 Discord。**缺點**:
discord 對 guild 命令數量有限制 (100/guild),且 register 速度慢。

(b) 全 global 但在 dispatch 時拒絕:user 在 disabled guild 觸發
command → bot reply ephemeral 「此功能在本伺服器未啟用」。**缺點**:
使用者體驗差(指令看得見但用不了)。

實務建議:先做 (b)(改動小),再評估是否升級到 (a)。

### 🟢 dm_behavior dispatch 沒帶 feature_configs (R5)

只有 webhook payload,plugin 拿不到 admin 在 BehaviorsPage 設的任何
config。要靠 plugin 自己 RPC kv_get 拿,沒整合好。Plugin guide 已
flag 為 Phase 2 待補。

### 🟢 Autocomplete 1.5s budget 過於樂觀 (R6)

跨 docker network 的 plugin call 在 stress 下 1.5s 不夠。實測下 P99
可能超過。失敗時 fail-open 回空 choices,user 體驗是「打字後選單
消失」。把 timeout 拉到 2.0s + 提供 plugin in-memory cache hint。

---

## Plugin 命名空間 / 指令

### 🟡 Plugin command 撞名 in-process discordx command 沒檢查 (N1)

目前 RESERVED_COMMAND_NAMES 只列 manual/break/login(我們手動 hoist
的)。但 in-process 還有 picture-only-channel / todo-channel /
rcon-forward-channel / role-emoji。Plugin 宣告同名 command 會撞。

**修法**:在 startup 後把 `bot.application.commands.cache` 清單拉出來
全部加進 RESERVED_COMMAND_NAMES,或直接讓 plugin-command-registry
查 `bot.application.commands` 而非靜態白名單。

### 🟢 Plugin command 名稱沒 namespace (N2)

兩個 plugin 都想叫 `/list` 撞名 — 先到先得。長期解法是 plugin command
強制 namespace prefix(例如 `/<plugin-key>-<command>`),或允許 plugin
作者宣告 namespace 但不強制。短期工程妥協:operator 自己協調。

---

## Admin UI / DX

### 🟡 Plugin guild_features config_schema 未在 admin UI 暴露 (U1)

Manifest 可以宣告 `config_schema` 且後端 `PUT /api/plugins/:id/guilds/:guildId/features/:featureKey`
會接 config object 並做 secret 加密。但 admin 看不到 config 表單 — 沒
入口可以填值。Plugin 收 dispatch 時 config 是空的。

**改進**:在 GuildPluginFeaturesPanel 加「設定」展開,根據
config_schema 產生對應 input(text / number / channel picker / role
picker / secret),提交時打 PUT。

### 🟡 Plugin overview_metrics 無人寫 (U2)

Manifest 接受 `overview_metrics: [{ key, label, type: 'counter' }]` 但
沒有 `metrics.report` RPC,plugin 推不上來,admin UI 也沒顯示位置。
這欄位等同 dead code。

**改進**:新增 `metrics.report({ guild_id, feature_key, counters })`
RPC,寫 plugin_guild_features.metricsJson;admin overview tile 端
渲染 manifest 中宣告的 counter labels + 最新值 + 簡單 sparkline。

### 🟢 Plugin disable 不會主動清掉 plugin_guild_features rows (U3)

Plugin 卡住變 inactive 或 admin 永久移除 plugin row,plugin_guild_features
靠 ON DELETE CASCADE 清。但 plugin 只是 disabled(enabled=false)時,
features 會繼續被列在 guild page、toggle 也能切,但實際不會被
dispatch。應該在 UI 加灰色標示「plugin 目前停用」(已部分做)。

### 🟢 Plugin manifest 預覽是原始 JSON (U4)

`/admin/plugins` 點 plugin 看到的是整坨 JSON。可以做更友善的
breakdown(分區顯示 events / dm_behaviors / commands / config_schema)。

---

## 生命週期

### 🟡 Plugin token 失效時 plugin 端唯一線索是 401 (L1)

Bot 重啟 → in-memory token cache 清空 → plugin 下一個 RPC 收 401 →
plugin 自己 re-register。沒問題。但 plugin 若沒實作 401 → re-register
邏輯(例如自製 plugin 用其他語言寫),會卡死。

**改進**:Bot 端在重啟後保留 plugin 列表 metadata,主動推一個 「請
重新 register」訊號(可以用 webhook 或 long-poll/SSE)。或者文件強
調「401 必須觸發 re-register」並在 plugin guide 給 reference 實作。

### 🟢 Plugin re-register 不會通知 admin UI (L2)

Plugin 重啟 → manifest 可能改了 → admin UI 不知道,還顯示舊 manifest。
要 admin 重新整理頁面才看得到。可加 Server-Sent Events / polling
頻率。

---

## 資料庫遷移 / Schema 規範

### 🟢 SQLite 沒外鍵預設啟用 (DB1)

CASCADE 寫了但 SQLite 預設 `PRAGMA foreign_keys=OFF`。實務上看 db.ts
有沒有 SET ON。檢查並補上。(若 ON,本項可關。)

### 🟢 plugin_kv quota 計算每次 set 都掃全表 (DB2)

`sumGuildBytes` 每次 set 前掃 `SUM(LENGTH(value))`,N 個 keys 就 O(N)
查詢。對 100+ keys 的 plugin(例如 30 天 + 月度匯總)會堆積。可以
維護一個 plugin_kv_usage 表用 trigger 增量,或在 set 時用 UPSERT
+ 計算 delta。

---

## 落實優先序建議

下一個 sprint 建議按以下排:

| Tier | 項目 | 估時 |
|---|---|---|
| Sprint A — 安全 | S1 per-plugin sign key、S2 capability enforcement、S3 perms 翻譯、N1 reserved name 自動掃描 | 2 days |
| Sprint B — DX | U1 config_schema 表單、U2 metrics.report、R5 dispatch 帶 feature_configs | 3 days |
| Sprint C — 健壯性 | R1 metrics + retry、R2 rate limit、R4 per-guild dispatch reject、L1 plugin re-register 訊號 | 3 days |
| Sprint D — 儲存升級 | D1 多 bucket type、D2 atomic increment、D3 list-with-values | 2 days |
| Sprint E — 互動補完 | R3 component/modal routing、N2 namespace 規範 | 3 days |

---

## 已驗證的 plugin 範例

- `/home/miles/workspace/echo-webhook` — 最小 dm_behavior plugin
- `/home/miles/workspace/accounting-plugin` — slash command + storage
  RPC 整合(per-user bucket workaround for D1)
- `/home/miles/workspace/messaging-plugin` — slash command + 跨向
  訊息發送(messages.send / messages.send_dm)+ 授權 allowlist

每個都附 README 說明部署方式;從 echo → accounting → messaging 順序
逐步打開 manifest 各個欄位。

---

## 改本文件的時機

- 跑完一輪 sprint 後,清掉已完成項
- 發現新缺陷時直接補進對應分類
- Phase / schema_version bump 時,把過時項刪掉(別累積 stale 內容)
