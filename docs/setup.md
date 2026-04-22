# 安裝與部署

## 環境需求

| 項目 | 最低版本 | 備註 |
|---|---|---|
| Node.js | 24 (LTS) | 若使用 Docker 不需本機安裝；最低 22 |
| npm | 10 | 通常隨 Node 安裝 |
| Docker / Compose | 24+ | 僅容器部署需要 |
| Discord bot token | — | 見下方「建立 Discord bot」 |

## 建立 Discord bot

1. 到 [Discord Developer Portal](https://discord.com/developers/applications) 建立 Application
2. 左側 **Bot** 分頁建立 bot、複製 token
3. **Privileged Gateway Intents** 勾選：
   - `SERVER MEMBERS INTENT`
   - `MESSAGE CONTENT INTENT`
4. 產生邀請連結（**OAuth2 → URL Generator**）：
   - Scopes: `bot`, `applications.commands`
   - Bot Permissions: `Manage Channels`, `Manage Messages`, `Manage Roles`, `Add Reactions`, `Read Message History`, `Send Messages`, `View Channels`
5. 用該連結把 bot 加入你的 guild

## 環境變數

| 變數 | 必填 | 說明 |
|---|---|---|
| `BOT_TOKEN` | ✅ | Discord bot token |
| `ENCRYPTION_KEY` | 使用 RCON 功能時必填 | 32 bytes 的 hex 字串，用於加密 RCON 密碼。產生方式：`openssl rand -hex 32` |
| `NODE_ENV` | 否 | 預設 `production` |
| `SQLITE_DB_PATH` | 否 | SQLite 檔案路徑，預設 `./data/database.sqlite`（容器內為 `/usr/src/app/data/database.sqlite`） |
| `WEB_PORT` | 否 | 管理 API HTTP 埠，預設 `3000` |

複製範本：
```bash
cp .env.example .env
# 編輯 .env 填入實際值
```

## 本機開發

```bash
npm ci                 # 安裝相依
npm run start          # 以 nodemon + ts-node 執行，修改自動 reload
npm test               # 跑單元測試
npm run build          # 產生 build/ 下的 JS（用於 Docker runtime）
```

## Docker 部署

兩種起法，擇一：

### 選項 A：從原始碼 build（本地 Dockerfile）

倉庫內建的 `docker-compose.yml` 會用專案內的 `Dockerfile` 現場 build：

```bash
docker compose up -d --build
```

需要 `.env` 存在於同目錄。

### 選項 B：使用 ghcr 上發佈好的 image（建議）

複製 `docker-compose.example.yml` 為 `docker-compose.yml`：

```bash
cp docker-compose.example.yml docker-compose.yml
docker compose up -d
```

該 compose 預設：
- 從 `ghcr.io/0miles/karyl-chan:latest` 拉 image
- 加入外部網路 `mc-network`（通常就是 Minecraft container 所在的 network）
- 加上 watchtower label 自動更新
- `restart: unless-stopped`

升級：
```bash
docker compose pull && docker compose up -d
```

## 首次啟動確認

1. 容器 log 出現 `Bot started`
2. 在 guild 打 `/` 能看到 bot 的指令清單
3. 若有設定 RCON 功能，`/rcon-forward-channel watch` 能開啟 modal
4. `/permission list` 能列出所有 capability

## 升級老舊部署

### 升級前沒有 `ENCRYPTION_KEY`

- 舊版本不需要此變數
- 加上變數後，現存的 RCON 密碼會被視為「legacy 明文」並在首次使用時印 warning
- 到該頻道執行 `/rcon-forward-channel edit` 重新輸入密碼即可完成加密升級

### 升級前沒有權限系統

- 啟動時 `sequelize.sync()` 自動建立 `CapabilityGrants` 表，**非破壞性**
- 預設所有 capability 為 allow（搭配 Discord `defaultMemberPermissions` 過濾）
- 不強制立即配置；需要收緊特定 role 才用 `/permission grant`

詳見 [運維手冊](operations.md#升級)。
