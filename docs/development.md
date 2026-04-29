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

完整架構說明見 [docs/architecture.md](architecture.md)。下面只列頂層輪廓:

```
src/
  db.ts                        # Sequelize singleton(全模組共用)
  main.ts                      # 入口
  bootstrap-events.ts          # 集中註冊 Discord events
  bootstrap-in-process.ts      # 集中註冊 in-process slash commands
  migrations/                  # Umzug schema migrations(時間線扁平)
  types/                       # ambient declarations
  utils/                       # 純函式工具(crypto/rate-limiter/host-policy/constant)
  modules/                     # 9 個業務模組
    plugin-system/             # 外部 RPC plugin 生命週期
    behavior/                  # DM 觸發轉發三型
    builtin-features/          # in-process Discord 功能(picture-only/role-emoji/todo/rcon)
    feature-toggle/            # 功能開關狀態層(plugin + builtin 兩條軌道)
    admin/                     # 管理員身份、登入、capability、審計
    dm-inbox/                  # DM 收件匣 + SSE
    guild-management/          # Discord guild 管理 web API
    bot-events/                # bot 事件日誌
    web-core/                  # Fastify 基礎設施 + bot-wide meta endpoints

tests/                         # vitest 單元測試(扁平)
docs/                          # 本文件所在
.github/workflows/
  ci.yml                       # PR/push 跑 build + test + audit
  docker-publish.yml           # main push 跑 test 後 build/push ghcr image
```

**新增 feature / endpoint / event handler / model 的標準流程**見 [docs/architecture.md](architecture.md) 的「新增 feature 決策樹」與「加新 builtin feature(完整 SOP)」段。

## 程式風格

- TypeScript strict mode
- ESM modules（`"type": "module"`；import 路徑使用 `.js` 副檔名）
- 顯式 register pattern（無裝飾器）：每個 events/commands 檔 export `register*` 函式，由 `bootstrap-events.ts` / `bootstrap-in-process.ts` 集中 wire 到 client
- Sequelize v6 做 ORM，一個 model 一個檔案
- 模組邊界規則見 [architecture.md](architecture.md)「依賴規則」段

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

1. 在 `src/modules/admin/admin-capabilities.ts` 的 `CAPABILITIES` 加一個 key，以 `feature.action` 格式命名
2. 在 `EVERYONE_DEFAULTS` 加對應的 default 值
3. 在對應的 route 或 event handler 用 `requireCapability(...)` 或 `requireGuildCapability(...)`（從 `web-core/route-guards.js` import）
4. 在 `tests/admin-capabilities.test.ts` 補一個 case 驗證預設值
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

詳細 SOP 見 [architecture.md](architecture.md)。簡略提示:

- **加新 Slash 指令**:進對應 module(builtin-features 內某個子 feature 或 behavior),寫 `register*Commands` 函式 → 在 `bootstrap-in-process.ts` 加 register 呼叫
- **加新事件 handler**:進對應 module 的 `events/`,寫 `register*Events(bot)` 函式 → 在 `bootstrap-events.ts` 加 register 呼叫
- **加新 Sequelize model**:進對應 module 的 `models/`,`import { sequelize } from "../../../db.js"`(層數依模組深度)
- **加新 web API endpoint**:進對應 module 的 routes 檔,用 web-core 提供的 `requireCapability`/`isSnowflake` helpers,admin 操作別忘 `recordAudit(...)`
- **加新 builtin feature(完整資料夾)**:見 architecture.md 的 SOP — 預期動 1 個新資料夾 + 5 個既有 wiring 點(2 個 bootstrap + feature-toggle key + guild-management facade + migration)

## 疑難排解（開發端）

### 啟動時 `Unhandled promise rejection: TokenInvalid`

`.env` 的 `BOT_TOKEN` 錯誤或已 revoke。

### `ts-node` 報 `Cannot use import statement outside a module`

確認 `package.json` 有 `"type": "module"`；執行用 `--loader ts-node/esm/transpile-only`（已寫在 `dev` / `start` script）。

### `sqlite3` 安裝失敗

需要編譯環境（Windows：VS Build Tools；Linux：`build-essential`）。替代：用 `docker compose` 開發。

### Vitest 找不到 `dns/promises`

`tsconfig.test.json` 已 `"types": ["node"]`；若自行魔改 tsconfig 請保留此項。
