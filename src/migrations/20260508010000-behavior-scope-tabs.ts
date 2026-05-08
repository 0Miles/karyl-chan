/**
 * 20260508010000-behavior-scope-tabs
 *
 * Introduces behavior_scope_tabs — a first-class entity representing
 * where a behavior operates on Discord (three-axis scope + placement +
 * audience, unified into a single sidebar tab concept).
 *
 * Steps:
 *   1. CREATE TABLE behavior_scope_tabs (8 tab types, CHECK invariant)
 *   2. 5 partial-UNIQUE indexes (one per tab type family)
 *   3. Seed 4 fixed tabs (global_all=1, all_dms=2, all_bot_dms=3, all_guilds=4)
 *   4. ALTER TABLE behaviors ADD COLUMN scopeTabId INTEGER NOT NULL DEFAULT 1
 *   5. Create dynamic tabs from existing behavior data
 *   6. Backfill scopeTabId on all existing behaviors
 *   7. Index on behaviors(scopeTabId)
 *
 * down: DROP TABLE behavior_scope_tabs (column left on behaviors —
 * SQLite ALTER TABLE DROP COLUMN is unsafe with existing CHECK constraints).
 */

import type { Migration } from "./runner.js";

const migration: Migration = {
  up: async ({ queryInterface }) => {
    await queryInterface.sequelize.transaction(async (t) => {
      const q = (sql: string) =>
        queryInterface.sequelize.query(sql, { transaction: t });

      // ── 1. Create table ────────────────────────────────────────────────
      await q(`
        CREATE TABLE IF NOT EXISTS behavior_scope_tabs (
            id          INTEGER  PRIMARY KEY AUTOINCREMENT,
            tabType     TEXT     NOT NULL
                        CHECK (tabType IN (
                          'global_all','all_dms','all_bot_dms','all_guilds',
                          'specific_guild','specific_channel',
                          'specific_user','specific_group'
                        )),
            label       TEXT     NOT NULL DEFAULT '',
            isFixed     INTEGER  NOT NULL DEFAULT 0,
            guildId     TEXT     NULL,
            channelId   TEXT     NULL,
            userId      TEXT     NULL,
            groupName   TEXT     NULL,
            sortOrder   INTEGER  NOT NULL DEFAULT 0,
            createdAt   DATETIME NOT NULL,
            updatedAt   DATETIME NOT NULL,

            CHECK (
                (tabType IN ('global_all','all_dms','all_bot_dms','all_guilds')
                 AND isFixed = 1
                 AND guildId IS NULL AND channelId IS NULL
                 AND userId IS NULL AND groupName IS NULL)
             OR (tabType = 'specific_guild' AND isFixed = 0
                 AND guildId IS NOT NULL AND channelId IS NULL
                 AND userId IS NULL AND groupName IS NULL)
             OR (tabType = 'specific_channel' AND isFixed = 0
                 AND guildId IS NOT NULL AND channelId IS NOT NULL
                 AND userId IS NULL AND groupName IS NULL)
             OR (tabType = 'specific_user' AND isFixed = 0
                 AND guildId IS NULL AND channelId IS NULL
                 AND userId IS NOT NULL AND groupName IS NULL)
             OR (tabType = 'specific_group' AND isFixed = 0
                 AND guildId IS NULL AND channelId IS NULL
                 AND userId IS NULL AND groupName IS NOT NULL)
            )
        );
      `);

      // ── 2. Unique indexes ──────────────────────────────────────────────
      await q(`CREATE UNIQUE INDEX IF NOT EXISTS scope_tab_fixed_uq
               ON behavior_scope_tabs(tabType) WHERE isFixed = 1;`);
      await q(`CREATE UNIQUE INDEX IF NOT EXISTS scope_tab_guild_uq
               ON behavior_scope_tabs(tabType, guildId) WHERE tabType = 'specific_guild';`);
      await q(`CREATE UNIQUE INDEX IF NOT EXISTS scope_tab_channel_uq
               ON behavior_scope_tabs(tabType, guildId, channelId) WHERE tabType = 'specific_channel';`);
      await q(`CREATE UNIQUE INDEX IF NOT EXISTS scope_tab_user_uq
               ON behavior_scope_tabs(tabType, userId) WHERE tabType = 'specific_user';`);
      await q(`CREATE UNIQUE INDEX IF NOT EXISTS scope_tab_group_uq
               ON behavior_scope_tabs(tabType, groupName) WHERE tabType = 'specific_group';`);

      // ── 3. Seed fixed tabs (IDs 1–4) ──────────────────────────────────
      await q(`INSERT OR IGNORE INTO behavior_scope_tabs
               (id, tabType, label, isFixed, sortOrder, createdAt, updatedAt)
               VALUES (1, 'global_all',  'All Scope',   1, 0, datetime('now'), datetime('now'));`);
      await q(`INSERT OR IGNORE INTO behavior_scope_tabs
               (id, tabType, label, isFixed, sortOrder, createdAt, updatedAt)
               VALUES (2, 'all_dms',     'All DMs',     1, 1, datetime('now'), datetime('now'));`);
      await q(`INSERT OR IGNORE INTO behavior_scope_tabs
               (id, tabType, label, isFixed, sortOrder, createdAt, updatedAt)
               VALUES (3, 'all_bot_dms', 'All Bot DMs', 1, 2, datetime('now'), datetime('now'));`);
      await q(`INSERT OR IGNORE INTO behavior_scope_tabs
               (id, tabType, label, isFixed, sortOrder, createdAt, updatedAt)
               VALUES (4, 'all_guilds',  'All Guilds',  1, 3, datetime('now'), datetime('now'));`);

      // ── 4. Add scopeTabId to behaviors ─────────────────────────────────
      const [cols] = await queryInterface.sequelize.query(
        "PRAGMA table_info(behaviors);",
        { transaction: t },
      );
      const hasColumn = (cols as Array<{ name: string }>).some(
        (c) => c.name === "scopeTabId",
      );
      if (!hasColumn) {
        await q(
          "ALTER TABLE behaviors ADD COLUMN scopeTabId INTEGER NOT NULL DEFAULT 1;",
        );
      }

      // ── 5. Create dynamic tabs from existing behaviors ─────────────────
      await q(`INSERT OR IGNORE INTO behavior_scope_tabs
               (tabType, label, isFixed, guildId, sortOrder, createdAt, updatedAt)
               SELECT DISTINCT 'specific_guild', placementGuildId, 0,
                      placementGuildId, 100, datetime('now'), datetime('now')
               FROM behaviors
               WHERE scope = 'guild' AND placementGuildId IS NOT NULL
                 AND placementChannelId IS NULL AND audienceKind = 'all';`);

      await q(`INSERT OR IGNORE INTO behavior_scope_tabs
               (tabType, label, isFixed, guildId, channelId, sortOrder, createdAt, updatedAt)
               SELECT DISTINCT 'specific_channel',
                      placementGuildId || ':' || placementChannelId, 0,
                      placementGuildId, placementChannelId, 100,
                      datetime('now'), datetime('now')
               FROM behaviors
               WHERE scope = 'guild' AND placementGuildId IS NOT NULL
                 AND placementChannelId IS NOT NULL AND audienceKind = 'all';`);

      await q(`INSERT OR IGNORE INTO behavior_scope_tabs
               (tabType, label, isFixed, userId, sortOrder, createdAt, updatedAt)
               SELECT DISTINCT 'specific_user', audienceUserId, 0,
                      audienceUserId, 100, datetime('now'), datetime('now')
               FROM behaviors
               WHERE audienceKind = 'user' AND audienceUserId IS NOT NULL;`);

      await q(`INSERT OR IGNORE INTO behavior_scope_tabs
               (tabType, label, isFixed, groupName, sortOrder, createdAt, updatedAt)
               SELECT DISTINCT 'specific_group', audienceGroupName, 0,
                      audienceGroupName, 100, datetime('now'), datetime('now')
               FROM behaviors
               WHERE audienceKind = 'group' AND audienceGroupName IS NOT NULL;`);

      // ── 6. Backfill scopeTabId ─────────────────────────────────────────
      // Dynamic tabs first (subquery resolves the auto-generated IDs)
      await q(`UPDATE behaviors SET scopeTabId = (
                 SELECT id FROM behavior_scope_tabs
                 WHERE tabType = 'specific_user' AND userId = behaviors.audienceUserId
               )
               WHERE audienceKind = 'user' AND audienceUserId IS NOT NULL
                 AND EXISTS (SELECT 1 FROM behavior_scope_tabs
                             WHERE tabType = 'specific_user'
                               AND userId = behaviors.audienceUserId);`);

      await q(`UPDATE behaviors SET scopeTabId = (
                 SELECT id FROM behavior_scope_tabs
                 WHERE tabType = 'specific_group'
                   AND groupName = behaviors.audienceGroupName
               )
               WHERE audienceKind = 'group' AND audienceGroupName IS NOT NULL
                 AND EXISTS (SELECT 1 FROM behavior_scope_tabs
                             WHERE tabType = 'specific_group'
                               AND groupName = behaviors.audienceGroupName);`);

      await q(`UPDATE behaviors SET scopeTabId = (
                 SELECT id FROM behavior_scope_tabs
                 WHERE tabType = 'specific_guild'
                   AND guildId = behaviors.placementGuildId
               )
               WHERE scope = 'guild' AND placementGuildId IS NOT NULL
                 AND placementChannelId IS NULL AND audienceKind = 'all'
                 AND EXISTS (SELECT 1 FROM behavior_scope_tabs
                             WHERE tabType = 'specific_guild'
                               AND guildId = behaviors.placementGuildId);`);

      await q(`UPDATE behaviors SET scopeTabId = (
                 SELECT id FROM behavior_scope_tabs
                 WHERE tabType = 'specific_channel'
                   AND guildId = behaviors.placementGuildId
                   AND channelId = behaviors.placementChannelId
               )
               WHERE scope = 'guild' AND placementGuildId IS NOT NULL
                 AND placementChannelId IS NOT NULL AND audienceKind = 'all'
                 AND EXISTS (SELECT 1 FROM behavior_scope_tabs
                             WHERE tabType = 'specific_channel'
                               AND guildId = behaviors.placementGuildId
                               AND channelId = behaviors.placementChannelId);`);

      // Fixed tabs (order matters: most-specific first so less-specific
      // only catches remainders with scopeTabId still at default 1)
      // BotDM only → all_bot_dms (3)
      await q(`UPDATE behaviors SET scopeTabId = 3
               WHERE scopeTabId = 1 AND scope = 'global'
                 AND contexts = 'BotDM' AND audienceKind = 'all';`);
      // DMs (BotDM/PrivateChannel, no Guild) → all_dms (2)
      await q(`UPDATE behaviors SET scopeTabId = 2
               WHERE scopeTabId = 1 AND scope = 'global'
                 AND (contexts LIKE '%BotDM%' OR contexts LIKE '%PrivateChannel%')
                 AND contexts NOT LIKE '%Guild%'
                 AND audienceKind = 'all';`);
      // scope=guild, no placement → all_guilds (4)
      await q(`UPDATE behaviors SET scopeTabId = 4
               WHERE scopeTabId = 1 AND scope = 'guild'
                 AND placementGuildId IS NULL AND audienceKind = 'all';`);
      // Everything else stays at 1 (global_all)

      // ── 7. Index ───────────────────────────────────────────────────────
      await q(
        `CREATE INDEX IF NOT EXISTS behaviors_scope_tab_idx ON behaviors(scopeTabId);`,
      );
    });
  },

  down: async ({ queryInterface }) => {
    await queryInterface.sequelize.query(
      "DROP TABLE IF EXISTS behavior_scope_tabs;",
    );
    // scopeTabId column left on behaviors — removing it requires
    // table rebuild due to existing CHECK constraints.
  },
};

export default migration;
