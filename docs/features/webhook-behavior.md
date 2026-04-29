# Webhook Behavior

## 用途

讓 admin 在後台設定一組「DM 觸發 → 對外 webhook 轉發」的規則。一般使用者在私訊裡輸入符合 trigger 的訊息時，bot 會把該訊息打包成 Discord webhook payload 送到設定好的 URL，並把 webhook 的同步回應 relay 回 user 的私訊。

支援兩種轉發模式：
- **一次性轉發 (`one_time`)**：命中觸發 → 送一次 → 結束
- **持續轉發 (`continuous`)**：命中觸發 → 開啟 session → 之後該 user 在 DM 的每則訊息都直接 POST 到該 webhook，直到結束

Session 狀態存於 `behavior_sessions` 表(以 user 為主鍵)，bot 重啟後仍然繼續運作。

## 核心概念

### 目標對象 (Target)

行為設定掛在「目標對象」之下，三種類型：

| Kind | 用途 | 唯一性 |
|---|---|---|
| `all_dms` | 對所有 DM 來源生效。系統內固定為 id=1 的 singleton | 唯一(partial unique index) |
| `user` | 對單一 Discord user 的 DM 生效 | per userId 唯一 |
| `group` | 對該 group 的成員(`behavior_target_members`)生效 | per groupName 唯一 |

`all_dms` 永遠存在且不可刪除。`user` / `group` 由 admin 在 `/admin/behaviors` 頁面用側欄的 `+` 按鈕新增、刪除。

### 行為 (Behavior)

每個 target 下可掛多個行為，每個行為包含：

| 欄位 | 說明 |
|---|---|
| `title` / `description` | 顯示用文字 |
| `triggerType` | `startswith` / `endswith` / `regex` |
| `triggerValue` | trigger 的字串值 |
| `forwardType` | `one_time` / `continuous` |
| `webhookUrl` | 目的 webhook 完整 URL，AES-256-GCM 加密儲存 |
| `webhookSecret` | 選填的 HMAC 共用密鑰；設定後啟用雙向簽名驗證(見下方專段),AES-256-GCM 加密儲存 |
| `sortOrder` | 同一 target 下的判定順序，可拖曳調整 |
| `stopOnMatch` | 命中後是否阻止後續行為被判定 |
| `enabled` | 是否啟用 |

### 評估順序

當一則 DM 進來，bot 依以下順序展開候選行為清單：

1. 觸發 user 的 `user` target 的所有 enabled behaviors(按 sortOrder ASC)
2. 該 user 屬於的所有 `group` target 的 enabled behaviors(按 sortOrder ASC)
3. `all_dms` target 的所有 enabled behaviors(按 sortOrder ASC)

逐一比對 trigger，命中即 dispatch。命中的行為若 `stopOnMatch=true` 則停止判定後續所有行為。

### 持續轉發終止機制

兩個獨立的終止入口：

- **使用者端**：DM 中執行 `/break` slash command，立即結束該 user 的 active session
- **Webhook 服務端**：webhook 的同步回應 `content` 內含 `[BEHAVIOR:END]` token(不分大小寫)，會被偵測並結束 session；該 token 會在 relay 回 user 前被移除

任一 session 結束後，bot 會 DM 通知 user 並刪除 session row。下一則 DM 會回到正常的 trigger 評估流程。

## 指令

### `/manual` (DM only)

列出該 user 適用的所有 enabled behaviors，按評估順序顯示。每筆顯示 title、trigger 摘要、類型、description。若有 continuous 行為，footer 提示「可輸入 `/break` 結束」。**若清單為空只回「目前沒有可用的行為」，不暴露 target 結構。**

### `/break` (DM only)

結束該 user 的 active continuous session。無 session 時回「目前沒有持續轉發可結束」。

兩個指令皆全域註冊(`guilds: []`)、`contexts` 限制在 BotDM / PrivateChannel，不會出現在 guild 介面中。

## Web 管理介面

路徑：`/admin/behaviors`

需要 `admin` 或 `behavior.manage` capability(見 [docs/permissions.md](../permissions.md#admin-web-capability-清單))。

- **左側 sidebar**：固定顯示「所有私訊」於頂部，下方列出所有 user / group target；標題列 `+` 按鈕開啟「新增目標對象」modal
- **主區塊**：選中 target 後顯示其下所有 behavior 卡片(可折疊)、可拖曳排序(SortableJS)、可即時 enable/disable、可編輯/刪除/搬到別的 target
- **Group target**：額外提供成員清單與重新命名

**範圍 / 第二階段**：目前只支援 `behavior.manage` 全開管理權。「依目標對象區分」的 scoped 權限(`behavior:<targetId>.manage`)的 backend 評估與 UI grant 仍待第二階段。Schema、route guard、token parser 已預留擴充空間。

## Webhook payload 與回應

依 `discord-api-types`(透過 discord.js 提供) 標準型別組裝：

- **送出**：`RESTPostAPIWebhookWithTokenJSONBody`
  - `content` = DM 訊息內文 + 附件 URL 列表(換行分隔)
  - `embeds` = 來源訊息的 embeds
  - `username` / `avatar_url` = 來源 user 的顯示名 / avatar
  - `allowed_mentions: { parse: [] }` 阻止來源訊息把任何 mention 重新觸發
  - URL 自動 append `?wait=true` 取得 `APIMessage` 回應
- **收到**：`APIMessage`
  - `content` 部分 relay 回 user 的 DM
  - 含 `[BEHAVIOR:END]` token 即結束 session(token 從 relay 內容中 strip)

dispatch 失敗(網路 / 4xx / 5xx / 簽名驗證失敗)會寫入 `bot_events`，session 維持原狀(continuous 不會自動斷)；user 端可隨時 `/break` 強制結束。

## Webhook 簽名驗證(雙向)

每個 behavior 可選填 `webhookSecret`(AES-256-GCM 加密儲存)。**設定後啟用 HMAC-SHA256 雙向驗證**：

| 方向 | Headers | 簽名計算 |
|---|---|---|
| Bot → 服務端(POST) | `X-Karyl-Timestamp: <unix>`、`X-Karyl-Signature: v0=<hex>` | `HMAC_SHA256(secret, "v0:" + timestamp + ":" + body)` |
| 服務端 → Bot(response) | 同上兩個 header | 同上計算式,但 body 是 response body |

- **Replay 防護**：timestamp 與接收端時鐘差 > 300s 直接拒絕
- **比對方式**：`crypto.timingSafeEqual` 防 timing-attack
- **Strict 模式**：secret 已設定但 response 缺 header / 簽名錯誤 / timestamp 過期 → 整次 dispatch 視為失敗,**不會 relay 內容回 user**(避免轉發偽造訊息)
- **未設 secret**：兩邊都不簽不驗,沿用未驗證的 round-trip(向後相容既有 behavior)
- **scheme 版本**：簽名值前綴 `v0=`,未來換算法直接 bump 為 `v1=`,新舊可共存解析

服務端實作參考(Node.js)：
```js
import crypto from 'node:crypto';

function verify(req, body, secret) {
  const ts = req.headers['x-karyl-timestamp'];
  const sig = req.headers['x-karyl-signature'];
  if (!ts || !sig) return false;
  if (Math.abs(Math.floor(Date.now()/1000) - Number(ts)) > 300) return false;
  const expected = 'v0=' + crypto.createHmac('sha256', secret)
    .update(`v0:${ts}:${body}`).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

function sign(body, secret) {
  const ts = Math.floor(Date.now()/1000).toString();
  const sig = 'v0=' + crypto.createHmac('sha256', secret)
    .update(`v0:${ts}:${body}`).digest('hex');
  return { 'X-Karyl-Timestamp': ts, 'X-Karyl-Signature': sig };
}
```

## 安全注意事項

- `webhookUrl` 與 `webhookSecret` 皆以 `utils/crypto.encryptSecret` AES-256-GCM 加密儲存於 DB
- admin web 介面對 admin **回傳明文**(secret 是雙方共用必須能讀回對齊),encrypt 只防止 DB 直接外洩
- 所有 admin web 寫入(targets / members / behaviors / reorder)皆寫入 `admin_audit_log`(hash chain)
- behavior 的 webhookUrl / webhookSecret / triggerType / triggerValue / forwardType 任何變動,會自動清掉該 behavior 的 active session(避免舊 session 用新設定的部分屬性繼續跑;尤其是 secret 換掉後舊 session 簽名會被服務端拒絕)

## 實作位置

| 檔案 | 功能 |
|---|---|
| `src/migrations/20260428080843-webhook-behavior.ts` | schema migration |
| `src/migrations/20260428090428-behavior-webhook-secret.ts` | webhookSecret 欄位 migration |
| `src/modules/behavior/models/behavior-target.model.ts` | target CRUD + `ensureAllDmsTarget` |
| `src/modules/behavior/models/behavior-target-member.model.ts` | group 成員 CRUD |
| `src/modules/behavior/models/behavior.model.ts` | behavior CRUD + reorder |
| `src/modules/behavior/models/behavior-session.model.ts` | session CRUD |
| `src/modules/behavior/webhook-dispatch.service.ts` | webhook POST + HMAC 簽名/驗證 + `[BEHAVIOR:END]` 偵測 |
| `src/modules/behavior/behavior-trigger.ts` | 純函式 `matchesTrigger` / `describeTrigger` |
| `src/modules/behavior/events/webhook-behavior.events.ts` | DM messageCreate handler |
| `src/commands/manual.commands.ts` | `/manual` slash |
| `src/commands/break.commands.ts` | `/break` slash |
| `src/modules/behavior/behavior-routes.ts` | admin web API |
| `frontend/src/views/admin/behaviors/*.vue` | 管理頁面 |
| `frontend/src/api/behavior.ts` | 前端 api client |
