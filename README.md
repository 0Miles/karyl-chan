# Karyl Chan
<img src="https://i.imgur.com/1YbH4xE.gif" width="180">

個人 Discord 輔助 bot，附帶在 guild 中提供 todo、圖片頻道、身分組 emoji、RCON 轉發等實用功能。

## 文件目錄

### 入門 / 運維
- [安裝與部署](docs/setup.md) — 環境需求、環境變數、本機開發、Docker 部署
- [運維手冊](docs/operations.md) — 資料庫備份、日誌、升級、常見問題

### 功能
- [Todo channel](docs/features/todo-channel.md) — 把頻道當待辦清單
- [Picture-only channel](docs/features/picture-only-channel.md) — 只允許圖片的頻道
- [Role emoji](docs/features/role-emoji.md) — 以 reaction 領取身分組
- [RCON forward channel](docs/features/rcon-forward-channel.md) — 把頻道訊息轉發到遊戲伺服器 RCON

### 權限
- [權限系統](docs/permissions.md) — 雙層模型、capability 清單、`/permission` 指令

### 開發
- [開發指南](docs/development.md) — build/test/CI、貢獻流程
- [架構指南](docs/architecture.md) — 模組劃分、依賴規則、新增 feature 的 SOP
- [Plugin 開發指南](docs/development/plugin-guide.md) — 寫外部 RPC plugin
