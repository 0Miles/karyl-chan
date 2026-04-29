# 權限系統

## 設計目標

本 bot 是個人輔助 bot，權限系統的目的是讓**管理者在需要時能收緊**特定 role 的操作權限，而不是從零建構一套完整 RBAC。

## 雙層模型

### Layer 1 — Discord `defaultMemberPermissions`

每個 feature SlashGroup 在 Discord API 層設有所需的權限位元：

| 指令組 | 必要權限 |
|---|---|
| `/todo-channel` | `MANAGE_CHANNELS` |
| `/picture-only-channel` | `MANAGE_CHANNELS` |
| `/rcon-forward-channel` | `MANAGE_CHANNELS` |
| `/role-emoji` | `MANAGE_ROLES` |
| `/permission` | `ADMINISTRATOR` |

不具備對應位元的成員在 Discord 指令選單中根本**看不到**這些指令。admin 可在 guild 的 **Server Settings → Integrations** 手動覆寫此預設（例如把某個指令對特定 role 啟用）。

### Layer 2 — Capability 系統

通過 Layer 1 的成員還要再通過 capability 檢查才能執行。Capability 規則：

1. Guild owner 或 Administrator → **永遠通過**
2. 該 capability 在該 guild 沒有任何 grant → 以預設值決定（目前全部為 `allow`）
3. 該 capability **有任何 grant** → 切換為 **whitelist 模式**，只有符合 grant 的成員能通過（包含 `@everyone` grant）

## Capability 清單

| Capability | 說明 | 控制對象 |
|---|---|---|
| `todo.manage` | Todo channel 設定 | `/todo-channel watch/stop-watch/check-cache` |
| `picture-only.manage` | 圖片限定頻道設定 | `/picture-only-channel watch/stop-watch` |
| `rcon.configure` | RCON 頻道設定 | `/rcon-forward-channel watch/stop-watch/status/edit` |
| `rcon.execute` | 觸發 RCON 轉發 | 在 watched 頻道發送 trigger prefix 訊息 |
| `role-emoji.manage` | Role emoji 映射 | `/role-emoji add/remove/list/watch-message/stop-watch-message` |

## Admin Web Capability 清單

Admin 後台另有獨立的 capability 體系，儲存在 `admin_role_capabilities`，與上面的 guild-scoped capability 平行運作。`admin` 為超級權限，永遠通過。

| Capability | 說明 |
|---|---|
| `admin` | 完整後台權限，無視其他所有 capability 檢查 |
| `dm.message` | 讀寫 DM 對話列表、訊息、未讀數與反應 |
| `guild.message` | 讀寫所有公會頻道的訊息、反應 |
| `guild.manage` | 管理所有公會的成員、角色、設定與 bot 功能 |
| `guild:<guildId>.<message\|manage>` | 上面兩者的單公會版本 |
| `system.read` | 查看系統事件記錄與統計資訊 |
| `behavior.manage` | 管理 webhook 行為模組(目標對象與行為設定) |

## `/permission` 指令

僅 guild owner 與 Administrator 可用（雙層：Discord `defaultMemberPermissions: '8'` + runtime 檢查）。

### `/permission grant <capability> <role>`

把某個 capability 授予某個 role（包含 `@everyone`）。**一旦執行，該 capability 在該 guild 進入 whitelist 模式**。

### `/permission revoke <capability> <role>`

移除某 role 對某 capability 的 grant。若該 capability 的 grant 清空，自動回到「無 grant → 使用預設值」狀態。

### `/permission list`

列出所有 capability、對應功能描述、以及目前 grant 狀態。Ephemeral 回覆（僅自己看得到）。

## 使用場景

### 場景 1：只讓特定 role 能觸發 RCON

假設你想只讓 `@trusted-ops` role 能在 RCON 頻道打指令，阻擋其他有發言權限的人：

```
/permission grant rcon.execute @trusted-ops
```

執行後 `rcon.execute` 進入 whitelist，只有 `@trusted-ops`（及 owner/admin）能觸發轉發；其他人就算能在頻道發言也會被靜默忽略（bot 不回嗆、不透露頻道功能）。

### 場景 2：取消收緊、回復預設

```
/permission revoke rcon.execute @trusted-ops
```

若這是該 capability 最後一個 grant，清空後回到預設 allow 狀態，所有能在頻道發言的成員都能觸發。

### 場景 3：授權更多人

```
/permission grant rcon.execute @mods
```

現在 `@trusted-ops` **或** `@mods` 都能觸發。Whitelist 是聯集。

### 場景 4：明確開放給所有人

```
/permission grant rcon.execute @everyone
```

`@everyone` 的 role ID 等同於 guild ID；這個 grant 會讓 whitelist 包含所有人。**實務上等效於「沒有 grant」狀態**，但語意上更明確。

## 進階：Discord 原生覆寫

若你想讓**原本沒有 `MANAGE_CHANNELS`** 的 role 也能使用 `/todo-channel`：

1. Server Settings → Integrations → Karyl Chan → `/todo-channel`
2. 為目標 role 點 ✅ 啟用
3. 這是 Discord 原生機制，bot 端無從得知也不會干涉

搭配 Layer 2 的 grant：
1. Discord 層允許該 role 看到指令
2. `/permission grant todo.manage @that-role`（如果 `todo.manage` 已被收緊）
3. 該 role 即可使用

## 常見誤解

| 誤解 | 實際 |
|---|---|
| 「grant 等於允許」 | **更準確**：grant 非空 = whitelist 模式開啟；grant 為空 = 預設規則適用 |
| 「revoke 後該 role 被禁用」 | revoke 只移除該筆 grant；若該 capability 還有其他 grant，whitelist 繼續生效；全部清空才回到預設 |
| 「`@everyone` grant 和沒有 grant 效果一樣」 | 結果一樣但狀態不同——前者仍是 whitelist 模式（即使 whitelist 內包含 @everyone），後者是預設模式 |
| 「可以設 deny」 | 本系統只有 allow-list 模型，不支援 deny 條目；要「禁止某 role」的語意請透過 Discord 的頻道 / role 權限來做 |

## 實作位置

| 檔案 | 功能 |
|---|---|
| `src/modules/admin/admin-capabilities.ts` | Capability 字串常數、預設值、`requireCapability` / `requireGuildCapability` helpers |
| `src/modules/admin/models/admin-role.model.ts` | admin role 定義 |
| `src/modules/admin/models/admin-role-capability.model.ts` | role ↔ capability 對應 |
| `src/modules/admin/models/authorized-user.model.ts` | Discord user → admin role 對應 |
| `src/modules/admin/admin-management-routes.ts` | role / capability 管理 API |
| `tests/admin-capabilities.test.ts` | 單元測試 |
