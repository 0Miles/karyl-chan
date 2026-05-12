import type { Migration } from "./runner.js";

/**
 * Remove the "plugin behaviors" mechanism entirely.
 *
 * A plugin no longer declares behavior webhook endpoints; the only way a
 * behavior reaches a plugin is the existing `source='custom'` behavior
 * with an operator-set webhook URL. So:
 *   - DROP TABLE plugin_behavior_overrides (the per-manifest-key toggle)
 *   - rebuild `behaviors`: drop `pluginId` / `pluginBehaviorKey`, narrow
 *     `source` to ('custom','system'), reduce the source↔fields CHECK to
 *     just custom/system, drop the two `source='plugin'` indexes
 *     (`behaviors_plugin_uq`, `behaviors_plugin_idx`). Existing
 *     `source='plugin'` rows are dropped — the "forward to plugin" admin
 *     picker has been reading the wrong manifest field (v1 `dm_behaviors`,
 *     not v2 `behaviors`) so it's been unusable for every v2 plugin; in
 *     practice there are none.
 *
 * SQLite can't drop a column referenced by a CHECK nor alter a CHECK, so
 * `behaviors` is rebuilt the standard way (foreign keys off → create new →
 * copy non-plugin rows → drop old → rename → recreate indexes). The child
 * tables (behavior_audience_members, behavior_sessions) keep their data;
 * their FK to `behaviors(id)` is carried over by the rename (modern
 * SQLite, legacy_alter_table OFF). Any orphaned child rows (which would
 * only exist if a now-dropped `source='plugin'` behavior had any) are
 * removed first so foreign_key_check stays clean.
 *
 * `down()` restores the columns / CHECK / indexes and re-creates
 * plugin_behavior_overrides (it cannot bring back any dropped rows).
 *
 * Mirrors the rebuild style of 20260501010000-behaviors-v2-rebuild.ts:
 * PRAGMA foreign_keys is toggled *outside* the transaction (SQLite ignores
 * the toggle inside one); the create/copy/drop/rename happens inside.
 */

const COMMON_INDEXES = [
  `CREATE UNIQUE INDEX behaviors_system_uq ON behaviors(systemKey) WHERE source = 'system';`,
  `CREATE INDEX behaviors_dispatch_idx ON behaviors(triggerType, enabled, scope, sortOrder);`,
  `CREATE INDEX behaviors_audience_user_idx ON behaviors(audienceUserId) WHERE audienceKind = 'user';`,
  `CREATE INDEX behaviors_audience_group_idx ON behaviors(audienceGroupName) WHERE audienceKind = 'group';`,
  `CREATE INDEX behaviors_placement_idx ON behaviors(placementGuildId, placementChannelId) WHERE placementGuildId IS NOT NULL;`,
  `CREATE UNIQUE INDEX behaviors_slash_uq ON behaviors(slashCommandName, scope, contexts) WHERE triggerType = 'slash_command' AND enabled = 1;`,
  `CREATE INDEX behaviors_scope_tab_idx ON behaviors(scopeTabId);`,
];
const PLUGIN_INDEXES = [
  `CREATE UNIQUE INDEX behaviors_plugin_uq ON behaviors(pluginId, pluginBehaviorKey) WHERE source = 'plugin';`,
  `CREATE INDEX behaviors_plugin_idx ON behaviors(pluginId) WHERE source = 'plugin';`,
];

/** New `behaviors` schema — no pluginId / pluginBehaviorKey, source ∈ (custom,system). */
const NEW_TABLE_DDL = `
CREATE TABLE behaviors (
    id                       INTEGER  PRIMARY KEY AUTOINCREMENT,
    title                    TEXT     NOT NULL,
    description              TEXT     NOT NULL DEFAULT '',
    enabled                  INTEGER  NOT NULL DEFAULT 1,
    sortOrder                INTEGER  NOT NULL DEFAULT 0,
    stopOnMatch              INTEGER  NOT NULL DEFAULT 0,
    forwardType              TEXT     NOT NULL DEFAULT 'one_time'
                             CHECK (forwardType IN ('one_time','continuous')),
    source                   TEXT     NOT NULL
                             CHECK (source IN ('custom','system')),
    triggerType              TEXT     NOT NULL
                             CHECK (triggerType IN ('slash_command','message_pattern')),
    messagePatternKind       TEXT     NULL
                             CHECK (messagePatternKind IS NULL
                                 OR messagePatternKind IN ('startswith','endswith','regex')),
    messagePatternValue      TEXT     NULL,
    slashCommandName         TEXT     NULL
                             CHECK (slashCommandName IS NULL
                                 OR (LENGTH(slashCommandName) BETWEEN 1 AND 32
                                     AND slashCommandName NOT GLOB '*[^a-z0-9_-]*'
                                     AND slashCommandName = LOWER(slashCommandName))),
    slashCommandDescription  TEXT     NULL,
    scope                    TEXT     NOT NULL DEFAULT 'global'
                             CHECK (scope IN ('global','guild')),
    integrationTypes         TEXT     NOT NULL DEFAULT 'guild_install',
    contexts                 TEXT     NOT NULL DEFAULT 'Guild',
    placementGuildId         TEXT     NULL,
    placementChannelId       TEXT     NULL,
    audienceKind             TEXT     NOT NULL DEFAULT 'all'
                             CHECK (audienceKind IN ('all','user','group')),
    audienceUserId           TEXT     NULL,
    audienceGroupName        TEXT     NULL,
    webhookUrl               TEXT     NULL,
    webhookSecret            TEXT     NULL,
    webhookAuthMode          TEXT     NULL
                             CHECK (webhookAuthMode IS NULL
                                 OR webhookAuthMode IN ('token','hmac')),
    systemKey                TEXT     NULL
                             CHECK (systemKey IS NULL
                                 OR systemKey IN ('admin-login','manual','break')),
    scopeTabId               INTEGER  NOT NULL DEFAULT 1,
    createdAt                DATETIME NOT NULL,
    updatedAt                DATETIME NOT NULL,

    CHECK (
        (triggerType = 'message_pattern' AND messagePatternKind IS NOT NULL
                                          AND messagePatternValue IS NOT NULL
                                          AND slashCommandName IS NULL)
     OR (triggerType = 'slash_command'   AND slashCommandName IS NOT NULL
                                          AND messagePatternKind IS NULL
                                          AND messagePatternValue IS NULL)
    ),
    CHECK (
        (source = 'custom' AND webhookUrl IS NOT NULL AND systemKey IS NULL)
     OR (source = 'system' AND systemKey IS NOT NULL
                           AND webhookUrl IS NULL AND webhookSecret IS NULL)
    ),
    CHECK (
        (webhookSecret IS NULL     AND webhookAuthMode IS NULL)
     OR (webhookSecret IS NOT NULL AND webhookAuthMode IS NOT NULL
                                   AND source != 'system')
    ),
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
    CHECK (
        (audienceKind = 'all'   AND audienceUserId IS NULL AND audienceGroupName IS NULL)
     OR (audienceKind = 'user'  AND audienceUserId IS NOT NULL AND audienceGroupName IS NULL)
     OR (audienceKind = 'group' AND audienceGroupName IS NOT NULL AND audienceUserId IS NULL)
    ),
    CHECK (
        (placementGuildId IS NULL AND placementChannelId IS NULL)
     OR (placementGuildId IS NOT NULL)
    ),
    CHECK (placementGuildId IS NULL OR scope = 'guild'),
    CHECK (
        triggerType = 'slash_command'
     OR (triggerType = 'message_pattern' AND contexts NOT LIKE '%Guild%')
    )
);
`;

/** Old `behaviors` schema — pluginId / pluginBehaviorKey present, source ∈ (custom,plugin,system). Used by down(). */
const OLD_TABLE_DDL = `
CREATE TABLE behaviors (
    id                       INTEGER  PRIMARY KEY AUTOINCREMENT,
    title                    TEXT     NOT NULL,
    description              TEXT     NOT NULL DEFAULT '',
    enabled                  INTEGER  NOT NULL DEFAULT 1,
    sortOrder                INTEGER  NOT NULL DEFAULT 0,
    stopOnMatch              INTEGER  NOT NULL DEFAULT 0,
    forwardType              TEXT     NOT NULL DEFAULT 'one_time'
                             CHECK (forwardType IN ('one_time','continuous')),
    source                   TEXT     NOT NULL
                             CHECK (source IN ('custom','plugin','system')),
    triggerType              TEXT     NOT NULL
                             CHECK (triggerType IN ('slash_command','message_pattern')),
    messagePatternKind       TEXT     NULL
                             CHECK (messagePatternKind IS NULL
                                 OR messagePatternKind IN ('startswith','endswith','regex')),
    messagePatternValue      TEXT     NULL,
    slashCommandName         TEXT     NULL
                             CHECK (slashCommandName IS NULL
                                 OR (LENGTH(slashCommandName) BETWEEN 1 AND 32
                                     AND slashCommandName NOT GLOB '*[^a-z0-9_-]*'
                                     AND slashCommandName = LOWER(slashCommandName))),
    slashCommandDescription  TEXT     NULL,
    scope                    TEXT     NOT NULL DEFAULT 'global'
                             CHECK (scope IN ('global','guild')),
    integrationTypes         TEXT     NOT NULL DEFAULT 'guild_install',
    contexts                 TEXT     NOT NULL DEFAULT 'Guild',
    placementGuildId         TEXT     NULL,
    placementChannelId       TEXT     NULL,
    audienceKind             TEXT     NOT NULL DEFAULT 'all'
                             CHECK (audienceKind IN ('all','user','group')),
    audienceUserId           TEXT     NULL,
    audienceGroupName        TEXT     NULL,
    webhookUrl               TEXT     NULL,
    webhookSecret            TEXT     NULL,
    webhookAuthMode          TEXT     NULL
                             CHECK (webhookAuthMode IS NULL
                                 OR webhookAuthMode IN ('token','hmac')),
    pluginId                 INTEGER  NULL REFERENCES plugins(id) ON DELETE CASCADE,
    pluginBehaviorKey        TEXT     NULL,
    systemKey                TEXT     NULL
                             CHECK (systemKey IS NULL
                                 OR systemKey IN ('admin-login','manual','break')),
    scopeTabId               INTEGER  NOT NULL DEFAULT 1,
    createdAt                DATETIME NOT NULL,
    updatedAt                DATETIME NOT NULL,

    CHECK (
        (triggerType = 'message_pattern' AND messagePatternKind IS NOT NULL
                                          AND messagePatternValue IS NOT NULL
                                          AND slashCommandName IS NULL)
     OR (triggerType = 'slash_command'   AND slashCommandName IS NOT NULL
                                          AND messagePatternKind IS NULL
                                          AND messagePatternValue IS NULL)
    ),
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
    CHECK (
        (webhookSecret IS NULL     AND webhookAuthMode IS NULL)
     OR (webhookSecret IS NOT NULL AND webhookAuthMode IS NOT NULL
                                   AND source != 'system')
    ),
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
    CHECK (
        (audienceKind = 'all'   AND audienceUserId IS NULL AND audienceGroupName IS NULL)
     OR (audienceKind = 'user'  AND audienceUserId IS NOT NULL AND audienceGroupName IS NULL)
     OR (audienceKind = 'group' AND audienceGroupName IS NOT NULL AND audienceUserId IS NULL)
    ),
    CHECK (
        (placementGuildId IS NULL AND placementChannelId IS NULL)
     OR (placementGuildId IS NOT NULL)
    ),
    CHECK (placementGuildId IS NULL OR scope = 'guild'),
    CHECK (
        triggerType = 'slash_command'
     OR (triggerType = 'message_pattern' AND contexts NOT LIKE '%Guild%')
    )
);
`;

const PLUGIN_OVERRIDES_DDL = `
CREATE TABLE IF NOT EXISTS plugin_behavior_overrides (
    pluginId    INTEGER  NOT NULL,
    behaviorKey TEXT     NOT NULL,
    enabled     INTEGER  NOT NULL DEFAULT 1,
    createdAt   DATETIME NOT NULL,
    updatedAt   DATETIME NOT NULL,
    PRIMARY KEY (pluginId, behaviorKey),
    FOREIGN KEY (pluginId) REFERENCES plugins(id) ON DELETE CASCADE
);
`;

/** Columns copied verbatim (explicit list so it's order-independent). */
const COPY_COLUMNS = [
  "id", "title", "description", "enabled", "sortOrder", "stopOnMatch",
  "forwardType", "source", "triggerType", "messagePatternKind",
  "messagePatternValue", "slashCommandName", "slashCommandDescription",
  "scope", "integrationTypes", "contexts", "placementGuildId",
  "placementChannelId", "audienceKind", "audienceUserId", "audienceGroupName",
  "webhookUrl", "webhookSecret", "webhookAuthMode", "systemKey", "scopeTabId",
  "createdAt", "updatedAt",
].join(", ");

async function rebuildBehaviors(
  queryInterface: Parameters<Migration["up"]>[0]["queryInterface"],
  newDdl: string,
  indexes: string[],
): Promise<void> {
  // PRAGMA must be set outside the transaction — SQLite ignores it inside.
  await queryInterface.sequelize.query("PRAGMA foreign_keys = OFF;");
  try {
    await queryInterface.sequelize.transaction(async (t) => {
      const q = (sql: string): Promise<unknown> =>
        queryInterface.sequelize.query(sql, { transaction: t });
      await q("DROP TABLE IF EXISTS behaviors_new;");
      // The DDL strings declare `CREATE TABLE behaviors (…)` (the final
      // shape) — build into a staging table first.
      await q(newDdl.replace("CREATE TABLE behaviors (", "CREATE TABLE behaviors_new ("));
      await q(
        `INSERT INTO behaviors_new (${COPY_COLUMNS}) SELECT ${COPY_COLUMNS} FROM behaviors WHERE source != 'plugin';`,
      );
      // Drop any child rows orphaned by removing source='plugin' behaviors
      // (there shouldn't be any, but keep foreign_key_check clean).
      await q(
        "DELETE FROM behavior_audience_members WHERE behaviorId NOT IN (SELECT id FROM behaviors_new);",
      );
      await q(
        "DELETE FROM behavior_sessions WHERE behaviorId NOT IN (SELECT id FROM behaviors_new);",
      );
      await q("DROP TABLE behaviors;");
      await q("ALTER TABLE behaviors_new RENAME TO behaviors;");
      for (const idx of indexes) await q(idx);
    });
  } finally {
    await queryInterface.sequelize.query("PRAGMA foreign_keys = ON;");
  }
  await queryInterface.sequelize.query("PRAGMA foreign_key_check;");
}

/** True if `behaviors` still has the legacy `pluginId` column. */
async function hasPluginColumn(
  queryInterface: Parameters<Migration["up"]>[0]["queryInterface"],
): Promise<boolean> {
  const [rows] = (await queryInterface.sequelize.query(
    "SELECT name FROM pragma_table_info('behaviors') WHERE name = 'pluginId';",
  )) as [Array<{ name: string }>, unknown];
  return rows.length > 0;
}

const migration: Migration = {
  up: async ({ queryInterface }) => {
    await queryInterface.sequelize.query(
      "DROP TABLE IF EXISTS plugin_behavior_overrides;",
    );
    // Idempotency guard: if a previous run committed the rebuild but the
    // process died before umzug recorded it, `behaviors` is already in the
    // new shape — re-running CREATE TABLE behaviors would error.
    if (!(await hasPluginColumn(queryInterface))) return;
    await rebuildBehaviors(queryInterface, NEW_TABLE_DDL, COMMON_INDEXES);
  },
  down: async ({ queryInterface }) => {
    await rebuildBehaviors(queryInterface, OLD_TABLE_DDL, [
      ...COMMON_INDEXES,
      ...PLUGIN_INDEXES,
    ]);
    await queryInterface.sequelize.query(PLUGIN_OVERRIDES_DDL);
    await queryInterface.sequelize.query(
      `CREATE INDEX IF NOT EXISTS plugin_behavior_overrides_lookup ON plugin_behavior_overrides(pluginId, enabled);`,
    );
  },
};

export default migration;
