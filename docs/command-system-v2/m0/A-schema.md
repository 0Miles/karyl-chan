# 指令架構 v2 — M0-A：DB Schema 與 Migration 演算法

> 狀態：設計草案（M0 階段，尚未實作）。本文件由 db-expert 在 P7 設計階段交付。
> 對應票：karyl-chan 指令架構 v2 破壞性重構 M0-A
> 對齊文件：[B-sdk.md](./B-sdk.md)（Plugin SDK v2 介面草案）
> DB 引擎：SQLite（`src/db.ts`），所有 DDL 以 SQLite 方言撰寫

---

## 0. 三軌總覽（不變動部分先框出）

| 軌 | 涵義 | 表 | 本次處置 |
|----|------|----|----------|
| 軌一 | Guild Feature（plugin manifest 宣告 + 內建 5 個） | `bot_feature_state`、`plugin_guild_features`、（`plugin_commands` 中 `featureKey IS NOT NULL` 的子集） | **保留不動**，作為比較基準 |
| 軌二 | Behaviors（webhook 接口層；custom / plugin / system 三 source） | 改：`behaviors`（破壞性）；評估：`behavior_targets`/`behavior_target_members`/`behavior_sessions` | 重構（本文件主軸） |
| 軌三 | Plugin 自訂指令（manifest 鎖三軸；admin 只能 on/off） | 新或合併：取代 `plugin_commands` 中 `featureKey IS NULL` 的子集 | 重構（本文件主軸） |

**不動清單（本 migration 不得 ALTER / DROP）**：`bot_feature_state`、`plugin_guild_features`、`plugins`、`plugin_kv`、`plugin_configs`。

---

## 1. 新 `behaviors` 表 DDL（破壞性重建）

### 1.1 設計決策

#### D-1：三軸（scope / integration_types / contexts）儲存格式

選擇：**`scope` 用 TEXT 列舉欄；`integration_types` 與 `contexts` 用 `TEXT NOT NULL`，內容為**「lexicographically sorted, comma-joined token list」**（例：`"BotDM,PrivateChannel"`、`"guild_install,user_install"`）。

理由：
- SQLite 沒有原生 array／JSON 索引；用「排序後字串」可以對「集合相等」做 indexable lookup（dispatcher 的熱路徑：`WHERE contexts = 'BotDM,PrivateChannel'`）。
- 跟現存 `plugin_command-registry.service.ts` 的 `CONTEXT_MAP` 大小有限（contexts 3 種、integration_types 2 種），不需要關聯表的彈性。
- 關聯表（`behavior_contexts`、`behavior_integration_types`）會放大 query 複雜度且帶不來查詢能力。
- 用 JSON 字串會喪失「集合相等」索引能力（`WHERE contexts = '["BotDM","PrivateChannel"]'` 對 `["PrivateChannel","BotDM"]` 不相等）。

寫入規則：應用層在 INSERT/UPDATE 前 **強制排序 + 去重 + 小寫不敏感比對**；DB 端用 CHECK constraint 限制 token 集合（見 1.2）。

#### D-2：`messagePatternConfig`（startswith/endswith/regex）

選擇：**拆兩欄**：`messagePatternKind TEXT NULL CHECK IN ('startswith','endswith','regex')` + `messagePatternValue TEXT NULL`。

理由：
- 舊 schema 已是「triggerType + triggerValue」兩欄分離的形態，沿用最低風險。
- JSON 內嵌會逼 dispatcher 每筆 row 解析一次 JSON，沒有任何收益。
- CHECK constraint 直接卡 kind 列舉，比 JSON schema 驗證便宜。
- `triggerType='message_pattern'` 時兩欄 NOT NULL（語義必填，CHECK 規則見 1.2）；`triggerType='slash_command'` 時兩欄 NULL。

#### D-3：`enabled` / `sortOrder` / `forwardType` / `stopOnMatch` 去留

| 欄位 | 去留 | 理由 |
|------|------|------|
| `enabled` | **保留** | admin on/off 的單一開關，UI 直接綁這一欄 |
| `sortOrder` | **保留** | dispatcher 評估順序需要穩定排序；同 target/scope 內多條 behavior 仍要決勝 |
| `forwardType` | **保留** | continuous session 機制不在這次廢棄（見 D-7）；若 D-7 改判廢棄，此欄一併移除 |
| `stopOnMatch` | **保留** | dispatcher 短路評估的核心開關；admin 仍會用到 |

#### D-4：`source` 與 `triggerType`

- `source TEXT NOT NULL CHECK IN ('custom','plugin','system')` ← CR-9 用戶覆寫，原 `admin` 改 `custom`
- `triggerType TEXT NOT NULL CHECK IN ('slash_command','message_pattern')`

舊 `triggerType ∈ {startswith,endswith,regex,slash_command}` 拆解：四值 → 兩值（`slash_command` 與 `message_pattern`）+ 子型 `messagePatternKind`。

#### D-5：webhook URL / secret 欄位

| 欄位 | 規格 | source 對應 |
|------|------|--------------|
| `webhookUrl` | `TEXT NULL`（v2: 加密 v2 envelope） | source=custom 時 NOT NULL；source=plugin 時 NULL（live URL 從 `plugins.url + manifest.behaviors[].webhook_path` 動態組合）；source=system 時 NULL |
| `webhookSecret` | `TEXT NULL`（v2: 加密 v2 envelope） | source=custom 時 optional；source=plugin 時 **可選**（CR-6 覆寫：admin 可在 UI 啟用 token/HMAC mode）；source=system 時必須 NULL |
| `webhookAuthMode` | `TEXT NULL CHECK IN ('token','hmac')` | CR-6 新增：webhookSecret IS NOT NULL 時必填；NULL 時必須 NULL；source=system 時必須 NULL |
| `legacyId` | `INTEGER NULL UNIQUE` | CR-7 新增：暫存舊 behaviors.id 對應，case 6/7 backfill 用；M1-A 第 7 個 migration 完成後 DROP |

**破壞性變更**：舊 schema 中 `webhookUrl NOT NULL` 對 plugin/system row 用 placeholder 字串繞過。v2 改成 `NULL`，不再需要 placeholder。

#### D-6：plugin / system 關聯欄位

| 欄位 | 規格 | 用途 |
|------|------|------|
| `pluginId` | `INTEGER NULL REFERENCES plugins(id) ON DELETE CASCADE` | source=plugin 時必填；其他 NULL |
| `pluginBehaviorKey` | `TEXT NULL` | source=plugin 時必填（對應 manifest `behaviors[].key`） |
| `systemKey` | `TEXT NULL CHECK IN ('admin-login','manual','break')` | source=system 時必填；其他 NULL（**取代舊版** `pluginBehaviorKey` 兼任 system key 的 hack） |

#### D-7：`behavior_sessions` 去留

選擇：**保留**（PK=userId 單活躍 session 設計沿用）。

理由：
- continuous session（一條訊息 → 接著被同一 behavior 接管直到 `/break`）是 admin webhook 的 killer feature，產品面不能砍。
- `forwardType='continuous'` 的語意已落地在 dispatcher（`webhook-behavior.events.ts:106`）並落地在 systemBehavior 與 user webhook 的所有現行 row。
- 真正的疑慮是「user 不能同時跑兩條 continuous」太嚴；M1+ 若要放寬，PK 換成複合鍵（userId + behaviorId）即可，**不在本 migration 範圍**。

但因 `behaviors` 表 PK 不變（仍 INTEGER autoincrement，且重建表時 row id 我們會重編 — 見 3.5），FK `behavior_sessions.behaviorId` 必須在 backfill 完成後**修補指向新 id**。

#### D-8：`behavior_targets` / `behavior_target_members` 去留

選擇：**全部廢棄**（DROP TABLE on down ✗ — 改名保留 archive）。

理由：
- 軌二的 admin 控制軸從 `target` 變為「三軸 + audience 規則」。`all_dms` target 對應「scope=global + contexts=[BotDM,PrivateChannel]」，已能用三軸表達。
- `kind='user'` 的 target 對應「audience = 單 user snowflake」；`kind='group'` 對應「audience = group + 透過 join 表展開的 userId 集合」。這兩個語意需要承載到新表，但**不需要 `behavior_targets` 表本身**。
- 為避免資料喪失，backfill 階段把 `behavior_targets` 的 user/group 資訊**直接欄位化到 `behaviors`**（見 1.2 `audienceKind` / `audienceUserId` / `audienceGroupName`）。`behavior_target_members` 改成新表 `behavior_audience_members`（重新命名以對齊新詞彙），FK 指向 `behaviors.id`。

archive 策略：把舊表 rename 為 `_archive_behavior_targets` / `_archive_behavior_target_members`（保 30 天），下一個 migration（M1+）再 DROP。在 down 中能 rename 回來。

### 1.2 完整 DDL 草稿

```sql
-- 表：behaviors（v2，破壞性重建）
CREATE TABLE behaviors_v2 (
    id                       INTEGER  PRIMARY KEY AUTOINCREMENT,

    -- 基本元資料
    title                    TEXT     NOT NULL,
    description              TEXT     NOT NULL DEFAULT '',
    enabled                  INTEGER  NOT NULL DEFAULT 1,        -- bool
    sortOrder                INTEGER  NOT NULL DEFAULT 0,
    stopOnMatch              INTEGER  NOT NULL DEFAULT 0,        -- bool
    forwardType              TEXT     NOT NULL DEFAULT 'one_time'
                             CHECK (forwardType IN ('one_time','continuous')),

    -- 三維分類
    source                   TEXT     NOT NULL
                             CHECK (source IN ('custom','plugin','system')),
    triggerType              TEXT     NOT NULL
                             CHECK (triggerType IN ('slash_command','message_pattern')),

    -- message_pattern 子型（triggerType='message_pattern' 時 NOT NULL；否則 NULL）
    messagePatternKind       TEXT     NULL
                             CHECK (messagePatternKind IS NULL
                                 OR messagePatternKind IN ('startswith','endswith','regex')),
    messagePatternValue      TEXT     NULL,

    -- slash_command 子欄位（triggerType='slash_command' 時 NOT NULL；否則 NULL）
    slashCommandName         TEXT     NULL,
    slashCommandDescription  TEXT     NULL,

    -- 三軸（admin 可控；source='system' 寫死、source='plugin' 沿用 manifest hint）
    scope                    TEXT     NOT NULL DEFAULT 'global'
                             CHECK (scope IN ('global','guild')),
    integrationTypes         TEXT     NOT NULL DEFAULT 'guild_install',
                             -- 排序後 comma-joined：'guild_install' / 'user_install'
                             -- / 'guild_install,user_install'
    contexts                 TEXT     NOT NULL DEFAULT 'Guild',
                             -- 排序後 comma-joined：'BotDM' / 'BotDM,Guild' /
                             -- 'BotDM,PrivateChannel' / 'BotDM,Guild,PrivateChannel' / ...

    -- placement（scope='guild' 時可選綁定到特定 guild + channel；
    -- 對應 plugin webhook 的「裸 native channel webhook」場景）
    placementGuildId         TEXT     NULL,
    placementChannelId       TEXT     NULL,

    -- audience（從舊 behavior_targets 欄位化而來）
    audienceKind             TEXT     NOT NULL DEFAULT 'all'
                             CHECK (audienceKind IN ('all','user','group')),
    audienceUserId           TEXT     NULL,        -- audienceKind='user' 時 NOT NULL
    audienceGroupName        TEXT     NULL,        -- audienceKind='group' 時 NOT NULL

    -- source-specific：custom（webhook URL/secret，加密 v2 envelope）
    webhookUrl               TEXT     NULL,
    webhookSecret            TEXT     NULL,
    -- CR-6 新增：簽署模式（webhookSecret IS NOT NULL 時必填）
    webhookAuthMode          TEXT     NULL
                             CHECK (webhookAuthMode IS NULL
                                 OR webhookAuthMode IN ('token','hmac')),

    -- CR-7 新增：暫存舊 behaviors.id（case 6/7 backfill 用，M1-A 第 7 個 migration DROP）
    legacyId                 INTEGER  NULL UNIQUE,

    -- source-specific：plugin
    pluginId                 INTEGER  NULL REFERENCES plugins(id) ON DELETE CASCADE,
    pluginBehaviorKey        TEXT     NULL,

    -- source-specific：system
    systemKey                TEXT     NULL
                             CHECK (systemKey IS NULL
                                 OR systemKey IN ('admin-login','manual','break')),

    createdAt                DATETIME NOT NULL,
    updatedAt                DATETIME NOT NULL,

    -- ── 跨欄位 invariant（CHECK constraint）───────────────────────────────
    -- I-1: triggerType='message_pattern' ↔ messagePatternKind/Value NOT NULL；
    --      triggerType='slash_command'   ↔ slashCommandName NOT NULL
    CHECK (
        (triggerType = 'message_pattern' AND messagePatternKind IS NOT NULL
                                          AND messagePatternValue IS NOT NULL
                                          AND slashCommandName IS NULL)
     OR (triggerType = 'slash_command'   AND slashCommandName IS NOT NULL
                                          AND messagePatternKind IS NULL
                                          AND messagePatternValue IS NULL)
    ),
    -- I-2 (CR-6 覆寫，已放寬 source=plugin 的 webhookSecret 限制):
    --   source='custom'  ↔ webhookUrl NOT NULL，pluginId/systemKey/pluginBehaviorKey NULL
    --   source='plugin'  ↔ pluginId NOT NULL, pluginBehaviorKey NOT NULL,
    --                      webhookUrl NULL, systemKey NULL
    --                      （webhookSecret 可 NULL 或 NOT NULL，admin 在 UI 設定）
    --   source='system'  ↔ systemKey NOT NULL,
    --                      webhookUrl/webhookSecret/pluginId/pluginBehaviorKey 全 NULL
    CHECK (
        (source = 'custom' AND webhookUrl IS NOT NULL
                           AND pluginId IS NULL AND systemKey IS NULL
                           AND pluginBehaviorKey IS NULL)
     OR (source = 'plugin' AND pluginId IS NOT NULL AND pluginBehaviorKey IS NOT NULL
                           AND webhookUrl IS NULL AND systemKey IS NULL)
     OR (source = 'system' AND systemKey IS NOT NULL
                           AND webhookUrl IS NULL AND webhookSecret IS NULL
                           AND pluginId IS NULL AND pluginBehaviorKey IS NULL)
    ),
    -- I-2b (CR-6 新增): webhookAuthMode 與 webhookSecret 對應規則
    CHECK (
        (webhookSecret IS NULL     AND webhookAuthMode IS NULL)
     OR (webhookSecret IS NOT NULL AND webhookAuthMode IS NOT NULL
                                   AND source != 'system')
    ),
    -- I-3: 三軸非法組合（與 B-sdk.md 4.2 對齊；custom/plugin 適用，system 略過）
    --   scope='guild' 時 contexts 不可包含 BotDM 或 PrivateChannel；
    --   scope='guild' 時 integrationTypes 不可包含 user_install
    --   （SQLite 不支援陣列 contains，用字串 LIKE 模式檢查）
    CHECK (
        source = 'system'
     OR (
            scope = 'global'
         OR (
                scope = 'guild'
            AND integrationTypes NOT LIKE '%user_install%'
            AND contexts NOT LIKE '%BotDM%'
            AND contexts NOT LIKE '%PrivateChannel%'
         )
        )
    ),
    -- I-4: audienceKind='user' ↔ audienceUserId NOT NULL；
    --      audienceKind='group' ↔ audienceGroupName NOT NULL；
    --      audienceKind='all' ↔ 兩者 NULL
    CHECK (
        (audienceKind = 'all'   AND audienceUserId IS NULL AND audienceGroupName IS NULL)
     OR (audienceKind = 'user'  AND audienceUserId IS NOT NULL AND audienceGroupName IS NULL)
     OR (audienceKind = 'group' AND audienceGroupName IS NOT NULL AND audienceUserId IS NULL)
    ),
    -- I-5: placement 兩欄要嘛全 NULL，要嘛 placementGuildId NOT NULL
    --      （channel 可選；guild 是 channel 的前置條件）
    CHECK (
        (placementGuildId IS NULL AND placementChannelId IS NULL)
     OR (placementGuildId IS NOT NULL)
    ),
    -- I-6 (critic H-10): placement 設定時必須 scope='guild'
    --   全域指令不應綁特定 guild channel
    CHECK (
        placementGuildId IS NULL OR scope = 'guild'
    ),
    -- I-7 (critic C-2): triggerType='message_pattern' 時 contexts 不可包含 Guild
    --   對齊 R-4「message_pattern DM-only」拍板
    CHECK (
        triggerType = 'slash_command'
     OR (triggerType = 'message_pattern' AND contexts NOT LIKE '%Guild%')
    )
);

-- 索引（dispatcher 熱路徑）
CREATE UNIQUE INDEX behaviors_v2_system_uq
    ON behaviors_v2(systemKey) WHERE source = 'system';
    -- 每個 systemKey 全表唯一（admin-login / manual / break 各一條）

CREATE UNIQUE INDEX behaviors_v2_plugin_uq
    ON behaviors_v2(pluginId, pluginBehaviorKey) WHERE source = 'plugin';
    -- 同 plugin 下每個 behaviorKey 唯一

CREATE INDEX behaviors_v2_dispatch_idx
    ON behaviors_v2(triggerType, enabled, scope, sortOrder);
    -- 主 dispatcher 路徑：列舉 enabled rows 排序評估

CREATE INDEX behaviors_v2_audience_user_idx
    ON behaviors_v2(audienceUserId) WHERE audienceKind = 'user';

CREATE INDEX behaviors_v2_audience_group_idx
    ON behaviors_v2(audienceGroupName) WHERE audienceKind = 'group';

CREATE INDEX behaviors_v2_plugin_idx
    ON behaviors_v2(pluginId) WHERE source = 'plugin';

CREATE INDEX behaviors_v2_placement_idx
    ON behaviors_v2(placementGuildId, placementChannelId)
    WHERE placementGuildId IS NOT NULL;

CREATE UNIQUE INDEX behaviors_v2_slash_uq
    ON behaviors_v2(slashCommandName, scope, contexts)
    WHERE triggerType = 'slash_command' AND enabled = 1;
    -- 同名 slash 在相同 scope×contexts 下唯一（防 admin 重複建）
```

> 注意：SQLite `ALTER TABLE` 不支援 `DROP COLUMN`、`MODIFY COLUMN`、`ADD CHECK` 等。本表用「rebuild pattern」執行（建新表 → backfill → drop old → rename），詳見第 3 節。

### 1.3 對應的新 `behavior_audience_members`（取代 `behavior_target_members`）

```sql
CREATE TABLE behavior_audience_members (
    behaviorId   INTEGER  NOT NULL,
    userId       TEXT     NOT NULL,
    createdAt    DATETIME NOT NULL,
    updatedAt    DATETIME NOT NULL,
    PRIMARY KEY (behaviorId, userId),
    FOREIGN KEY (behaviorId) REFERENCES behaviors_v2(id)
        ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX behavior_audience_members_user_idx
    ON behavior_audience_members(userId);
```

設計：每條 audienceKind='group' 的 behavior 直接擁有一張小成員清單，不再借由 target 中介。語意上等同於把舊 `behavior_targets(kind='group')` 攤平併入 behavior。**代價**：若多條 behavior 共用同一 group，成員會在 `behavior_audience_members` 裡重複（n×m 行）。觀察現網資料：當前 `behavior_targets` 中 `kind='group'` 通常 < 5 個，且每個被引用的 behavior 不多，重複量可接受；換到的好處是 dispatcher 不再 join 三層。若日後 group 暴漲，再做 normalize（M2+）。

### 1.4 對應的新 `behavior_sessions`（FK 指向 behaviors_v2）

語意不變、欄位不變、PK 不變（`userId` 單活躍 session）。實際 DDL 維持原樣，只在 rebuild `behaviors` 後 **重建 FK** 指向 `behaviors_v2`：

```sql
-- 不重建表本身，但在 behaviors 重命名為 behaviors_v2 → behaviors 完成後，
-- behavior_sessions.behaviorId 的舊 FK 已自動隨 sequelize sqlite 表名而對齊。
-- 為穩當起見：rebuild behavior_sessions 並把 behaviorId 對應到新表 id。
CREATE TABLE behavior_sessions_v2 (
    userId       TEXT     PRIMARY KEY,
    behaviorId   INTEGER  NOT NULL,
    channelId    TEXT     NOT NULL,
    startedAt    DATETIME NOT NULL,
    createdAt    DATETIME NOT NULL,
    updatedAt    DATETIME NOT NULL,
    FOREIGN KEY (behaviorId) REFERENCES behaviors(id)
        ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX behavior_sessions_v2_behavior_idx ON behavior_sessions_v2(behaviorId);
```

---

## 2. 軌三：Plugin 自訂指令表處置

### 2.1 設計決策

選擇：**沿用既有 `plugin_commands` 表**（保留表名不改，擴增三軸欄位 + admin enabled flag + description）。

理由：
- `plugin_commands` 既存欄位（pluginId / guildId / name / discordCommandId / featureKey / manifestJson）已涵蓋軌三所需 80%。
- 現行 `featureKey IS NOT NULL` 的 row 對應軌一（guild_features[].commands[]），保留語意；`featureKey IS NULL` 的 row 對應軌三（plugin_commands[]）。
- 重新建一張新表 + 拆遷 row 風險高、查詢端要分流。沿用 + 擴欄是最低風險。
- 不改名為 `plugin_slash_commands`：改名會打到所有讀寫者，影響面大（critic H-7 已決議）；只擴欄。

下方 DDL 採此方案。

### 2.2 ALTER 腳本

```sql
-- 不重建表（SQLite 允許 ADD COLUMN）；CHECK 用應用層驗證，不下到 SQL CHECK
-- （SQLite ADD COLUMN 不能加 CHECK，rebuild 太貴）。
ALTER TABLE plugin_commands ADD COLUMN description       TEXT    NULL;
ALTER TABLE plugin_commands ADD COLUMN adminEnabled      INTEGER NOT NULL DEFAULT 1;
ALTER TABLE plugin_commands ADD COLUMN scope             TEXT    NULL;       -- 'guild' / 'global'
ALTER TABLE plugin_commands ADD COLUMN integrationTypes  TEXT    NULL;       -- comma-joined
ALTER TABLE plugin_commands ADD COLUMN contexts          TEXT    NULL;       -- comma-joined
ALTER TABLE plugin_commands ADD COLUMN defaultMemberPermissions TEXT NULL;   -- 從 manifest 拷貝固化
ALTER TABLE plugin_commands ADD COLUMN defaultEphemeral  INTEGER NULL;       -- bool
ALTER TABLE plugin_commands ADD COLUMN requiredCapability TEXT  NULL;
```

backfill 規則：

| 欄位 | source（軌三 row：featureKey IS NULL） | source（軌一 row：featureKey IS NOT NULL） |
|------|-------------|-------------|
| `description` | `JSON_EXTRACT(manifestJson, '$.description')`，為空/NULL 時 backfill 報錯（M0-B 強制要求 description 必填） | 同上 |
| `adminEnabled` | 預設 1（既有 row 視為已啟用） | 預設 1（軌一 row 受 plugin_guild_features 控制，此欄保留以一致 API） |
| `scope` | 從 manifest 推導：`featureKey IS NULL AND guildId IS NULL → 'global'`；`featureKey IS NULL AND guildId IS NOT NULL → 'guild'` | **從 manifest `guild_features[].commands[].scope` 讀，缺省 'guild'**（H-8 修：原寫死 'guild' 會與 manifest 含 BotDM 的 commands 衝突，違反 I-3） |
| `integrationTypes` | 從 manifest `commands[].integration_types` 拷貝（缺省 `'guild_install'`） | 從 `guild_features[].commands[].integration_types` 拷貝（缺省 `'guild_install'`） |
| `contexts` | 從 manifest `commands[].contexts` 拷貝（缺省 `'Guild'`） | 從 `guild_features[].commands[].contexts` 拷貝（缺省 `'Guild'`） |
| `defaultMemberPermissions` | 從 manifest 拷貝 | 從 manifest 拷貝 |
| `defaultEphemeral` | 從 manifest 拷貝 | 從 manifest 拷貝 |
| `requiredCapability` | 從 manifest 拷貝 | 從 manifest 拷貝 |

索引：

```sql
CREATE INDEX IF NOT EXISTS plugin_commands_admin_enabled_idx
    ON plugin_commands(pluginId, adminEnabled);
```

### 2.3 與軌二的差異（明確邊界）

| 維度 | 軌二 plugin behavior（在 `behaviors_v2` 中） | 軌三 plugin command（在 `plugin_commands` 中） |
|------|----------|----------|
| Manifest 來源 | `manifest.behaviors[]` | `manifest.plugin_commands[]` |
| 三軸來源 | admin 可改（從 manifest hint 初始化後可覆寫） | manifest 寫死（admin 只能 on/off） |
| Trigger 形式 | `slash_command`（可選，需有 slashHints）+ `message_pattern` | 只有 `slash_command` |
| Webhook 路徑 | plugin URL + `behaviors[].webhook_path`（可裸 native webhook 用） | bot 經 RPC dispatch（`endpoints.plugin_command`） |
| Admin 操作 | 增刪改、改三軸、改 audience、on/off | 只能 on/off |

---

## 3. 舊 → 新 Backfill 演算法

DB 引擎是 SQLite，rebuild pattern 流程（總體；CR-7 修正後順序）：

```
1. CREATE TABLE behaviors_v2 (新 schema，含 legacyId 欄位)
2. INSERT INTO behaviors_v2 (...) SELECT ... FROM behaviors
   JOIN behavior_targets ON behaviors.targetId = behavior_targets.id
   按 case 1～4 規則 backfill 三軸 / source / audience；legacyId = OLD.id
3. INSERT INTO behavior_audience_members (behaviorId, userId, ...)
   SELECT b_v2.id, btm.userId
   FROM behavior_target_members btm
   JOIN behavior_targets bt ON bt.id = btm.targetId
   JOIN behaviors_v2 b_v2 ON b_v2.audienceKind='group'
                          AND b_v2.audienceGroupName = bt.groupName
                          AND b_v2.legacyId = (該 group 對應的舊 behavior.id)
4. CREATE TABLE behavior_sessions_v2 (空表，FK 暫指 behaviors_v2.id)
5. ALTER TABLE behaviors RENAME TO _archive_behaviors;
   ALTER TABLE behaviors_v2 RENAME TO behaviors;
   ALTER TABLE behavior_sessions RENAME TO _archive_behavior_sessions;
   ALTER TABLE behavior_sessions_v2 RENAME TO behavior_sessions;
   (CR-7：rename 必須在 step 6 之前，否則 FK 對不上新 behaviors.id)
6. INSERT INTO behavior_sessions (...) SELECT ..., b_new.id, ...
   FROM _archive_behavior_sessions bs
   JOIN behaviors b_new ON b_new.legacyId = bs.behaviorId
   (case 7：透過 legacyId 重映射；orphan session fatal error，不靜默丟棄)
7. ALTER TABLE behavior_targets RENAME TO _archive_behavior_targets;
   ALTER TABLE behavior_target_members RENAME TO _archive_behavior_target_members;
8. plugin_commands ALTER (見 §2.2)
9. (M1-A 第 7 個 migration 獨立檔) DROP behaviors.legacyId 欄位 (SQLite rebuild)
```

逐 case 詳細邏輯如下。**每個 case 用 pseudo-SQL 表達；實際實作會包成 sequelize migration `up` 中的 raw SQL + 程式邏輯（部分需要 manifest JSON 解析）。**

### Case 1：舊 type='system'（`admin-login`/`manual`/`break`，3 row）

舊 row 特徵：
- `type = 'system'`
- `pluginBehaviorKey ∈ {'admin-login','manual','break'}`
- `targetId = 1` (`ALL_DMS_TARGET_ID`)
- `triggerType = 'slash_command'`
- `triggerValue = 'login'/'manual'/'break'`
- `webhookUrl` = `encryptSecret('system://...')`（placeholder，丟棄）

新 row 對應：
```
source              = 'system'
triggerType         = 'slash_command'
slashCommandName    = OLD.triggerValue          -- 保留 admin 自訂的 trigger 名
slashCommandDescription = NULL                   -- bot 端 descriptionForSystemKey() 動態決定，不存
messagePatternKind  = NULL
messagePatternValue = NULL
scope               = 'global'                   -- 寫死
integrationTypes    = 'guild_install'            -- 寫死（沿用 dm-slash-rebind 既有 contract）
contexts            = 'BotDM,PrivateChannel'     -- 寫死（同上）
audienceKind        = 'all'                      -- 不需要 audience 過濾
webhookUrl          = NULL                       -- 丟棄 placeholder
webhookSecret       = NULL
pluginId            = NULL
pluginBehaviorKey   = NULL
systemKey           = OLD.pluginBehaviorKey      -- 'admin-login' / 'manual' / 'break'
title, description, enabled, sortOrder, stopOnMatch, forwardType
                    = OLD.* 沿用
placementGuildId    = NULL
placementChannelId  = NULL
audienceUserId      = NULL
audienceGroupName   = NULL
```

```sql
-- pseudo-SQL（M1-A 落地時請改用 named columns INSERT）
INSERT INTO behaviors_v2 (
    id, title, description, enabled, sortOrder, stopOnMatch, forwardType,
    source, triggerType,
    messagePatternKind, messagePatternValue,
    slashCommandName, slashCommandDescription,
    scope, integrationTypes, contexts,
    placementGuildId, placementChannelId,
    audienceKind, audienceUserId, audienceGroupName,
    webhookUrl, webhookSecret, webhookAuthMode,
    legacyId,
    pluginId, pluginBehaviorKey, systemKey,
    createdAt, updatedAt
)
SELECT
    NULL,
    title, description, enabled, sortOrder, stopOnMatch, forwardType,
    'system', 'slash_command',
    NULL, NULL,
    triggerValue, NULL,
    'global', 'guild_install', 'BotDM,PrivateChannel',
    NULL, NULL,
    'all', NULL, NULL,
    NULL, NULL, NULL,                            -- webhookUrl/Secret/AuthMode 都 NULL（system 規則）
    id,                                          -- legacyId = OLD.id (CR-7)
    NULL, NULL,
    pluginBehaviorKey,                           -- systemKey
    createdAt, updatedAt
FROM behaviors
WHERE type = 'system';
```

### Case 2：舊 type='webhook' + triggerType='slash_command' + targetId=1

舊 row 特徵：
- admin 透過 BehaviorsPage 在「all DMs」分頁建立的 slash trigger webhook
- 透過 `dm-slash-rebind` 註冊為全域 DM-only slash command

新 row 對應（CR-9 source admin→custom、M-10 integrationTypes 修、CR-6 webhookAuthMode 補、CR-7 legacyId 補）：
```
source              = 'custom'                   -- CR-9 覆寫
triggerType         = 'slash_command'
slashCommandName    = OLD.triggerValue
slashCommandDescription = OLD.title              -- dm-slash-rebind 用 title 當 description
messagePattern*     = NULL
scope               = 'global'
integrationTypes    = 'guild_install,user_install'  -- M-10 修：含 user_install 才能在 BotDM 出現
contexts            = 'BotDM,PrivateChannel'
audienceKind        = 'all'                      -- targetId=1 即「all DMs」語意
webhookUrl          = OLD.webhookUrl             -- 沿用加密 v2 envelope
webhookSecret       = OLD.webhookSecret
webhookAuthMode     = (OLD.webhookSecret IS NOT NULL) ? 'hmac' : NULL  -- CR-6 對應
systemKey           = NULL
pluginId            = NULL
legacyId            = OLD.id                     -- CR-7 補
title, description, enabled, sortOrder, stopOnMatch, forwardType = OLD.* 沿用
```

```sql
INSERT INTO behaviors_v2 (...)
SELECT
    NULL, title, description, enabled, sortOrder, stopOnMatch, forwardType,
    'custom', 'slash_command',
    NULL, NULL,
    triggerValue, title,
    'global', 'guild_install,user_install', 'BotDM,PrivateChannel',
    NULL, NULL,
    'all', NULL, NULL,
    webhookUrl, webhookSecret,
    CASE WHEN webhookSecret IS NOT NULL THEN 'hmac' ELSE NULL END,
    NULL, NULL, NULL,
    id,                                          -- legacyId
    createdAt, updatedAt
FROM behaviors
WHERE type = 'webhook' AND triggerType = 'slash_command' AND targetId = 1;
```

### Case 3：舊 type='webhook' + triggerType ∈ {startswith, endswith, regex}

對 targetId 三類 audience（all/user/group）各 inner join 一次。下面以 `targetId=1`（all）為例：

新 row 對應（CR-9 source admin→custom、C-2 修 contexts、CR-6 webhookAuthMode 補、CR-7 legacyId 補）：
```
source              = 'custom'                   -- CR-9 覆寫
triggerType         = 'message_pattern'
messagePatternKind  = OLD.triggerType            -- 'startswith' / 'endswith' / 'regex'
messagePatternValue = OLD.triggerValue
slashCommand*       = NULL
scope               = 'global'                   -- 訊息模式不限 guild
integrationTypes    = 'guild_install,user_install'
contexts            = 'BotDM,PrivateChannel'     -- C-2 修：移除 Guild，對齊 R-4 message_pattern DM-only
audienceKind        = (取自 behavior_targets.kind)
audienceUserId      = (kind='user' 時取 behavior_targets.userId)
audienceGroupName   = (kind='group' 時取 behavior_targets.groupName)
webhookAuthMode     = (OLD.webhookSecret IS NOT NULL) ? 'hmac' : NULL
legacyId            = OLD.id                     -- CR-7 補
```

```sql
INSERT INTO behaviors_v2 (...)
SELECT
    NULL, b.title, b.description, b.enabled, b.sortOrder, b.stopOnMatch, b.forwardType,
    'custom', 'message_pattern',
    b.triggerType, b.triggerValue,
    NULL, NULL,
    'global', 'guild_install,user_install', 'BotDM,PrivateChannel',
    NULL, NULL,
    CASE bt.kind
        WHEN 'all_dms' THEN 'all'
        WHEN 'user'    THEN 'user'
        WHEN 'group'   THEN 'group'
    END,
    bt.userId,
    bt.groupName,
    b.webhookUrl, b.webhookSecret,
    CASE WHEN b.webhookSecret IS NOT NULL THEN 'hmac' ELSE NULL END,
    NULL, NULL, NULL,
    b.id,                                        -- legacyId
    b.createdAt, b.updatedAt
FROM behaviors b
JOIN behavior_targets bt ON bt.id = b.targetId
WHERE b.type = 'webhook' AND b.triggerType IN ('startswith','endswith','regex');
```

### Case 4：舊 type='plugin'（pluginId + pluginBehaviorKey）

舊 row 特徵：
- `type = 'plugin'`
- `pluginId IS NOT NULL`
- `pluginBehaviorKey` = manifest `dm_behaviors[].key`
- `webhookUrl` 是 placeholder，丟棄

新 row 對應（CR-6 webhookAuthMode 補、CR-7 legacyId 補）：
```
source              = 'plugin'                   -- 不變
triggerType         = OLD.triggerType            -- 同 case 2/3 規則拆解
                     -- 'slash_command' 走 slashCommandName;
                     -- {startswith,endswith,regex} 走 message_pattern
slashCommand* / messagePattern* = 同 case 2/3
scope               = 'global'                   -- v1 plugin behavior 沒有三軸概念，給通用值
integrationTypes    = 'guild_install,user_install'
contexts            = 'BotDM,PrivateChannel'     -- v1 dm_behavior 是 DM-only 語意
audienceKind        = (取自 behavior_targets.kind)
webhookUrl          = NULL                       -- 丟棄 placeholder
webhookSecret       = NULL                       -- v1 plugin 沒設 secret
webhookAuthMode     = NULL                       -- secret 為 NULL → mode 必為 NULL
pluginId            = OLD.pluginId
pluginBehaviorKey   = OLD.pluginBehaviorKey
systemKey           = NULL
legacyId            = OLD.id                     -- CR-7 補
```

**與 軌三 plugin_commands 的差別**：軌三是 plugin manifest `plugin_commands[]` 的條目（slash 走 plugin RPC dispatch，三軸 manifest 寫死、admin 不可改）；軌二是 `manifest.behaviors[]`（admin 可改三軸、用 webhook 接口、可裸 native channel webhook 用）。本 case 把 v1 `dm_behaviors[]` 全部歸到軌二（B-sdk.md §2 對應表已對齊）。

### Case 5：舊 `behavior_targets.kind ∈ {'user','group'}` 的 row

不再有獨立的 target 表 row。資訊在 case 3 / case 4 時直接 join 進 `behaviors_v2.audienceKind/UserId/GroupName`。case 結束後 `behavior_targets` 表只剩 archive 任務（rename + 30 天觀察 + M1 DROP）。

### Case 6：`behavior_target_members`

舊 row：`(targetId, userId)` 對映「group target 的成員清單」。

backfill 改成「對每條 audienceKind='group' 的新 behavior 各複製一份成員清單」：

```sql
-- CR-7 修正：用 legacyId 對齊舊→新 row，取代脆弱的三元組碰撞檢測
-- legacyId 已在 §1.2 DDL 加為正式欄位（暫存用，M1-A 第 7 個 migration DROP）
INSERT INTO behavior_audience_members (behaviorId, userId, createdAt, updatedAt)
SELECT b_v2.id, btm.userId, datetime('now'), datetime('now')
FROM behavior_target_members btm
JOIN behavior_targets bt ON bt.id = btm.targetId
JOIN behaviors b_old   ON b_old.targetId = bt.id
JOIN behaviors_v2 b_v2 ON b_v2.legacyId = b_old.id
                       AND b_v2.audienceKind = 'group'
                       AND b_v2.audienceGroupName = bt.groupName
WHERE bt.kind = 'group';
```

### Case 7：`behavior_sessions` 重映射（CR-7 流程順序修正）

**重要**：此步驟必須在 step 5（rename 完成）之後執行，否則 FK 對不上新 `behaviors.id`。

```sql
-- step 5 完成：behaviors_v2 已 rename 為 behaviors；
--             behavior_sessions 已 rename 為 _archive_behavior_sessions；
--             behavior_sessions_v2 已 rename 為 behavior_sessions（空表）。
-- 此處用 legacyId 對齊舊 session FK 到新 behaviors.id：

INSERT INTO behavior_sessions (userId, behaviorId, channelId, startedAt, createdAt, updatedAt)
SELECT bs.userId, b_new.id, bs.channelId, bs.startedAt, bs.createdAt, bs.updatedAt
FROM _archive_behavior_sessions bs
JOIN behaviors b_new ON b_new.legacyId = bs.behaviorId;

-- M-11 修：orphan session fatal assertion，不靜默丟棄
-- 若 archive session 行數 ≠ INSERT 行數，迫使 backfill 完整：
SELECT COUNT(*) FROM _archive_behavior_sessions;
SELECT COUNT(*) FROM behavior_sessions;
-- 兩數不等 → throw fatal error，整個 migration rollback
```

### Case 8：`plugin_commands` 三軸 + description 從 manifest backfill

```sql
-- 應用層程式邏輯（讀 plugins.manifestJson 解析）：
-- for each row in plugin_commands:
--   plugin = plugins[row.pluginId]
--   manifest = JSON.parse(plugin.manifestJson)
--   if (row.featureKey IS NULL):
--       cmd = manifest.commands.find(c => c.name === row.name)
--   else:
--       feat = manifest.guild_features.find(f => f.key === row.featureKey)
--       cmd = feat?.commands?.find(c => c.name === row.name)
--   row.description       = cmd.description ?? row.name        -- 強制非空
--   row.scope             = cmd.scope ?? (row.guildId ? 'guild' : 'global')
--   row.integrationTypes  = sortJoin(cmd.integration_types ?? ['guild_install'])
--   row.contexts          = sortJoin(cmd.contexts ?? ['Guild'])
--   row.defaultMemberPermissions = cmd.default_member_permissions ?? null
--   row.defaultEphemeral  = cmd.default_ephemeral ? 1 : 0
--   row.requiredCapability = cmd.required_capability ?? null
--   row.adminEnabled      = 1
```

注意：v1 manifest 中 `commands[].description` 多數已存在；極少數為空字串的 row backfill 為 `name` 字串以滿足 v2 NOT NULL 語意。**M0-B 已宣告「v2 拒絕空 description」，但本 migration 跑時舊資料已落地，不可拒絕**，採「fallback to name」最保守方案。

---

## 4. 既有 `plugin_commands` 表處置

選擇：**沿用表名 + 擴欄**（見 §2）。**不**改名為 `plugin_slash_commands`。

| 維度 | 處置 |
|------|------|
| 表名 | 不變（`plugin_commands`） |
| 欄位 | `ALTER TABLE ADD COLUMN`（8 個新欄位，見 §2.2） |
| 既有 row | 依 manifest backfill 三軸 + description（見 case 8） |
| 軌一（featureKey IS NOT NULL）的 row | 維持，繼續被 `plugin_guild_features` 控制（軌一不動） |
| 軌三（featureKey IS NULL）的 row | 即新軌三 row；admin 可從 plugin admin UI 看到 + on/off（透過 `adminEnabled` 欄位） |

軌一 row 的 `adminEnabled` 仍寫 1，但 dispatcher 不讀此欄（軌一改由 `plugin_guild_features.enabled` 決定）。`adminEnabled` 對軌一 row 是「dead column」，文件需註明。

---

## 5. 回滾方案

### 5.1 Migration `down` 腳本

```sql
-- 反向順序：
-- 1) plugin_commands：DROP COLUMN（SQLite 需 rebuild 表）
CREATE TABLE plugin_commands_rollback AS
    SELECT id, pluginId, guildId, name, discordCommandId, featureKey, manifestJson,
           createdAt, updatedAt
    FROM plugin_commands;
DROP TABLE plugin_commands;
ALTER TABLE plugin_commands_rollback RENAME TO plugin_commands;
-- 索引重建...

-- 2) behaviors / behavior_sessions：rename 換回
DROP TABLE behavior_sessions;
ALTER TABLE _archive_behavior_sessions RENAME TO behavior_sessions;
DROP TABLE behaviors;
ALTER TABLE _archive_behaviors RENAME TO behaviors;

-- 3) behavior_targets / behavior_target_members：rename 換回
ALTER TABLE _archive_behavior_targets RENAME TO behavior_targets;
ALTER TABLE _archive_behavior_target_members RENAME TO behavior_target_members;

-- 4) DROP behavior_audience_members
DROP TABLE behavior_audience_members;
```

### 5.2 資料保真檢查表

| 資料 | up 後保真度 | down 後保真度 | 不可還原點 |
|------|-------------|---------------|-------------|
| 舊 `behaviors`（type='system'）3 row | 完全保留（systemKey 直接攜帶舊 pluginBehaviorKey） | 完全還原（archive 表保留全部欄位含舊 webhookUrl placeholder） | 無 |
| 舊 `behaviors`（type='webhook'+slash） | 完全保留（slashCommandName/Description+三軸） | 完全還原（archive） | 無 |
| 舊 `behaviors`（type='webhook'+pattern） | 完全保留（messagePatternKind/Value） | 完全還原（archive） | 無 |
| 舊 `behaviors`（type='plugin'） | 完全保留（pluginId+pluginBehaviorKey） | 完全還原（archive） | 無 |
| 舊 `behavior_targets` 全表 | 內容欄位化進 behaviors_v2.audience*；表本身 archive | rename 回原表 | 無（archive 完整） |
| 舊 `behavior_target_members` 全表 | 內容複製進 behavior_audience_members；表本身 archive | rename 回原表 | 無（archive 完整） |
| 舊 `behavior_sessions` | 透過 legacyId 重映射；少數 orphan session 丟棄 | archive 回原表 | **被丟棄的 orphan session**（極少；應 log 數量） |
| `plugin_commands` 既有 row | 完全保留 + 擴欄填值 | rebuild rollback 保留原欄位；新欄位資料喪失 | 新欄位的 admin 修改在 down 後喪失（M0 期 admin 不會主動改新欄位，故零實質影響） |
| `plugin_guild_features` 全表 | **不動** | **不動** | — |
| `bot_feature_state` 全表 | **不動** | **不動** | — |

### 5.3 不可逆點明列

| 不可逆點 | 影響 | 緩解 |
|---------|------|------|
| down 後 `plugin_commands` 新欄位喪失 | admin 對 `description` 等的修改丟失 | M0 階段 admin UI 不允許修改這些欄位（只 on/off `adminEnabled`），實質零影響 |
| up 中 orphan `behavior_sessions` 行被丟棄 | 該 user 重啟後 continuous session 失效 | up 前 log 出受影響 userId；UI 通知 admin |
| 加密 envelope 不變 | 舊 v2 envelope row 直接搬，無重加密 | 無風險 |

### 5.4 是否「可重跑（idempotent）」

**不完全可重跑**。本 migration 為破壞性 rename，重跑會失敗（`behaviors_v2` 已存在 / `behaviors` 已不在）。每個 step 都應加 `IF NOT EXISTS` / `IF EXISTS` 保護，但 rename 步驟若中斷在中段需要人工介入。**建議**：用一個 transaction 包整段 up（SQLite 支援 schema-DDL transaction），失敗自動回滾。

---

## 6. Migration 排程（多檔組織建議）

依照「單一職責 + 可獨立 rollback」原則切 7 檔（CR-7 加第 6/7 個 migration），依序執行：

| 序 | 檔名 | 職責 |
|----|------|------|
| 1 | `20260501010000-behaviors-v2-rebuild.ts` | rebuild `behaviors` 表（建 v2 含 webhookAuthMode/legacyId → backfill case 1～4 → rename 換手） |
| 2 | `20260501020000-behavior-audience-members.ts` | 建 `behavior_audience_members`（case 6，用 legacyId 對齊） |
| 3 | `20260501030000-behavior-sessions-v2-relink.ts` | rebuild `behavior_sessions` FK → 新 behaviors（case 7，**rename 後執行**，orphan fatal） |
| 4 | `20260501040000-archive-legacy-behavior-targets.ts` | rename `behavior_targets` / `behavior_target_members` 為 `_archive_*`（case 5） |
| 5 | `20260501050000-plugin-commands-tri-axis.ts` | `plugin_commands` ADD COLUMN × 8 + manifest backfill（case 8，軌一 scope 從 manifest 讀） |
| 6 | `20260501060000-reconciler-owned-commands.ts` | **CR-7 新增**：建 `reconciler_owned_commands(name TEXT, scope TEXT, guildId TEXT NULL, ownedAt DATETIME)`，UNIQUE(name, scope, guildId)。M0-C `CommandReconciler` 管理名冊持久化所需 |
| 7 | `20260501070000-drop-behavior-legacy-id.ts` | **CR-7 新增**：DROP `behaviors.legacyId` 欄位（SQLite rebuild）。確認 case 6/7 完成後執行 |

每檔：
- 都有對應 `down`（rebuild 1/7 是 SQLite drop column rebuild；2/3/6 是 drop table；4/5 是 rename / drop column）。
- 都用 `BEGIN; ... COMMIT;` 包住 DDL + DML，失敗自動回滾。
- 都先 `showAllTables` 檢查前置條件，缺前置直接 throw（不會把表寫到半完成狀態）。
- 1～5 必須照序執行（互相依賴）；6 獨立可單跑；7 必須在 case 6/7 backfill 完成後跑（即 1～5 全綠後）。

命名節奏對齊既有 `src/migrations/YYYYMMDDHHMMSS-*.ts`（最近 3 檔均使用 UTC 整點時間）。

---

## 7. 重要設計風險答案（拍板）

### R-1：三軸 9 種組合的非法子集

**拍板**：用 **CHECK constraint**（DDL §1.2 invariant I-3）+ **應用層 validateManifest（B-sdk.md V-C1/V-C2）** 雙層阻擋。

理由：
- DB CHECK 是最後一道防線（不依賴應用程式正確），破壞 invariant 直接拒絕 INSERT。
- SQLite 對字串 LIKE 的 CHECK 表達能力夠用（不像 PostgreSQL 需要 array contains）。
- 應用層 validate 給更友善錯誤訊息（CHECK 失敗只回 "constraint failed"，使用者需要可讀錯誤）。
- system source row 豁免（dispatcher 自己控制三軸）；admin/plugin source row 強制檢查。

### R-2：`behavior_sessions` 去留

**拍板**：**保留**（PK=userId 單活躍 session 設計沿用）。

理由：
- continuous session 是核心產品功能（`/break` 結束、訊息接管），不能砍。
- `forwardType='continuous'` 仍是 dispatcher 行為決策的一環（`webhook-behavior.events.ts`）。
- 「user 不能同時跑兩條 continuous」的限制是當前產品 UX；放寬到複合鍵屬於 M1+ 範圍。
- 唯一的修補：rebuild `behaviors` 後 FK 重連到新 id（case 7 處理）。

---

## 8. 對其他子任務的硬依賴 / 對齊點

| 對齊點 | 對方 | 依賴方向 | 內容 |
|--------|------|---------|------|
| 三軸欄位名稱（`scope` / `integrationTypes` / `contexts`） | M0-B（B-sdk.md） | A ↔ B 雙向 | 命名、列舉值集合與 manifest 一致；comma-joined 字串為 DB 內表示，API 層轉陣列回 frontend |
| `behaviors[].systemKey` 列舉 (`'admin-login','manual','break'`) | M0-C | A → C | C（system behavior 遷移）若新增 systemKey 必須先擴 A 的 CHECK constraint；目前 hardcode 三值 |
| `plugin_commands.description` NOT NULL 強制 | M0-B（V-05） | B → A | M0-B 在 manifest 端強制 description 非空；A 在 backfill 時對舊空值 fallback to `name` |
| `behaviors[].audienceKind / audienceUserId / audienceGroupName` 欄位名稱 | M0-D（admin UI behaviors 管理頁） | A → D | D 必須對齊 A 的欄位名稱繪製 audience 編輯 UI（替代舊 BehaviorTarget 側邊欄） |
| `plugin_commands.adminEnabled` | M0-D | A → D | D 在 plugin admin 詳情頁讀此欄畫 on/off toggle |
| `endpoints.plugin_command` RPC 路由 | M0-B | B → A | B 已定義；A 不需處理（不在 schema 範圍） |
| `behaviors[].webhookUrl` 加密 envelope | 既有 `encryption-v2-uplift` | 無 | v2 envelope 沿用，backfill 不需重加密 |
| 軌一表（`bot_feature_state` / `plugin_guild_features`） | 軌一既有實作 | 無 | 完全不動，不需對齊 |

---

## 9. 待 M1+ 處理的尾款（M0 不做）

| 編號 | 項目 | 原因 |
|------|------|------|
| FU-1 | DROP `_archive_behaviors` / `_archive_behavior_targets` / `_archive_behavior_target_members` / `_archive_behavior_sessions` | 等 30 天觀察 + 確認無回滾需求 |
| FU-2 | `behavior_sessions` PK 換複合鍵（多重 continuous session） | 產品需求未明 |
| FU-3 | `plugin_commands` 表名改為 `plugin_slash_commands` | 觸動讀寫者太多，本次先擴欄；改名單獨拆檔 |
| FU-4 | DROP `plugin_commands.featureKey` | 軌一獨立成新表後再做；本次不動軌一 |
| FU-5 | `behavior_audience_members` 改用 normalize group 表 | 觀察 group 表大小後再決策 |

---

## 附錄 A：欄位 ↔ 來源完整對照（給實作的 cheat sheet）

| 新 `behaviors_v2` 欄位 | source='system' | source='custom' | source='plugin' |
|------------|------------|------------|------------|
| `title` | OLD.title | OLD.title | OLD.title |
| `description` | OLD.description | OLD.description | OLD.description |
| `enabled` / `sortOrder` / `stopOnMatch` / `forwardType` | OLD.* | OLD.* | OLD.* |
| `triggerType` | 'slash_command' | OLD（slash_command 或 message_pattern） | OLD（同左） |
| `source` | 'system' | **'custom'** ← CR-9 覆寫 | 'plugin' |
| `slashCommandName` | OLD.triggerValue | OLD.triggerValue (when slash) | OLD.triggerValue (when slash) |
| `slashCommandDescription` | NULL | OLD.title | OLD.title |
| `messagePatternKind/Value` | NULL | OLD.triggerType / triggerValue (when pattern) | 同左 |
| `scope` | 'global' | 'global'（admin 之後可改） | 'global' |
| `integrationTypes` | 'guild_install' | 視 trigger 型而定（slash: 'guild_install'；pattern: 'guild_install,user_install'） | 同左 |
| `contexts` | 'BotDM,PrivateChannel' | 同左規則 | 'BotDM,PrivateChannel' |
| `audienceKind/UserId/GroupName` | 'all'/NULL/NULL | 從 behavior_targets join 取 | 從 behavior_targets join 取 |
| `webhookUrl` / `webhookSecret` | NULL / NULL | OLD.webhookUrl / OLD.webhookSecret | NULL / NULL |
| `webhookAuthMode` | NULL | (webhookSecret 有→'hmac'；無→NULL) | NULL（除非 admin 後續設定）|
| `legacyId` | OLD.id | OLD.id | OLD.id |
| `pluginId` / `pluginBehaviorKey` | NULL / NULL | NULL / NULL | OLD.pluginId / OLD.pluginBehaviorKey |
| `systemKey` | OLD.pluginBehaviorKey | NULL | NULL |
| `placementGuildId/ChannelId` | NULL / NULL | NULL / NULL（admin 之後可填） | NULL / NULL（admin 之後可填） |

---

## 附錄 B：欄位命名對照（v1 → v2，給其他子任務用）

| v1 | v2 | 備註 |
|----|----|------|
| `behaviors.type` ∈ {webhook,plugin,system} | `behaviors.source` ∈ {custom,plugin,system} | 詞彙更清楚（type 太泛）；`webhook` 改名為 `custom`（CR-9 覆寫） |
| `behaviors.targetId` | `behaviors.audienceKind` + `audienceUserId` + `audienceGroupName` | 攤平 |
| `behaviors.triggerType` ∈ {startswith,endswith,regex,slash_command} | `behaviors.triggerType` ∈ {message_pattern, slash_command} + `messagePatternKind` ∈ {startswith,endswith,regex} | 拆兩階 |
| `behaviors.triggerValue` | `behaviors.slashCommandName` 或 `behaviors.messagePatternValue` | 拆欄 |
| `behaviors.pluginBehaviorKey`（兼任 system key） | `behaviors.pluginBehaviorKey`（只給 plugin） + `behaviors.systemKey`（只給 system） | 不再雙用 |
| `behavior_targets` | （廢棄；資訊內聯到 behaviors） | archive |
| `behavior_target_members` | `behavior_audience_members`（FK 直接到 behaviors） | rename + 重 schema |
| `plugin_commands` | `plugin_commands`（不改名）+ 8 個新欄位 | 擴欄 |
