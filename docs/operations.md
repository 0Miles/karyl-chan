# 運維手冊

## 資料庫

SQLite 單檔；預設位置：

| 環境 | 路徑 |
|---|---|
| 本機（未設 `SQLITE_DB_PATH`） | `./data/database.sqlite` |
| Docker 容器內 | `/usr/src/app/data/database.sqlite` |
| Docker volume | `karyl-chan-data` mount 到上述容器路徑 |

### 備份

最簡單的做法（容器運行時可直接複製）：

```bash
# 如果用 docker compose（image 部署）
docker compose cp bot:/usr/src/app/data/database.sqlite ./karyl-chan-$(date +%Y%m%d).sqlite

# 如果用本機部署
cp ./data/database.sqlite ./backup/karyl-chan-$(date +%Y%m%d).sqlite
```

SQLite 單檔的備份原子性需要注意：執行時最好先 `VACUUM INTO`：

```bash
docker compose exec bot sqlite3 /usr/src/app/data/database.sqlite "VACUUM INTO '/tmp/backup.sqlite'"
docker compose cp bot:/tmp/backup.sqlite ./karyl-chan-$(date +%Y%m%d).sqlite
```

### 還原

停止 bot → 覆寫檔案 → 啟動：

```bash
docker compose stop bot
docker compose cp ./karyl-chan-20260422.sqlite bot:/usr/src/app/data/database.sqlite
docker compose start bot
```

### 表結構

| 表 | 用途 |
|---|---|
| `TodoChannels` | Todo 頻道登記 |
| `TodoMessages` | Todo 訊息記錄 |
| `PictureOnlyChannels` | 圖片限定頻道登記 |
| `RoleEmojis` | Emoji → role 對應 |
| `RoleReceiveMessages` | 被監聽的領取訊息 |
| `RconForwardChannels` | RCON 轉發設定（password 欄加密） |
| `CapabilityGrants` | 權限 grant 紀錄 |

由 Sequelize 自動管理，啟動時 `sequelize.sync()` 會補齊缺少的表（非破壞性，不會改現有欄位）。

## 日誌

容器採 stdout／stderr 寫入（Docker 預設），可用：

```bash
docker compose logs -f bot                 # 即時 follow
docker compose logs --tail 200 bot         # 最近 200 行
docker compose logs --since 1h bot         # 最近一小時
```

### 重要日誌樣式

| 訊息 | 意義 |
|---|---|
| `Bot started` | 成功登入並 initApplicationCommands |
| `Connection authenticated: <host>:<port>` | RCON 連線握手成功 |
| `Received response from <host>:<port> (N bytes)` | RCON 回應（內容不寫日誌，僅長度） |
| `rcon.execute denied: user=X channel=Y` | 某人被 capability 系統擋下 |
| `decryptSecret: legacy plaintext value detected...` | 有舊的明文密碼尚未升級 |
| `Cleaning up inactive connection: <host>:<port>` | 連線閒置 30 分鐘被自動清理 |
| `Unhandled promise rejection: ...` | 有未捕捉的 Promise rejection，需追查 |

## 升級

### 升級 Image

若採用 ghcr-image 方案（`docker-compose.example.yml`），啟用了 watchtower label 會自動更新。手動升級：

```bash
docker compose pull && docker compose up -d
```

### 升級時的 schema 變動

Sequelize `sync()` 僅**補建新表**，不改既有欄位。新增功能若要加欄位到既有表，需要手動 migration（目前尚無此情況，因為開發期還在加新表）。

### 依賴稽核

CI 的 `npm audit` step 是 `continue-on-error` — 不會卡住發佈，但會在 log 中顯示。定期：

```bash
npm audit --omit=dev            # 檢視 production 漏洞
npm audit fix                   # 非破壞性修補
npm audit fix --force           # 含破壞性升級（需測試）
```

目前（最近一次執行）約 7 個 advisories 仍在 `sqlite3` 的 tar 依賴，需要 `--force` 升 sqlite3 到 6.x 才能清乾淨，留作獨立 PR 處理。

## 疑難排解

### Bot 啟動後 log 顯示 `Unhandled promise rejection: Error: Used disallowed intents`

沒有在 Discord Developer Portal 勾選 privileged intents。見 [setup.md](setup.md#建立-discord-bot) 第 3 步。

### Slash command 在 guild 看不到

- 確認 bot 成功啟動並看到 `Bot started`
- 確認邀請 URL 含 `applications.commands` scope
- 確認使用者具備該 SlashGroup 的 `defaultMemberPermissions`（或在 Server Settings → Integrations 手動覆寫）
- 刷新 Discord client（`Ctrl+R`）

### RCON 設定後無反應

1. `/rcon-forward-channel status` 確認設定存在
2. 檢查發送者是否有 `rcon.execute` capability（若有 grant 且該人不在 whitelist，會被靜默忽略）
3. 檢查觸發前綴是否正確（預設 `/`）
4. 檢查容器 log — 預期看到 `Connection authenticated` 或錯誤訊息

### RCON 連線持續失敗

- 確認從 bot container 可直接連到 RCON 目標（`docker exec bot ping <host>`）
- 確認 `mc-network` 已正確建立且 Minecraft container 在同 network
- 檢查 RCON server 那側是否開放對應 port 且密碼正確
- 若 host 是雲端 metadata endpoint → 被我們的 host policy 擋下，這是刻意的

### 密碼加密/解密錯誤

- `ENCRYPTION_KEY is not set`：未設環境變數
- `ENCRYPTION_KEY must be 32 bytes`：key 長度錯誤，用 `openssl rand -hex 32` 重產
- `Unsupported state or unable to authenticate data`：GCM tag 驗證失敗。多半是：
  - Key 換了但密碼沒重設（需 `/rcon-forward-channel edit` 重新輸入）
  - 密文被截斷或竄改

### 權限 grant 不生效

- 確認該 role 通過 Discord `defaultMemberPermissions`（或 Server Settings 覆寫）
- `/permission list` 確認 grant 已寫入
- 該成員是否在你檢查的那個 guild 裡有該 role

## 容器行為

### 重啟行為

`docker-compose.example.yml` 使用 `restart: unless-stopped` — 意外終止會自動重啟，手動停止（`docker compose stop`）後不會重啟。

### 資料 volume

`karyl-chan-data` named volume 保存在 Docker 的 volume 儲存。刪除容器不影響資料；要同時刪資料需 `docker compose down -v`。

### watchtower 自動更新

`docker-compose.example.yml` 設了 `com.centurylinklabs.watchtower.enable=true` label。若你在同一台機器也跑了 watchtower 容器，bot image 有新版本時會自動 pull & restart。
