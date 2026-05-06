import type { Migration } from "./runner.js";

/**
 * M1-A1 — behaviors 表 v2 破壞性重建（指令架構 v2，破壞性遷移路線）
 *
 * 策略：無 backfill、無 archive、無 legacyId。直接丟棄 v1 資料，建立全新 v2 schema。
 * plugin 功能未上線，舊 behavior 資料可安全丟棄。
 *
 * 步驟（up）：
 *   PRAGMA foreign_keys = OFF（在 transaction 外，SQLite 在 transaction 內忽略此 PRAGMA）
 *   transaction：
 *     1. DROP TABLE IF EXISTS behavior_sessions
 *     2. DROP TABLE IF EXISTS behavior_target_members
 *     3. DROP TABLE IF EXISTS behavior_targets
 *     4. DROP TABLE IF EXISTS behaviors
 *     5. CREATE TABLE behaviors（v2 schema，7 invariant，8 索引）
 *     6. CREATE TABLE behavior_audience_members（FK 指向 behaviors，ON DELETE CASCADE）
 *     7. CREATE TABLE behavior_sessions（PK userId，FK behaviorId 指向 behaviors，ON DELETE CASCADE）
 *   PRAGMA foreign_keys = ON
 *   PRAGMA foreign_key_check（驗證無 dangling FK）
 *
 * 步驟（down）：
 *   對稱 DROP + CREATE 三張表（v2 schema）
 *   注意：down 後 bot 仍使用 v2 model，v1 結構不還原。
 *
 * slashCommandName CHECK 修正（critic NEW-M3）：
 *   使用 NOT GLOB '*[^a-z0-9_-]*' 取代舊版寫法。
 *   SQLite GLOB 中 [^...] 為 NOT-in-set，整串字元全部符合 [a-z0-9_-] 時才通過。
 *
 * DDL 索引：共 8 條（無 legacyId UNIQUE，因破壞性遷移不需 backfill 對映）
 */

const migration: Migration = {
  up: async ({ queryInterface }) => {
    // PRAGMA foreign_keys 必須在 transaction 外設定；
    // SQLite 在 transaction 內忽略此 PRAGMA 的切換。
    await queryInterface.sequelize.query("PRAGMA foreign_keys = OFF;");

    try {
      await queryInterface.sequelize.transaction(async (t) => {
        // Step 1-4：DROP 舊表（破壞性，v1 資料不保留）
        await queryInterface.sequelize.query(
          "DROP TABLE IF EXISTS behavior_sessions;",
          { transaction: t },
        );
        await queryInterface.sequelize.query(
          "DROP TABLE IF EXISTS behavior_target_members;",
          { transaction: t },
        );
        await queryInterface.sequelize.query(
          "DROP TABLE IF EXISTS behavior_targets;",
          { transaction: t },
        );
        await queryInterface.sequelize.query(
          "DROP TABLE IF EXISTS behaviors;",
          { transaction: t },
        );

        // Step 5：CREATE TABLE behaviors（v2 schema）
        await queryInterface.sequelize.query(
          `
          CREATE TABLE behaviors (
              id                       INTEGER  PRIMARY KEY AUTOINCREMENT,

              -- 基本元資料
              title                    TEXT     NOT NULL,
              description              TEXT     NOT NULL DEFAULT '',
              enabled                  INTEGER  NOT NULL DEFAULT 1,
              sortOrder                INTEGER  NOT NULL DEFAULT 0,
              stopOnMatch              INTEGER  NOT NULL DEFAULT 0,
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
              -- slashCommandName CHECK（critic NEW-M3 修正）：
              --   NOT GLOB '*[^a-z0-9_-]*' 確保字元集合；1~32 長度；全小寫
              slashCommandName         TEXT     NULL
                                       CHECK (slashCommandName IS NULL
                                           OR (LENGTH(slashCommandName) BETWEEN 1 AND 32
                                               AND slashCommandName NOT GLOB '*[^a-z0-9_-]*'
                                               AND slashCommandName = LOWER(slashCommandName))),
              slashCommandDescription  TEXT     NULL,

              -- 三軸（admin 可控；source='system' 寫死；source='plugin' 沿用 manifest hint）
              -- integrationTypes：lexicographically-sorted comma-joined，例 'guild_install,user_install'
              -- contexts：lexicographically-sorted comma-joined，例 'BotDM,PrivateChannel'
              scope                    TEXT     NOT NULL DEFAULT 'global'
                                       CHECK (scope IN ('global','guild')),
              integrationTypes         TEXT     NOT NULL DEFAULT 'guild_install',
              contexts                 TEXT     NOT NULL DEFAULT 'Guild',

              -- placement（scope='guild' 時可選綁定到特定 guild + channel）
              placementGuildId         TEXT     NULL,
              placementChannelId       TEXT     NULL,

              -- audience（取代舊 behavior_targets 的關聯模型）
              audienceKind             TEXT     NOT NULL DEFAULT 'all'
                                       CHECK (audienceKind IN ('all','user','group')),
              audienceUserId           TEXT     NULL,
              audienceGroupName        TEXT     NULL,

              -- source-specific：custom（webhook URL/secret，加密 v2 envelope）
              webhookUrl               TEXT     NULL,
              webhookSecret            TEXT     NULL,
              -- CR-6：簽署模式（webhookSecret IS NOT NULL 時必填）
              webhookAuthMode          TEXT     NULL
                                       CHECK (webhookAuthMode IS NULL
                                           OR webhookAuthMode IN ('token','hmac')),

              -- source-specific：plugin
              pluginId                 INTEGER  NULL REFERENCES plugins(id) ON DELETE CASCADE,
              pluginBehaviorKey        TEXT     NULL,

              -- source-specific：system
              systemKey                TEXT     NULL
                                       CHECK (systemKey IS NULL
                                           OR systemKey IN ('admin-login','manual','break')),

              createdAt                DATETIME NOT NULL,
              updatedAt                DATETIME NOT NULL,

              -- ── 跨欄位 invariant（7 個 CHECK constraint）──────────────────────
              -- I-1: triggerType ↔ messagePatternKind/Value/slashCommandName 對應
              CHECK (
                  (triggerType = 'message_pattern' AND messagePatternKind IS NOT NULL
                                                    AND messagePatternValue IS NOT NULL
                                                    AND slashCommandName IS NULL)
               OR (triggerType = 'slash_command'   AND slashCommandName IS NOT NULL
                                                    AND messagePatternKind IS NULL
                                                    AND messagePatternValue IS NULL)
              ),
              -- I-2 (CR-6): source ↔ webhookUrl/pluginId/systemKey/pluginBehaviorKey 對應
              --   source='custom'  ↔ webhookUrl NOT NULL；pluginId/systemKey/pluginBehaviorKey NULL
              --   source='plugin'  ↔ pluginId NOT NULL, pluginBehaviorKey NOT NULL,
              --                      webhookUrl NULL, systemKey NULL
              --                      （webhookSecret 可 NULL 或 NOT NULL）
              --   source='system'  ↔ systemKey NOT NULL；
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
              -- I-2b (CR-6): webhookAuthMode ↔ webhookSecret 對應規則
              CHECK (
                  (webhookSecret IS NULL     AND webhookAuthMode IS NULL)
               OR (webhookSecret IS NOT NULL AND webhookAuthMode IS NOT NULL
                                             AND source != 'system')
              ),
              -- I-3: 三軸非法組合（source='system' 豁免）
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
              -- I-4: audienceKind ↔ audienceUserId/audienceGroupName 對應
              CHECK (
                  (audienceKind = 'all'   AND audienceUserId IS NULL AND audienceGroupName IS NULL)
               OR (audienceKind = 'user'  AND audienceUserId IS NOT NULL AND audienceGroupName IS NULL)
               OR (audienceKind = 'group' AND audienceGroupName IS NOT NULL AND audienceUserId IS NULL)
              ),
              -- I-5: placement 兩欄要嘛全 NULL，要嘛 placementGuildId NOT NULL
              CHECK (
                  (placementGuildId IS NULL AND placementChannelId IS NULL)
               OR (placementGuildId IS NOT NULL)
              ),
              -- I-6 (critic H-10): placementGuildId IS NOT NULL → scope='guild'
              CHECK (
                  placementGuildId IS NULL OR scope = 'guild'
              ),
              -- I-7 (critic C-2): triggerType='message_pattern' → contexts NOT LIKE '%Guild%'
              CHECK (
                  triggerType = 'slash_command'
               OR (triggerType = 'message_pattern' AND contexts NOT LIKE '%Guild%')
              )
          );
          `,
          { transaction: t },
        );

        // Step 5 索引（8 條，無 legacyId UNIQUE）
        await queryInterface.sequelize.query(
          `CREATE UNIQUE INDEX behaviors_system_uq
               ON behaviors(systemKey) WHERE source = 'system';`,
          { transaction: t },
        );
        await queryInterface.sequelize.query(
          `CREATE UNIQUE INDEX behaviors_plugin_uq
               ON behaviors(pluginId, pluginBehaviorKey) WHERE source = 'plugin';`,
          { transaction: t },
        );
        await queryInterface.sequelize.query(
          `CREATE INDEX behaviors_dispatch_idx
               ON behaviors(triggerType, enabled, scope, sortOrder);`,
          { transaction: t },
        );
        await queryInterface.sequelize.query(
          `CREATE INDEX behaviors_audience_user_idx
               ON behaviors(audienceUserId) WHERE audienceKind = 'user';`,
          { transaction: t },
        );
        await queryInterface.sequelize.query(
          `CREATE INDEX behaviors_audience_group_idx
               ON behaviors(audienceGroupName) WHERE audienceKind = 'group';`,
          { transaction: t },
        );
        await queryInterface.sequelize.query(
          `CREATE INDEX behaviors_plugin_idx
               ON behaviors(pluginId) WHERE source = 'plugin';`,
          { transaction: t },
        );
        await queryInterface.sequelize.query(
          `CREATE INDEX behaviors_placement_idx
               ON behaviors(placementGuildId, placementChannelId)
               WHERE placementGuildId IS NOT NULL;`,
          { transaction: t },
        );
        await queryInterface.sequelize.query(
          `CREATE UNIQUE INDEX behaviors_slash_uq
               ON behaviors(slashCommandName, scope, contexts)
               WHERE triggerType = 'slash_command' AND enabled = 1;`,
          { transaction: t },
        );

        // Step 6：CREATE TABLE behavior_audience_members
        await queryInterface.sequelize.query(
          `
          CREATE TABLE behavior_audience_members (
              behaviorId   INTEGER  NOT NULL,
              userId       TEXT     NOT NULL,
              createdAt    DATETIME NOT NULL,
              updatedAt    DATETIME NOT NULL,
              PRIMARY KEY (behaviorId, userId),
              FOREIGN KEY (behaviorId) REFERENCES behaviors(id)
                  ON DELETE CASCADE ON UPDATE CASCADE
          );
          `,
          { transaction: t },
        );
        await queryInterface.sequelize.query(
          `CREATE INDEX behavior_audience_members_user_idx
               ON behavior_audience_members(userId);`,
          { transaction: t },
        );

        // Step 7：CREATE TABLE behavior_sessions
        await queryInterface.sequelize.query(
          `
          CREATE TABLE behavior_sessions (
              userId       TEXT     PRIMARY KEY,
              behaviorId   INTEGER  NOT NULL,
              channelId    TEXT     NOT NULL,
              startedAt    DATETIME NOT NULL,
              createdAt    DATETIME NOT NULL,
              updatedAt    DATETIME NOT NULL,
              FOREIGN KEY (behaviorId) REFERENCES behaviors(id)
                  ON DELETE CASCADE ON UPDATE CASCADE
          );
          `,
          { transaction: t },
        );
        await queryInterface.sequelize.query(
          `CREATE INDEX behavior_sessions_behavior_idx
               ON behavior_sessions(behaviorId);`,
          { transaction: t },
        );
      }); // end transaction
    } finally {
      await queryInterface.sequelize.query("PRAGMA foreign_keys = ON;");
    }

    // transaction 外：驗證無 dangling FK
    await queryInterface.sequelize.query("PRAGMA foreign_key_check;");
  },

  down: async ({ queryInterface }) => {
    // down：對稱重建（v2 schema）。
    // 注意：down 後 bot 仍使用 v2 model；v1 schema 不還原。
    // 下一次 up 需要先手動確認環境，或重跑 migration。
    await queryInterface.sequelize.query("PRAGMA foreign_keys = OFF;");

    try {
      await queryInterface.sequelize.transaction(async (t) => {
        await queryInterface.sequelize.query(
          "DROP TABLE IF EXISTS behavior_sessions;",
          { transaction: t },
        );
        await queryInterface.sequelize.query(
          "DROP TABLE IF EXISTS behavior_audience_members;",
          { transaction: t },
        );
        await queryInterface.sequelize.query(
          "DROP TABLE IF EXISTS behaviors;",
          { transaction: t },
        );
      });
    } finally {
      await queryInterface.sequelize.query("PRAGMA foreign_keys = ON;");
    }
  },
};

export default migration;
