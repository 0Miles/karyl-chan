# 架構指南

## 為什麼這樣切

bot 同時是三件事:

1. **Discord client** — 接 gateway 事件、執行 slash commands
2. **HTTP API** — 給 admin web panel 用
3. **Plugin host** — 跟外部 plugin 進程做 RPC 互動

之前是按「層」分目錄(`commands/` / `events/` / `models/` / `services/` / `web/`),導致「新增一個功能」要動 7 個檔散在 5 個目錄。現在改按「**業務概念**」切模組,每個模組自包含。

> 設計哲學:**vertical slicing(by feature)優先,horizontal slicing(by layer)次之**。同一個概念的所有面向(Discord events、slash commands、HTTP routes、DB model)住在一起;同類型的東西(都是 routes、都是 models)散在不同模組沒關係。

---

## 目錄全景

```
src/
├── db.ts                       # Sequelize singleton(全模組共用)
├── main.ts                     # 入口
├── bootstrap-events.ts         # 集中註冊所有 Discord events
├── bootstrap-in-process.ts     # 集中註冊所有 in-process slash commands
├── migrations/                 # Umzug-driven schema migrations(時間線扁平,不分模組)
├── types/                      # ambient declarations(rcon.d.ts)
├── utils/                      # 純函式工具(crypto / rate-limiter / host-policy / constant)
└── modules/                    # 業務模組(9 個)
    ├── plugin-system/          # 外部 RPC plugin 生命週期
    ├── behavior/               # DM 觸發轉發(system/webhook/plugin 三型)
    ├── builtin-features/       # in-process Discord 功能(4 個子模組)
    │   ├── picture-only/
    │   ├── role-emoji/
    │   ├── todo-channel/
    │   ├── rcon-forward/
    │   └── in-process-command-registry.service.ts  # 4 個共用註冊器
    ├── feature-toggle/         # 兩條軌道統一開關狀態層
    ├── admin/                  # 管理員身份、登入、capability、審計
    ├── dm-inbox/               # DM 收件匣 + SSE 推播
    ├── guild-management/       # Discord guild 管理 web API
    ├── bot-events/             # bot 事件日誌(voice 進出 / 結構化錯誤紀錄)
    └── web-core/               # Fastify 基礎設施 + bot-wide meta endpoints
```

---

## 9 個模組職責

### `modules/plugin-system/` — 外部 RPC plugin

**做什麼**:plugin 是**獨立進程**,bot 透過 HTTP RPC + HMAC 共享金鑰跟它通訊。本模組負責 plugin 註冊、心跳、token 管理、事件派送、command 同步、interaction 路由、bot↔plugin 雙向 RPC。

**關鍵檔案**:
- `plugin-registry.service.ts` — manifest 驗證、token 兩段式握手、heartbeat reaper(75s 超時)
- `plugin-event-bridge.service.ts` — `eventType → Set<pluginId>` 索引 + dispatch
- `plugin-command-registry.service.ts` — manifest commands → Discord application commands
- `plugin-interaction-dispatch.service.ts` — Discord interaction → POST 到 plugin
- `plugin-dispatch.service.ts` — DM behavior 派送(plugin behavior 用)
- `plugin-auth.service.ts` — in-memory token hash 快取
- `plugin-routes.ts` — `/api/plugins/*`(register / heartbeat / admin)
- `plugin-rpc-routes.ts` — `/api/plugin/*`(plugin → bot RPC,kv/config/discord actions)
- `models/`:plugin / plugin-kv / plugin-command / plugin-config

**對外介面**:HTTP `/api/plugins/*` 與 `/api/plugin/*`、`pluginRegistry`、`dispatchEventToPlugins`、`dispatchPluginBehavior`

**依賴**:web-core(route-guards / validators)、behavior(webhook-dispatch.service 共用 HMAC 工具)、feature-toggle(plugin-guild-feature 開關狀態)

---

### `modules/behavior/` — DM 觸發轉發三型

**做什麼**:Behavior = 「DM 訊息或 slash 指令觸發,轉發到某個目的地」的規則。三種 type(`system` / `webhook` / `plugin`)共用一張 `behaviors` 表,差別只在 dispatch 方式。

**關鍵檔案**:
- `behavior-routes.ts` + `target-routes.ts` + `group-member-routes.ts` — Web API CRUD(13 endpoints,按段拆三檔)
- `behavior-helpers.ts` — 8 個共用 helper(fetchProfile / decryptedView / requireBehaviorTarget 等)+ `createResyncSlash(bot)` factory
- `system-behavior.service.ts` — 內建 system behaviors(login/manual/break)bootstrap
- `user-slash-behavior.service.ts` — slash_command type 的觸發 dispatch
- `dm-slash-rebind.service.ts` — DM-only globals 的 Discord application command 同步
- `webhook-dispatch.service.ts` — webhook POST + HMAC 簽名/驗證 + `[BEHAVIOR:END]` 偵測(也被 plugin-system reuse)
- `behavior-trigger.ts` — 純函式 `matchesTrigger` / `describeTrigger`
- `events/webhook-behavior.events.ts` — messageCreate trigger 評估
- `models/`:behavior / behavior-session / behavior-target / behavior-target-member

**對外介面**:HTTP `/api/behaviors/*` 與 `/api/behaviors/targets/*`、`webhookDispatch`、`BEHAVIOR_END_TOKEN`

**依賴**:web-core、admin、plugin-system(派 plugin behavior 時)、feature-toggle(間接)

---

### `modules/builtin-features/` — in-process Discord 功能

**做什麼**:4 個 bot 自己內建的 Discord 功能,每個一個資料夾,內含完整實作(commands + events + models + routes + helpers)。共用一個註冊器(`in-process-command-registry.service.ts`)集中管理 slash command + modal 路由。

**4 個子模組**:
| 子模組 | 做什麼 |
|--------|--------|
| `picture-only/` | 標記頻道,只允許 attachment / embed 訊息,文字訊息自動刪 |
| `role-emoji/` | 在指定訊息加 reaction → 自動授/撤 role(含 group 與 role-receive message 概念) |
| `todo-channel/` | 標記頻道為「待辦清單」,訊息可勾選/取消 |
| `rcon-forward/` | 訊息 → RCON command 轉發(Minecraft 等遊戲伺服器 console)|

**每個子模組標準結構**:
```
{name}/
├── {name}.commands.ts      # Slash command + modal handlers
├── {name}.events.ts        # Discord event listeners
├── {name}.model.ts         # Sequelize model(可能多檔)
├── routes.ts               # Web API CRUD
└── *helpers.ts             # 該 feature 的工具(可選)
```

**對外介面**:Discord slash commands、Discord event reactions、`/api/guilds/:guildId/feature/{name}*`

**依賴**:web-core、feature-toggle(check is feature enabled)、guild-management(只 import `GuildManagementRoutesOptions` type)

---

### `modules/feature-toggle/` — 兩條軌道統一開關狀態層

**做什麼**:**只管「誰被開了什麼」,不管「功能本身怎麼運作」**。涵蓋兩條軌道:
- **Plugin guild_features** — plugin 外部進程的 per-guild 子功能 (`plugin-guild-feature.model`)
- **Built-in features** — bot 內建 4 個功能的 per-guild 開關 (`bot-feature-state.model`)

優先級鏈(plugin features):per-guild state > operator default > manifest `enabled_by_default` > false

**關鍵檔案**:
- `bot-feature-routes.ts` — built-in feature toggle CRUD
- `models/`:plugin-guild-feature / plugin-feature-default / bot-feature-state

**plugin features 的 toggle 路由**留在 `plugin-system/plugin-routes.ts`(因為跟 plugin admin 緊密耦合,不拆過來)

**對外介面**:HTTP `/api/bot-features/state/*`、各 model

**依賴**:web-core、admin

---

### `modules/admin/` — 管理員身份系統

**做什麼**:admin = 「Discord 用戶被授權後可登入 web 後台」。本模組管理員生命週期、登入、permission capabilities、審計日誌(含 hash chain)。

**關鍵檔案**:
- `admin-login.service.ts` — Discord OAuth-style 登入 service
- `admin-management-routes.ts` — admin 管理 CRUD
- `admin-login-status-routes.ts` — login session 狀態
- `admin-audit.service.ts` — audit log 寫入 + canonical payload + hash chain
- `authorized-user.service.ts` — Discord user → admin 對應
- `admin-capabilities.ts` — capability 列舉 + `requireCapability` / `requireGuildCapability` helpers
- `models/`:admin-audit-log / admin-role / admin-role-capability / authorized-user

**對外介面**:HTTP `/api/admin/*` `/api/auth/*`、`requireCapability` / `requireGuildCapability`(被 web-core/route-guards 用)、`recordAudit`

**依賴**:web-core、bot-events(寫 bot-event log)

---

### `modules/dm-inbox/` — DM 收件匣

**做什麼**:bot 收到 DM → 顯示在 admin web panel 的「收件匣」 → admin 直接從 panel 回覆。同時提供 SSE 即時推播。

**關鍵檔案**:
- `dm-routes.ts` — `/api/dm/*` 列表/查詢/送出/SSE
- `dm-inbox.service.ts` — DM 訊息儲存與檢索
- `dm-event-bus.ts` — SSE event bus(in-memory pub/sub)
- `events/dm-inbox.events.ts` — Discord messageCreate(DM 過濾)→ store + push
- `events/typing-start.events.ts` — Discord typingStart → SSE(同時推 DM 和 guild 兩種 bus)
- `models/dm-channel.model.ts`

**對外介面**:HTTP `/api/dm/*`、`dmInbox` service、`dmEventBus` SSE

**依賴**:web-core、admin、guild-management(typing-start 跨 bus)、bot-events(寫 log)

---

### `modules/guild-management/` — Discord guild 管理

**做什麼**:admin 從 web panel 對 Discord guild 做管理(列出 guilds / 看 channels / 改 roles / 改 settings / 看 messages / automod 規則等)。

**關鍵檔案**:
- `guild-management-routes.ts` — facade,把所有 sub-routes register 起來(含 4 個 builtin-features routes)
- `guilds-routes.ts` — guild list / detail
- `guild-member-routes.ts` / `guild-message-routes.ts` / `guild-role-routes.ts` / `guild-settings-routes.ts` / `guild-automod-routes.ts` / `guild-channel-routes.ts` / `guild-channel-mgmt-routes.ts`
- `guild-management-shared.ts` — 共用 helper(`parseRoleBody`、`GuildManagementRoutesOptions`)
- `guild-channel-event-bus.ts` — guild 頻道事件 SSE bus
- `events/guild-channel.events.ts` — Discord guild events → SSE

**對外介面**:HTTP `/api/guilds/*`、`guildChannelEventBus`、`GuildManagementRoutesOptions`

**依賴**:web-core、admin、builtin-features(facade 註冊它們的 routes)

---

### `modules/bot-events/` — bot 事件日誌

**做什麼**:結構化的 bot 行為日誌 — voice 進出、各種 warn/error、admin 行為(透過 admin-audit 串接)。讓 admin 在 web panel 看到 bot 在發生什麼。

**關鍵檔案**:
- `bot-event-routes.ts` — `/api/bot-events/*` 查詢
- `bot-event-log.ts` — `botEventLog(...)` fire-and-forget 寫入(DB 失敗不影響呼叫方)
- `bot-event-dedup.ts` — `shouldRecord(key, ttl)` in-memory 去重
- `events/voice-state.events.ts` — Discord voiceStateUpdate → log
- `models/bot-event.model.ts`

**對外介面**:HTTP `/api/bot-events/*`、`botEventLog` / `shouldRecord`

**依賴**:web-core

---

### `modules/web-core/` — Fastify 基礎設施 + bot-wide meta

**做什麼**:HTTP 層的基礎設施(server 啟動、JWT、token store、route-guards、共用 DTO)+ 跨業務的 meta routes(健康檢查、Discord lookup)。

**關鍵檔案**:
- `server.ts` — Fastify entry,**所有 module routes 的中央 register 點**
- `jwt.service.ts` — JWT 簽發/驗證
- `auth-store.service.ts` — token storage 抽象
- `refresh-token.repository.ts` + `models/refresh-token.model.ts` — refresh token 儲存
- `route-guards.ts` — `requireAnyCapability` / `requireGuildCapability` 等中介
- `validators.ts` — `isSnowflake` / `isBoundedString` 等純函式
- `message-mapper.ts` + `message-types.ts` — Discord message → API DTO
- `system-routes.ts` — `/api/system/health` / `/api/bot/status`
- `discord-routes.ts` — `/api/discord/*` 跨 guild 的 Discord 資源 lookup(emojis / users / stickers / channels)

**對外介面**:`startWebServer`、`requireCapability` 系列 guards、`isSnowflake` 系列 validators、`toApiMessage` mapper

**依賴**:admin(route-guards 用 capability)、其他模組(server.ts 註冊它們的 routes)

---

## 依賴規則

### 允許

```
任何模組 → web-core / utils / db.ts        ✓
admin → bot-events                          ✓ (admin 行為要寫 log)
behavior → admin                            ✓ (audit + capability)
plugin-system → behavior(共用 webhook-dispatch) ✓
plugin-system → feature-toggle              ✓
guild-management → builtin-features         ✓ (facade)
builtin-features → guild-management         ✓ (只 import type)
builtin-features → feature-toggle           ✓ (check toggle)
builtin-features → bot-events               ✓ (log)
dm-inbox → admin / guild-management         ✓
```

### 禁止

```
web-core → 任何業務模組(plugin-system / behavior / builtin-features 等)
   理由:web-core 是基礎設施層,被任何模組依賴。它依賴業務模組會形成循環。
   例外:server.ts 是 entry point,可以 import 所有 routes 來 register。

業務模組之間循環依賴
   例如 builtin-features 不該 import dm-inbox,反之亦然。
   guild-management 跟 builtin-features 互相 import 是已知張力(facade 設計使然),
   builtin-features 只 import type,沒 runtime 邊。

新模組憑空建立
   每加一個 modules/X/ 都要先回答:這個 X 是什麼層次的概念?
   它對應的 src/web/ 來源是什麼?它的依賴方是誰?
```

### import path 規則

- ESM + NodeNext,所有相對 import **必須帶 `.js` 副檔名**
- 同模組內部:`./Y.js` 或 `./subdir/Y.js`
- 跨模組(同層):`../<other-module>/Y.js`
- 跨模組(子目錄):`../../<other-module>/Y.js`
- 跨模組到 utils / db / types:`../../utils/Y.js` / `../../db.js` / `../../types/Y.js`(層數依模組深度調整)
- migrations:`./runner.js`(同層)、`../db.js`(上一層)

---

## 共用層

| 位置 | 內容 | 規則 |
|------|------|------|
| `src/db.ts` | Sequelize singleton | 全模組共用,直接 import |
| `src/utils/` | 純函式工具(crypto/rate-limiter/host-policy/constant) | **不依賴任何業務模組**,任何模組都可 import |
| `src/types/` | ambient `.d.ts` declarations | tsconfig include 自動生效,不需 import |
| `src/migrations/` | Sequelize-Umzug migrations | 時間線扁平,不分模組;import `../db.js` 取 sequelize |
| `src/bootstrap-events.ts` | Discord events 集中註冊 | 所有 modules 的 `events/X.events.ts` 在這裡被 import 並 wire 到 bot client |
| `src/bootstrap-in-process.ts` | in-process slash commands 集中註冊 | 同上,模式跟 events 對稱 |
| `src/main.ts` | 入口 — bot 啟動、DB sync、migrations、register、startWebServer | 不要往這檔案塞業務邏輯,純 wiring |

---

## 新增 feature 決策樹

要加新東西時,先回答兩個問題:

### Q1:這是什麼性質的功能?

```
是 admin web panel 上的「設定/管理」操作?       → 看 Q2
是 Discord 使用者操作觸發的 bot 行為?           → 看 Q2
是 plugin 進程做的事(獨立 binary)?              → 改 plugin manifest,bot 端不動
是「跨業務的 utility / Discord lookup」?        → 進 web-core/discord-routes 或 system-routes
是「pure function 工具」?                       → 進 src/utils/
```

### Q2:屬於哪個現有模組?

| 想做的事 | 進哪個模組 |
|----------|-----------|
| 新一種 DM 觸發 → 轉發 type | `behavior/`(可能要動 trigger 評估邏輯) |
| 新一種 in-process Discord feature(類似 picture-only) | `builtin-features/<new-name>/` 整個資料夾(複製其中一個改) |
| 新一種 plugin guild_feature 開關行為 | `feature-toggle/` 加邏輯 |
| 新 admin 管理介面 | `admin/` 加 service + routes |
| 新 DM inbox 功能 | `dm-inbox/` |
| 新 guild 管理 endpoint | `guild-management/` 內找對應 routes 檔加 |
| 新 bot 事件種類要寫 log | `bot-events/` 加 category |

如果**沒有任何現有模組能裝**,才考慮新模組。新模組要走 P9 / 跟團隊 review,不該憑感覺加。

---

## 加新 builtin feature(完整 SOP)

假設要加一個 `slow-mode-channel` feature(類似 picture-only,但是限制發言頻率):

```
1. 建立 src/modules/builtin-features/slow-mode/ 資料夾
2. 複製 picture-only/ 的四個檔案做骨架:
   - slow-mode.commands.ts        # /slow-mode set / unset
   - slow-mode.events.ts          # messageCreate handler
   - slow-mode.model.ts           # SlowModeChannel(channelId, guildId, intervalMs)
   - routes.ts                    # GET/POST/DELETE /api/guilds/:guildId/feature/slow-mode-channels
3. src/modules/feature-toggle/models/bot-feature-state.model.ts:
   把 "slow-mode" 加到 BUILTIN_FEATURE_KEYS
4. src/bootstrap-events.ts 加 register 呼叫
5. src/bootstrap-in-process.ts 加 register 呼叫
6. src/modules/guild-management/guild-management-routes.ts:
   加 registerSlowModeRoutes 進 facade
7. 寫 migration 在 src/migrations/<timestamp>-slow-mode-channel.ts
8. 寫測試在 tests/ 內(命名隨意,通常 <feature>-routes.test.ts 或 .events.test.ts)
9. 跑 npm run build / npm test / docker compose build 確認綠
```

注意 **新增 feature 動的位置** = 一個新資料夾 + 5 個既有 wiring 點(bootstrap × 2、feature-toggle key、guild-management facade、migration)。重構前需要動 7 個位置散在 5 個目錄,現在收斂到 6 處。

---

## 加新 web API endpoint(到既有模組)

```
1. 進對應 module 的對應 routes 檔加 server.<method>(...)
2. 用 web-core 提供的 guard:requireCapability(...) 或 requireGuildCapability(...)
3. validate 用 web-core/validators.ts 的 helpers(isSnowflake / isBoundedString...)
4. 對 admin 操作要 await recordAudit(...)(來自 admin/admin-audit.service)
5. 直接呼叫 module 內的 service / model
6. 跑 build + test
```

---

## 加新 Discord event handler

```
1. 決定屬於哪個 module(看 event 的語義)
   - voice 相關 → bot-events/events/
   - DM 相關 → dm-inbox/events/
   - guild 頻道相關 → guild-management/events/
   - feature 相關 → builtin-features/<feature>/<feature>.events.ts
2. 函式簽章:export function registerXxxEvents(bot: Client): void
3. 在 src/bootstrap-events.ts 加 register 呼叫
4. 內部:bot.on(Events.XYZ, async (...) => { try {...} catch (err) {...} })
   外層 try/catch 必須有 — bot 進程不能因為一個 event handler 拋例外掛掉
```

---

## 加新 Sequelize model

```
1. 進對應 module 的 models/ 資料夾(沒有就建)
2. import { sequelize } from "../../../db.js";  ← 注意層數依模組深度
3. export const X = sequelize.define("X", {...}, {...});
4. 主 register / service 內 import 一次 → sequelize.sync() 自動建表(開發環境)
   生產環境:寫 migration 在 src/migrations/
5. 不要 export raw sequelize — 操作都走 model methods 或 service
```

---

## 加 schema migration

```
1. 在 src/migrations/ 新一個 <YYYYMMDDHHMMSS>-<verb>-<table>.ts
2. 模板:
   import type { Migration } from "./runner.js";
   import { DataTypes, QueryTypes } from "sequelize";

   const migration: Migration = {
     up: async ({ queryInterface, sequelize }) => { ... },
     down: async ({ queryInterface }) => { ... },
   };
   export default migration;
3. up/down 用 queryInterface API,不要直接呼叫 model(model 跟 schema 漂移時 migration 會 break)
4. 任何資料層改動先想清楚:有沒有 NOT NULL 加新欄?有沒有舊資料 backfill?有沒有 index?有沒有正向 + 反向都能跑的 idempotent 條件(`if (!columns.X) await addColumn(...)`)
5. migration 名字含「主操作」,讓 git log 一眼看懂
```

---

## 已知張力與取捨

### 1. builtin-features 內 bot 端與 web 端混雜

每個 `builtin-features/<name>/` 同時放 commands(bot 端)、events(bot 端)、routes(web 端)、model(共用)。從「分層清晰」角度看混了 bot client 跟 Fastify。

**為什麼接受**:同一個 feature 的所有面向住一起,修 bug 時通常 events + routes 一起改,vertical slicing 比 layered 收益高。如果未來某個 feature 變得很複雜,**可以**在它資料夾內再分 `bot/` + `web/` 子目錄(純 mv,風險低)。目前 4 個 features 都不夠複雜到值得分。

### 2. `webhook-dispatch.service.ts` 住在 behavior/,但被 plugin-system 大量 import

它本質是「behavior 子系統的 HTTP/HMAC 工具」(含 `BEHAVIOR_END_TOKEN` 常數),plugin-system 的 plugin-dispatch 是消費者。這條 cross-module 依賴是合理的(plugin = behavior 的 plugin 版本)。

### 3. `guild-management-shared.ts` 內的 `GuildManagementRoutesOptions` 被 4 個 builtin-features routes import

這形成 builtin-features → guild-management 的 type 依賴。為了讓 4 個 builtin routes 能用 guild facade 的統一 options 介面,這是不得不的耦合。**只 import type,沒 runtime 邊**,這樣可控。

### 4. `in-process-command-registry.service.ts` 住在 `builtin-features/` 根目錄

它是「集中註冊器」,被 4 個子 feature 共用。放 `builtin-features/` 根目錄,跟「每 feature 一資料夾」並列。這個位置承認它是 builtin-features 模組內的「跨子模組共用」。

### 5. `plugin-routes.ts` 內含 plugin-guild-feature toggle endpoints

從職責看 toggle 應該歸 feature-toggle 模組。但 plugin guild feature toggle 跟 plugin admin 路由(register / heartbeat / metrics)邏輯緊密糾纏,拆過來會把 plugin-routes 切兩半。**取捨:接受職責輕度溢出,換 plugin-routes 完整性**。

### 6. `behavior-routes.ts` 711 行 + 三個 sub-routes

雖然按段拆了(targets / group-members / behaviors),但 behaviors 段內的 POST `/api/behaviors` 一個 handler 就 219 行。**這是 internal style 議題,不影響架構**。如果未來想抽 service 層讓路由變薄,獨立議題另開。

### 7. tests/ 是扁平的(沒按 module 結構鏡像)

跟 src/ 對不上。**取捨:tests 扁平讓測試的 import 都從 `../src/...` 出發,規則簡單**。如果未來測試多到看不下去再考慮分子目錄。

---

## 重構之前 vs 之後對照

| | 之前 | 現在 |
|---|------|------|
| src/ 子目錄 | commands/ events/ models/ services/ web/ permission/ utils/ types/ migrations/ | db.ts main.ts bootstrap-events.ts bootstrap-in-process.ts modules/ utils/ types/ migrations/ |
| 加新 feature 要動 | 7 處,5 個目錄 | 1 個資料夾 + 5 個 wiring 點 |
| 「behavior 是什麼」要看 | 4 個目錄 | 1 個 modules/behavior/ 資料夾 |
| 「web」目錄裡有什麼 | 35 個檔(混 routes/services/event-bus/infra) | **不存在**(全部分到模組內,基礎設施進 web-core) |
| 跨層循環風險 | 中(commands import services import models 容易繞回來) | 低(模組邊界明確,有依賴規則) |

---

## 一份「不要破壞」清單

下次重構 / 大改時請守住:

1. **不要把 routes 全集中到一個 web/ 目錄** — 那會回到重構前
2. **不要把 model 全集中到一個 models/ 目錄** — 同上
3. **不要在 modules/ 之外建新業務模組** — 新模組進 modules/,不要建 services/x/ 之類混合命名
4. **不要讓 web-core/ 依賴業務模組** — 它是基礎設施,被任何人依賴。例外只有 server.ts 集中 register 各 routes
5. **不要繞過 bootstrap-events / bootstrap-in-process** — Discord events 與 in-process commands 必須走這兩個集中點,不要散註冊。集中點是給 「啟動順序可讀性」 的
6. **不要在 src/ 根目錄加新檔案** — 除非是 entry-level(類似 db.ts / main.ts / bootstrap-*),其他通通進 modules/ 或 utils/
7. **不要把 import 路徑改成不帶 `.js`** — ESM NodeNext 規範,執行時會 break

---

## 進一步閱讀

- `docs/development.md` — 開發環境、scripts、CI
- `docs/permissions.md` — capability 系統
- `docs/development/plugin-guide.md` — plugin 開發完整指南
- `docs/features/*.md` — 各 builtin feature 與 webhook-behavior 設計細節
- `docs/operations.md` — 部署、env、健康檢查
