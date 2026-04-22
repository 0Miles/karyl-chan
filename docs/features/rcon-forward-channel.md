# RCON forward channel

## 用途

把某個 Discord 頻道的訊息**轉發到遊戲伺服器的 RCON 介面**（如 Minecraft、CS 系列等支援 Source RCON 協定的伺服器）。成員在頻道打特定前綴開頭的訊息，bot 會翻譯成 RCON 指令送到遊戲伺服器並把回應貼回頻道。

## 快速流程

1. 設定 `ENCRYPTION_KEY` 環境變數（若未設，功能無法運作 — 見 [安裝文件](../setup.md#環境變數)）
2. `/rcon-forward-channel watch`（在當作轉發入口的頻道執行）
3. Modal 填入 host / port / password / trigger prefix / command prefix
4. 頻道內發送以 trigger prefix 開頭的訊息，bot 自動轉發
5. 取消轉發 → `/rcon-forward-channel stop-watch`

## 指令

### `/rcon-forward-channel watch`
**Capability**：`rcon.configure`

開啟設定 modal。若該頻道尚未設定 → 建立新紀錄；若已存在 → 回覆 "No action"（改用 `edit` 來修改）。

Modal 欄位：

| 欄位 | 必填 | 說明 |
|---|---|---|
| Host | ✅ | RCON 目標主機名稱或 IP。容器名（`mc`）、私網 IP、public IP 都可；雲端 metadata endpoint 會被拒絕 |
| Password | ✅ | RCON 密碼，**以 AES-256-GCM 加密後儲存** |
| Port | ✅ | RCON 連接埠，預設 `25575`（Minecraft 標準） |
| Trigger prefix | ✅ | 觸發轉發的頻道訊息前綴，預設 `/`（例如 `/list`） |
| Command prefix | 否 | 實際送到 RCON 的指令前綴，預設 `/`。留空＝去除前綴直接送 |

### `/rcon-forward-channel stop-watch`
**Capability**：`rcon.configure`

停止對當前頻道的轉發。紀錄刪除但不影響已建立的 RCON 連線（連線 30 分鐘無活動會自動清理）。

### `/rcon-forward-channel status`
**Capability**：`rcon.configure`

顯示當前頻道的設定（host/port/trigger prefix/command prefix）。**密碼以 `••••••••` 遮罩顯示**，不會洩漏。

### `/rcon-forward-channel edit`
**Capability**：`rcon.configure`

開啟 modal 編輯現有設定。Host/Port/Trigger/Command prefix 會預填；**Password 欄位不預填，可留空以保留原密碼**。

### 觸發轉發（無指令，只發訊息）
**Capability**：`rcon.execute`

在 watched 頻道發送以 `triggerPrefix` 開頭的訊息：

```
/list
```

bot 會：
1. 檢查發送者的 `rcon.execute` capability（不通過就**靜默忽略**，不回覆任何訊息）
2. 把觸發前綴替換成 command prefix：`/list` → `/list`（如果兩者相同）
3. 通過 rate limit 檢查（每頻道每分鐘最多 10 條）
4. 送到 RCON，把回應貼回頻道

## 安全機制

### 密碼加密靜態儲存

- 寫入 DB 時用 `AES-256-GCM` 加密，格式 `v1:<iv>:<tag>:<ct>`（全部 base64）
- Key 從 `ENCRYPTION_KEY` 環境變數取得（32 bytes hex）
- 只有事件層轉發前才解密；slash 指令／日誌絕不顯示明文
- 舊部署的明文密碼會被偵測為 legacy，首次使用印 warning；執行 `/rcon-forward-channel edit` 重新輸入即完成加密升級

詳見 [安全模型 § RCON 密碼](../security.md#rcon-密碼)。

### Host policy

`src/utils/host-policy.ts` 會阻擋以下目標：
- 雲端 metadata endpoint（`169.254.0.0/16`、`168.63.129.16`、`100.100.100.200`、`192.0.0.192`）
- Metadata hostname（`metadata.google.internal` 等）
- 非 IPv4 literal 的主機名稱會先做 DNS lookup，解析到 blocked IP 同樣拒絕

私網 IP（`10.x`、`172.16.x`、`192.168.x`、`localhost`、docker container name）全部允許 — 這類用途是「管理 bot」的正常場景。

### 錯誤訊息去識別化

RCON 底層（連線被拒、握手失敗、timeout）的錯誤訊息**不會原文**回到 Discord embed，只寫進 container 日誌。頻道上看到的只有固定字串（「連線發生錯誤，將嘗試重新連線」等），避免 RCON target 被當成埠探測代理。

### Rate limiting

每個頻道每分鐘最多 10 條轉發；超過回覆 Rate Limited embed，並不計入超量。見 `src/utils/rate-limiter.ts`。

### Reconnect 策略

連線錯誤時以 exponential backoff（1s → 2s → 4s → … max 30s）重試最多 3 次，失敗後關閉連線並通知頻道。連線 30 分鐘無活動自動清理。

## 所需 Bot 權限

- `View Channels`
- `Send Messages`（回傳 RCON 回應）
- `Read Message History`

## 資料儲存

- `RconForwardChannel(channelId, guildId, commandPrefix, triggerPrefix, host, port, password)`
  - Password 以 `v1:iv:tag:ct` 格式儲存

## 實作位置

| 檔案 | 功能 |
|---|---|
| `src/commands/rcon-forward-channel.commands.ts` | Slash 指令 + modal |
| `src/events/rcon-forward-channel.events.ts` | messageCreate 觸發 + capability 檢查 + 定時清理 |
| `src/services/rcon-connection.service.ts` | RCON 連線池、重連、事件分發 |
| `src/services/rcon-queue.service.ts` | 每頻道速率限制 + 排隊邏輯 |
| `src/utils/crypto.ts` | 密碼加解密 |
| `src/utils/host-policy.ts` | Metadata endpoint 阻擋 + DNS 檢查 |
| `src/utils/rate-limiter.ts` | 頻道級速率限制 |
| `src/models/rcon-forward-channel.model.ts` | Sequelize 模型 |
