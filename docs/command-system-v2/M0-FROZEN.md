# M0 設計凍結 — karyl-chan 指令架構 v2

> **狀態**：M0 階段已完成，設計已凍結。本文件是給 M1 各並行子任務的單一 source of truth。
> **整合時間**：2026-05-06（v2，含 critic 交叉審查修正 + 用戶設計覆寫）
> **子文件**：[A-schema](./m0/A-schema.md) · [B-sdk](./m0/B-sdk.md) · [C-runtime](./m0/C-runtime.md) · [D-ui](./m0/D-ui.md)

---

## 0. 凍結摘要

karyl-chan 指令架構 v2 在 M0 階段拆成三軌：

| 軌 | 定位 | 三軸控制 | M0 範圍 |
|---|---|---|---|
| **軌一：Guild Feature** | scope=guild + GUILD_INSTALL + Guild context 鎖死的功能模組 | 寫死 | **完全不動**（內建 5 個 + plugin manifest `guild_features[]` 維持） |
| **軌二：Behaviors** | webhook 接口層；source ∈ {custom, plugin, system} | admin 可控（system 寫死） | **破壞性重構** |
| **軌三：Plugin 自訂指令** | plugin manifest 鎖三軸；admin 只能 on/off | plugin manifest 寫死 | **新增** |

接口形式 ↔ 控制權**綁定**（用戶確認）：
- Discord webhook 相容介面 → admin 可動三軸 → 走軌二
- plugin RPC 介面 → plugin 鎖死三軸 → 走軌三

---

## 1. 命名共識（鎖死，M1 全子任務沿用）

### 1.1 列舉值

| 概念 | 鎖定值 |
|---|---|
| `source` | **`'custom'`** / `'plugin'` / `'system'` ← admin 自建 source 名稱為 `custom`（用戶覆寫，原 `'admin'` 不再使用） |
| `triggerType` | `'slash_command'` / `'message_pattern'` |
| `messagePatternKind` | `'startswith'` / `'endswith'` / `'regex'` |
| `scope` | `'global'` / `'guild'` ← Discord 指令註冊作用域，**不是 audience** |
| `audienceKind` | `'all'` / `'user'` / `'group'` ← behavior 對象篩選，**與 scope 完全分離** |
| `integrationTypes` 元素 | `'guild_install'` / `'user_install'` |
| `contexts` 元素 | `'Guild'` / `'BotDM'` / `'PrivateChannel'` |
| `systemKey` | `'admin-login'` / `'manual'` / `'break'` |
| `webhookAuthMode` | `'token'` / `'hmac'` / NULL（CR-6 新增） |

### 1.2 schema_version

manifest `schema_version: "2"`（字串，破壞性升級，v1 一律拒絕，無自動轉換）。

### 1.3 表名

| 新表名 | 用途 |
|---|---|
| `behaviors_v2` → rename 為 `behaviors`（rebuild pattern） | 軌二完整重設 |
| `behavior_audience_members` | 取代 `behavior_target_members`，FK 直接到 `behaviors.id` |
| `behavior_sessions_v2` → rename 為 `behavior_sessions` | continuous session 保留，FK 重連 |
| `_archive_behaviors` / `_archive_behavior_targets` / `_archive_behavior_target_members` | 30 天觀察 |
| `plugin_commands` | **不改名**，擴 8 欄；`featureKey IS NULL` 為軌三、`IS NOT NULL` 為軌一 |
| `reconciler_owned_commands` | 新增（CR-7），CommandReconciler 管理名冊；M1-A 第 6 個 migration 檔 |

### 1.4 欄位儲存格式

- 三軸 `integrationTypes` / `contexts`：**lexicographically-sorted comma-joined string**（不是 JSON），例 `"BotDM,PrivateChannel"`、`"guild_install,user_install"`。應用層強制 sort+dedup 後寫入。
- `scope`：單值字串。
- `messagePatternConfig`：拆兩欄 `messagePatternKind` + `messagePatternValue`，不用 JSON。

---

## 2. 跨子任務衝突解決決議

### CR-1：Plugin behavior URL 來源
- 三方一致採「動態組合 `{plugin.url}{webhook_path}`」── plugin 離線即失敗（fail-fast），不快取備援。

### CR-2：HMAC 簽署兩 mode 並存
- **預設模式**（`webhookAuthMode='token'`）：bot 帶 `X-Plugin-Webhook-Token: <secret>` 純 shared secret，與 native channel webhook 相容
- **進階模式**（`webhookAuthMode='hmac'`）：走 `X-Karyl-Signature` + `X-Karyl-Signature-V1` 雙簽，沿用既有 admin behavior HMAC 路徑
- **無模式**（`webhookAuthMode=NULL`）：不簽、無 token，純裸 webhook
- admin/behaviors UI 在 webhookSecret 欄位旁加 mode 選項

### CR-3：plugin 詳情頁 6 tab 重命名
- v1 詞彙「DM Behaviors」改為「Behaviors」（軌二）
- 新增獨立「指令」tab（軌三）
- 6 tab：總覽 / Behaviors / 指令 / Guild Features / Scopes / 安全設定

### CR-4：assertNoCollisions reserved set
- `admin-login / manual / break` **不在** plugin command reserved set
- 但 assertNoCollisions 應額外查 `behaviors WHERE triggerType='slash_command' AND enabled=1` 的 `slashCommandName`，避免 plugin command 與 behavior slash trigger 名稱碰撞

### CR-5（已併入 CR-7）
原 reconciler_owned_commands 表決議，併入 CR-7 統一處理。

### CR-6（新增，由 critic C-1 觸發）：webhookSecret 跨 source 與 webhookAuthMode 欄位

**問題**：原 A 文件 §I-2 CHECK 寫死 `source='plugin' → webhookSecret IS NULL`，與 CR-2「admin 可給 plugin behavior 設 webhookSecret」直接衝突。CR-2 形同空頭支票。

**決議**（覆寫 A §D-5 / §I-2）：

```
新 I-2 規則：
  source='custom'  ↔ webhookUrl NOT NULL；pluginId/systemKey/pluginBehaviorKey NULL
  source='plugin'  ↔ pluginId NOT NULL AND pluginBehaviorKey NOT NULL；
                     webhookUrl NULL；systemKey NULL；
                     webhookSecret 可選（NULL 或 NOT NULL 都合法）
  source='system'  ↔ systemKey NOT NULL；
                     webhookUrl/webhookSecret/pluginId/pluginBehaviorKey 全 NULL

新欄位 webhookAuthMode TEXT NULL CHECK IN ('token','hmac'):
  - webhookSecret IS NULL → webhookAuthMode 必須 NULL
  - webhookSecret IS NOT NULL → webhookAuthMode 必須是 'token' 或 'hmac'
  - source='system' → webhookAuthMode 必須 NULL
```

**M1-A 必落到 §1.2 DDL**（不能延後，不算 OQ）。

### CR-7（新增，由 critic C-3/C-4/C-5/H-5 觸發）：M1-A migration 完整化

**M1-A 必須落實的修正清單**（A 文件當前版本不足以支撐 M1 啟動）：

1. **legacyId 欄位**（C-3）：`behaviors_v2` DDL 加 `legacyId INTEGER NULL UNIQUE`；case 1/2/3/4 backfill 都需寫入 `OLD.id`；migration 排程加第 6 步「DROP COLUMN legacyId」（SQLite 需 rebuild）
2. **behavior_sessions FK 順序**（C-4）：case 7 INSERT 必須在 step 5 rename 完成後執行；migration 排程順序為：rebuild behaviors → rename → INSERT behavior_sessions_v2 → rename sessions
3. **reconciler_owned_commands 表**（H-5）：M1-A 第 6 個 migration 檔 `20260501060000-reconciler-owned-commands.ts`，欄位 `(name TEXT, scope TEXT, guildId TEXT NULL, ownedAt DATETIME)`，UNIQUE(name, scope, guildId)
4. **依賴拓撲修正**（C-5）：M1-A 必須**先**完成 webhookAuthMode + legacyId + reconciler_owned_commands schema 落地，**之後** M1-B / M1-D 才動工；§5 拓撲表已修

### CR-8（新增，由 critic H-2/H-3/H-4 觸發）：D 文件 scope/audience 概念修正

**問題**：D 文件全文把「scope」誤當成 target/audience，sidebar 標題寫「Target (scope)」、列舉值寫 `(all_dms/user/group)`、範例值用 `Scope: all_dms IntegType: bot Ctx: dm` ── 三個值全部不在 §1.1 鎖定列舉內。CR-3 只覆蓋 tab 標籤，沒覆蓋此根本性概念混淆。

**決議**（M1-D 落地時須遵循）：

1. **sidebar 主維度命名**：保留 audience 三類（`all_dms / user / group`），但**側欄標題不寫「scope」**，改寫「對象（Audience）」
2. **三軸欄位專屬於 form 內**：`scope ∈ {global, guild}` 只出現在編輯 form 的「Discord 三軸」section，不出現在 sidebar
3. **範例值修正**：D §2.3 / §3 Step 2b 的 `Scope: all_dms IntegType: bot Ctx: dm` 全部改用 §1.1 鎖定列舉，例：`Scope: global / IntegType: user_install / Ctx: BotDM,PrivateChannel`
4. **「指令」tab 線框補繪**：D §2.3 內容只屬於軌二「Behaviors」tab；軌三「指令」tab 完全沒有線框，M1-D 起跑前必補（或 M1-D task prompt 明確要求）
5. **i18n key dm_behavior 全文改 behavior**

### CR-9（新增，用戶設計覆寫）：D 文件設計變更

1. **移除 source filter-chip row**：D §1.2 sidebar 線框中「來源篩選器」整段刪除。理由：用戶決定不需要。
2. **source enum 重命名**：原 `source='admin'` 全部改為 `source='custom'`（DB enum、validateManifest、code symbol、API、UI 中文「自訂」、i18n key `sourceCustom`）

---

## 3. 設計風險拍板總表（七條）

| # | 風險 | 拍板 | 來源 |
|---|---|---|---|
| R-1 | 三軸 9 種非法子集 | DB CHECK constraint（A I-3）+ 應用層 validateManifest（B V-C1/V-C2/V-C3）雙層阻擋；source='system' row 豁免 | A + B |
| R-2 | `behavior_sessions` 去留 | **保留**，PK=userId 單活躍；FK 重連到新 behaviors 表（順序修正見 CR-7） | A + C |
| R-3 | `[BEHAVIOR:END]` sentinel 去留 | **保留**，搬到 MessagePatternMatcher | C |
| R-4 | message_pattern 在 guild context 支援 | **不支援**，DM-only。理由：效能 + 語意錯配 + 既有實作已 DM-only | C |
| R-5 | HMAC 簽署策略 | 軌三 plugin_command 強制簽 `dispatchHmacKey`；軌二 plugin behavior 預設不簽（裸 webhook 相容）；軌二 custom behavior 沿用 v1 雙簽（webhookSecret + webhookAuthMode opt-in） | B + C |
| R-6 | Plugin 詳情頁路由 | 獨立 route `/admin/plugins/:pluginKey`，6 tab（總覽/Behaviors/指令/Guild Features/Scopes/安全設定）| D |
| R-7 | Behaviors 側欄分類維度 | **audience 為主側欄維度**（all_dms/user/group），無 source filter（CR-9 覆寫），三軸只在 form 內 | D + 用戶覆寫 |

---

## 4. 開放問題（M1 處理）

### 已解（升級為 CR）

| 原 OQ | 升級理由 |
|---|---|
| OQ-A（webhookAuthMode 欄位） | 升級為 CR-6，M1-A 必落 |
| OQ-B（reconciler_owned_commands） | 升級為 CR-7 第 3 條，M1-A 第 6 個 migration |

### 不阻擋 M1（保留為 OQ）

| OQ | 內容 | 緩解 |
|---|---|---|
| OQ-1 | `audienceKind='all'` 在多 contexts 下 UI 文案 | M1-D 寫文案時釐清 |
| OQ-2 | `behaviors[].webhook_path` 同 plugin 內唯一性 | **升級為阻擋**：B V-09 改寫，M1-B 落地時加唯一性檢查；A 加 `(pluginId, webhook_path)` UNIQUE |
| OQ-3 | `slashHints.options` 是否支援 sub_command | M1-B 暫不支援，sub_command 是 M2+ 範圍 |
| OQ-4 | `plugin_commands` 軌一/軌三共表長期可持續性 | 觀察 6 個月，若軌一規模成長則拆 `plugin_slash_commands` |
| OQ-5 | `GuildFeatureDefinition.commands[]` SDK 是否帶 handler | M1-B 採「不帶，由 onReady 掛路由」 |
| OQ-6 | `defineBehavior` handler 是否分 slash/native mode | M1-B 採「合一，plugin 自行 inspect ctx.body」 |
| OQ-7 | continuous session timeout（DB-side expiry） | M2+ 加 `expiresAt` 欄位 |
| OQ-8 | `scope=guild` 軌二 behavior 在 guildCreate 增量 register | M1-C 實作 guildCreate handler |
| OQ-9 | SQLite rebuild + backfill 單 transaction，row > 100k 分批 | M1-A 實作時若 row 數超標則加分批；目前 row 數無此風險 |
| OQ-10 | `_archive_*` 表 30 天後 DROP | M2 排程 |
| OQ-11 | Plugin 詳情頁 Behaviors tab 的 toggle 對應後端何欄/何表（M-1） | M1-A 與 M1-D 對齊；建議用 `plugin_behavior_overrides(pluginId, behaviorKey, enabled)` 新表 |
| OQ-12 | webhookAuthMode='token' 的 timing-safe compare（M-3） | M1-B 在 SDK 提供 `verifyWebhookToken(req, secret)` helper，強制 timing-safe |
| OQ-13 | migration up 期間 bot 是否停服（M-5） | M1-F 上線 checklist 加「migration 期間 maintenance mode」 |
| OQ-14 | v1 plugin 升級期間 ghost rows（M-6） | M1-C reconciler desired set 必先檢查 `plugins.manifest.schema_version === '2'`，否則跳過該 plugin 所有 row |

---

## 5. M1 啟動清單

### 5.1 依賴拓撲（已修正，CR-5 對齊）

```
M1-A (DB migration 撰寫，6 檔)
  必含：webhookAuthMode + legacyId 欄位、behavior_sessions FK 順序、reconciler_owned_commands 表
  ─────────────── 完成 schema 落地 ───────────────
   ↓
M1-B (Plugin SDK v2 實作)         ← 依賴 M1-A schema
M1-D (admin UI)                   ← 依賴 M1-A schema（webhookAuthMode 欄位才能畫 mode select）
M1-C (bot-side runtime 實作)      ← 依賴 M1-A + M1-B
   ↓
M1-E (既有 plugin 升級 v2 manifest)  ← 依賴 M1-B 出 SDK
   ↓
M1-F (端到端驗收 + Playwright + 上線) ← 依賴 M1-A~E
```

### 5.2 可並行起跑

- **M1-B / M1-D / M1-C** 在 M1-A schema 完成後可三方並行（M1-C 對 M1-B 的依賴是 manifest schema，M1-B 出介面定義即可放 M1-C 起跑）
- **M1-E 既有 plugin 升級** 在 M1-B 出 SDK 後即可起跑
- **M1-A 必須先**，無並行（用戶覆寫 + critic 強制）

### 5.3 第一個要做的事

**M1-A**：撰寫 6 個 migration 檔案：

| # | 檔名 | 職責 | 含 CR-7 修正 |
|---|---|---|---|
| 1 | `20260501010000-behaviors-v2-rebuild.ts` | rebuild `behaviors` 表（建 v2 → backfill case 1~4 → rename） | 含 webhookAuthMode 欄位、legacyId 欄位、I-2 放寬 |
| 2 | `20260501020000-behavior-audience-members.ts` | 建 `behavior_audience_members`（case 6） | — |
| 3 | `20260501030000-behavior-sessions-v2-relink.ts` | rebuild `behavior_sessions` FK → 新 behaviors（case 7，**rename 後執行**） | 順序修正 |
| 4 | `20260501040000-archive-legacy-behavior-targets.ts` | rename `behavior_targets` / `behavior_target_members` 為 `_archive_*`（case 5） | — |
| 5 | `20260501050000-plugin-commands-tri-axis.ts` | `plugin_commands` ADD COLUMN × 8 + manifest backfill（case 8） | Case 2/8 backfill 修 V-C3 |
| 6 | `20260501060000-reconciler-owned-commands.ts`（**新增**）| 建 reconciler_owned_commands 表 | CR-7 第 3 條 |
| 7 | `20260501070000-drop-behavior-legacy-id.ts`（**新增**）| DROP `behaviors.legacyId`（rebuild）| CR-7 第 1 條 |

---

## 6. 子文件索引

| 子任務 | 範圍 | 文件 | 狀態 |
|---|---|---|---|
| M0-A | DB schema + migration 演算法 | [m0/A-schema.md](./m0/A-schema.md) | M0 階段已修整（含 CR-6/7 落地） |
| M0-B | Plugin SDK v2 介面 + manifest schema | [m0/B-sdk.md](./m0/B-sdk.md) | M0 階段已修（H-6/H-9 + admin→custom）|
| M0-C | bot-side runtime + dispatcher | [m0/C-runtime.md](./m0/C-runtime.md) | M0 階段已修（H-1/M-8/M-9 + admin→custom）|
| M0-D | Admin UI 線框 + plugin 詳情頁 | [m0/D-ui.md](./m0/D-ui.md) | M0 階段已修（CR-3/8/9 落地，補軌三線框）|

---

## 7. critic 二次審後修正完成項目（紀錄）

### 已修（M0 階段內）

來自 critic 一審報告的修正：

| Finding | 內容 | 解法 |
|---|---|---|
| C-1 | webhookSecret CHECK 衝突 | A §I-2 改寫，加 webhookAuthMode（CR-6） |
| C-2 | Case 3 contexts 含 Guild | A Case 3 改 `'BotDM,PrivateChannel'` |
| C-3 | legacyId 欄位 | A §1.2 DDL 補 + 排程加 DROP step |
| C-4 | behavior_sessions FK 順序 | A §3 流程 case 7 移到 rename 後 |
| C-5 | 拓撲依賴衝突 | M0-FROZEN §5.1 修正 |
| H-1 | C 文件 JSON array 描述 | C §2.1 / §8 改 sorted comma-joined |
| H-2 | D scope/audience 概念混淆 | CR-8 全文修正 |
| H-3 | D 範例值 all_dms/bot/dm | 對齊 §1.1 列舉 |
| H-4 | D 缺軌三「指令」tab 線框 | M1-D 補繪 |
| H-5 | reconciler_owned_commands 沒指派 | CR-7 落地，M1-A 第 6 檔 |
| H-6 | B definePluginCommand 反向 deprecated | B §3.5 修正 |
| H-7 | A §2.1 內部矛盾 | 刪除「rename → plugin_slash_commands」字樣 |
| H-8 | A case 8 寫死 scope=guild | 改從 manifest 讀，缺省回退 |
| H-9 | B V-09 缺 webhook_path 唯一性 | OQ-2 升級為阻擋，M1-B 落地 |
| H-10 | A I-5 缺 placement→scope=guild | A §1.2 加新 invariant |
| M-2 | UNIQUE 索引 contexts sort 風險 | M1-A 加 sequelize hooks 強制 sort |
| M-7 | D i18n key dm_behavior | 全文改 behavior |
| M-8 | C 9 種組合表 #8 自相矛盾 | 改為非法 |
| M-9 | C 偽碼 row.triggerValue | 改 row.slashCommandName |
| M-10 | A case 2 違反 V-C3 | 改 integrationTypes 為 `'guild_install,user_install'` |
| M-11 | orphan session 靜默丟棄 | 改為 fatal assertion |

### 用戶設計覆寫（CR-9）

- 移除 source filter-chip
- admin → custom 全置換

### 不在 M0 修，列為 OQ

- M-1 / M-3 / M-5 / M-6（升級為 OQ-11/12/13/14）
- L-1 ~ L-7（建議性，M1-F 上線 checklist 處理）

---

## 8. 不變區（軌一）保證清單

以下檔案/區段在 M1 全部不動，任何 M1 子任務若觸碰需在 PR 中明確說明：

**檔案**：
- `src/modules/builtin-features/in-process-command-registry.service.ts`（全檔）
- `src/modules/builtin-features/` 下 5 個 feature 實作（picture-only / role-emoji / todo-channel / rcon-forward / voice）
- `src/modules/feature-toggle/models/bot-feature-state.model.ts`（全檔）
- `src/modules/plugin-system/models/plugin_guild_features.*`
- `frontend/src/views/admin/guilds/GuildBotFeaturesPanel.vue`（全檔）

**區段**：
- `src/modules/plugin-system/plugin-command-registry.service.ts:374-420`（per-feature 半部）
- `src/modules/plugin-system/plugin-command-registry.service.ts:427-477`（registerFeatureCommandInGuild）
- `src/modules/plugin-system/plugin-command-registry.service.ts:486-513`（syncFeatureCommandsForGuild）

**表**：
- `bot_feature_state` / `plugin_guild_features` / `plugins` / `plugin_kv` / `plugin_configs`

---

## 9. M0 完成簽收

- [x] M0-A 文件存在且通過內部三問自審
- [x] M0-B 文件存在且通過內部三問自審
- [x] M0-C 文件存在且通過內部三問自審
- [x] M0-D 文件存在且通過內部三問自審
- [x] 跨子任務衝突已彙整成 9 個 CR 並決議
- [x] 7 個設計風險拍板表完成
- [x] 開放問題分為「升級為 CR」（2 個）與「保留 OQ」（14 個）
- [x] M1 啟動清單與依賴拓撲就位（critic C-5 修正）
- [x] 軌一不變區保證清單列出
- [x] critic 一審 33 條 finding 全部分類處置
- [x] 用戶 CR-9 覆寫落地

**M0 凍結 v2。等 critic 二審通過後啟動 M1。**
