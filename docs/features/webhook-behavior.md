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

dispatch 失敗(網路 / 4xx / 5xx)會寫入 `bot_events`，session 維持原狀(continuous 不會自動斷)；user 端可隨時 `/break` 強制結束。

## 安全注意事項

- `webhookUrl` 用 `utils/crypto.encryptSecret` AES-256-GCM 加密；admin web 永遠不回傳明文，編輯時用 `••••••••` 顯示，留空＝不變
- 所有 admin web 寫入(targets / members / behaviors / reorder)皆寫入 `admin_audit_log`(hash chain)
- behavior 的 webhookUrl / triggerType / triggerValue / forwardType 任何變動，會自動清掉該 behavior 的 active session(避免舊 session 用新設定的部分屬性繼續跑)

## 實作位置

| 檔案 | 功能 |
|---|---|
| `src/migrations/20260428080843-webhook-behavior.ts` | schema migration |
| `src/models/behavior-target.model.ts` | target CRUD + `ensureAllDmsTarget` |
| `src/models/behavior-target-member.model.ts` | group 成員 CRUD |
| `src/models/behavior.model.ts` | behavior CRUD + reorder |
| `src/models/behavior-session.model.ts` | session CRUD |
| `src/services/webhook-dispatch.service.ts` | webhook POST + `[BEHAVIOR:END]` 偵測 |
| `src/utils/behavior-trigger.ts` | 純函式 `matchesTrigger` / `describeTrigger` |
| `src/events/webhook-behavior.events.ts` | DM messageCreate handler |
| `src/commands/manual.commands.ts` | `/manual` slash |
| `src/commands/break.commands.ts` | `/break` slash |
| `src/web/behavior-routes.ts` | admin web API |
| `frontend/src/views/admin/behaviors/*.vue` | 管理頁面 |
| `frontend/src/api/behavior.ts` | 前端 api client |
