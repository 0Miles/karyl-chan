# 開發指南

## 環境需求

- Node.js 24（見 `package.json` engines，要求 >= 22）
- npm 10+
- 可執行 `sqlite3` 的系統（Windows / macOS / Linux 皆可；sqlite3 npm package 會自動編譯 native bindings）

## 快速上手

```bash
git clone https://github.com/0Miles/karyl-chan.git
cd karyl-chan
npm ci
cp .env.example .env
# 編輯 .env 填入 BOT_TOKEN 與（若要開發 RCON 功能）ENCRYPTION_KEY

npm run start   # nodemon + ts-node 開發模式，檔案變更自動 reload
```

## 可用 scripts

| Script | 用途 |
|---|---|
| `npm run build` | `tsc`，產生 `build/` 下的 JS（runtime 使用） |
| `npm run dev` | 以 `ts-node/esm/transpile-only` 執行 `src/main.ts`，無 watch |
| `npm run start` | `nodemon` watch 模式 |
| `npm run serve` | 執行已編譯的 `build/main.js`（生產用） |
| `npm test` | vitest 跑所有測試 |
| `npm run test:watch` | vitest watch 模式 |
| `npm run test:typecheck` | `tsc -p tsconfig.test.json --noEmit`，對 `tests/` 做型別檢查 |
| `npm run build:changelog` | 用 `@discordx/changelog` 掃 src 產生 changelog |

## 專案結構

```
src/
  commands/                    # Slash 指令 (@Discord @Slash)
    break.commands.ts
    manual.commands.ts
    permission.commands.ts
    picture-only-channel.commands.ts
    rcon-forward-channel.commands.ts
    role-emoji.commands.ts
    todo-channel.commands.ts
  events/                      # Discord 事件 handler (@Discord @On)
    picture-only-channel.events.ts
    rcon-forward-channel.events.ts
    role-emoji.events.ts
    todo-channel.events.ts
  models/                      # Sequelize 模型
    capability-grant.model.ts
    db.ts                      # sequelize instance
    picture-only-channel.model.ts
    rcon-forward-channel.model.ts
    role-emoji.model.ts
    role-receive-message.model.ts
    todo-channel.model.ts
    todo-message.model.ts
  permission/                  # 權限系統
    capabilities.ts            # capability 列舉 + 預設值
    permission.service.ts      # evaluateCapability 純函式 + DB 操作
    permission-check.ts        # requireCapability(interaction, cap) helper
  services/                    # 外部資源整合（RCON）
    rcon-connection.service.ts
    rcon-queue.service.ts
  types/
    rcon.d.ts                  # rcon 套件的型別補充
  utils/
    constant.ts                # embed 顏色等常數
    crypto.ts                  # AES-256-GCM helper
    host-policy.ts             # RCON host allowlist / blocklist
    rate-limiter.ts            # 頻道級速率限制
  web/                         # HTTP API (Fastify)
    server.ts                  # Fastify instance + routes
  main.ts                      # 入口；bot 啟動 + web server 並行

tests/                         # vitest 單元測試
  crypto.test.ts
  host-policy.test.ts
  permission.test.ts
  rate-limiter.test.ts

docs/                          # 本文件所在
.github/workflows/
  ci.yml                       # PR/push 跑 build + test + audit
  docker-publish.yml           # main push 跑 test 後 build/push ghcr image
```

## 程式風格

- TypeScript strict mode
- ESM modules（`"type": "module"`；import 路徑使用 `.js` 副檔名）
- Discordx 裝飾器：`@Discord @Slash @SlashGroup @On @ModalComponent`
- Sequelize v6 做 ORM，一個 model 一個檔案

### 命名慣例

- 檔名：`kebab-case.ts`
- 類別名：`PascalCase`
- 函式 / 變數：`camelCase`
- 常數：`SCREAMING_SNAKE_CASE`
- Capability 字串：`feature.action`（如 `todo.manage`、`rcon.execute`）

### 錯誤處理

- 外層 try/catch 捕捉所有 interaction 與 event handler 的錯誤，避免拖垮 process
- `main.ts` 註冊 `unhandledRejection` 與 `uncaughtException` handler 作為最後防線
- 對使用者的錯誤回覆使用 Ephemeral 訊息
- Console.error 寫入技術細節，Discord embed 僅展示使用者可讀的摘要

## 測試

### 單元測試範圍

目前覆蓋：
- `utils/crypto.ts`：加解密 roundtrip、legacy 明文 fallback、各種 malformed 輸入、key 驗證
- `utils/host-policy.ts`：格式驗證、IP blocklist、hostname blocklist、DNS 模擬、short-circuit
- `utils/rate-limiter.ts`：滑動視窗、每頻道隔離、手動與定時 cleanup
- `permission/permission.service.ts`：`evaluateCapability` 純函式所有分支、`EVERYONE_DEFAULTS` 完整性

### 尚未覆蓋（技術債）

- Command / event handler（耦合 discord.js 較深，整合測試需 mock Client）
- DB operations（需 `:memory:` SQLite 整合測試）
- RCON connection service（需 mock rcon 套件）

新增純邏輯時請寫對應測試；整合層的測試視需求再投入。

### 跑測試

```bash
npm test                       # 一次跑完
npm run test:watch             # watch mode，修改檔案自動 re-run
npm run test:typecheck         # 驗證 tests/ 型別
```

## 新增 capability

1. 在 `src/permission/capabilities.ts` 的 `CAPABILITIES` 物件加一個 key，以 `feature.action` 格式命名
2. 在 `EVERYONE_DEFAULTS` 加對應的 default 值（通常 `true`，除非該 capability 本身無 Discord 層過濾）
3. 在對應的 command 或 event handler 用 `requireCapability(interaction, 'new.cap')` 或 `hasCapability(guild, member, 'new.cap')`
4. 在 `tests/permission.test.ts` 補一個 case 驗證預設值
5. 更新 [docs/permissions.md](permissions.md) 的 capability 清單

## CI pipeline

見 [.github/workflows/](../.github/workflows/)：

| Workflow | 觸發 | 做什麼 |
|---|---|---|
| `ci.yml` | push to main / all PRs | `npm ci` → build → `test:typecheck` → `test` → `npm audit` (non-blocking) |
| `docker-publish.yml` | push to main | 先跑 `test` job，通過後 build docker image 推到 `ghcr.io/0miles/karyl-chan` |

`docker-publish` 的 `build-and-push` job 有 `needs: test`，測試失敗不會發 image。

### 分支策略

此 bot 目前主要由單人維護，常見模式：
- 直接在 `main` 工作
- 每個邏輯變更一個 commit，commit message 用 conventional commits 風格（`feat:`、`fix:`、`chore:`、`refactor:`、`test:`、`docs:` 等）
- 大型變動或外部協作可走 PR（CI 一樣會跑）

## 常見擴充任務

### 加新的 Slash 指令

1. 在 `src/commands/` 新一個 `my-feature.commands.ts`
2. `@Discord @SlashGroup @Slash` 裝飾器
3. 開頭呼叫 `requireCapability(command, 'my-feature.something')`
4. bot 啟動時 `importx` 自動載入

### 加新事件 handler

1. 在 `src/events/` 新一個 `my-feature.events.ts`
2. `@Discord @On()` 裝飾器
3. 同上，自動載入

### 加新 Sequelize model

1. 在 `src/models/` 新建 model file
2. 使用已匯入的 `sequelize` instance（來自 `db.ts`）
3. 任何被其他檔案 import 的 model，啟動時 `sequelize.sync()` 會自動建表

## 疑難排解（開發端）

### 啟動時 `Unhandled promise rejection: TokenInvalid`

`.env` 的 `BOT_TOKEN` 錯誤或已 revoke。

### `ts-node` 報 `Cannot use import statement outside a module`

確認 `package.json` 有 `"type": "module"`；執行用 `--loader ts-node/esm/transpile-only`（已寫在 `dev` / `start` script）。

### `sqlite3` 安裝失敗

需要編譯環境（Windows：VS Build Tools；Linux：`build-essential`）。替代：用 `docker compose` 開發。

### Vitest 找不到 `dns/promises`

`tsconfig.test.json` 已 `"types": ["node"]`；若自行魔改 tsconfig 請保留此項。
