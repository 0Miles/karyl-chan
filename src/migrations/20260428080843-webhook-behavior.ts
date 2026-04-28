import type { Migration } from "./runner.js";

/**
 * Webhook behavior module schema.
 *
 *   behavior_targets         — targets a DM message can be matched against:
 *                              the singleton 'all_dms' row, individual users,
 *                              or named groups of users.
 *   behavior_target_members  — membership join for kind='group' targets.
 *   behaviors                — per-target trigger → webhook forward rules.
 *                              Ordered with sortOrder; stopOnMatch halts
 *                              evaluation when the rule fires.
 *   behavior_sessions        — DB-persisted active continuous-forward state
 *                              keyed by user. Survives bot restarts: on the
 *                              next DM from that user the handler picks the
 *                              row back up and resumes forwarding.
 *
 * Idempotent: every CREATE checks the table list first; index creation
 * uses IF NOT EXISTS and runs unconditionally so a fresh sync()'d DB
 * (which builds the tables from the model definitions, missing the
 * partial unique indexes and CHECK constraints) still ends up with the
 * right indexes after this migration runs.
 *
 * Seeds the all_dms singleton (id=1) via INSERT OR IGNORE so the seed
 * is safe whether the table came from this migration or from sync().
 */
const migration: Migration = {
  up: async ({ queryInterface }) => {
    const tables = await queryInterface.showAllTables();

    if (!tables.includes("behavior_targets")) {
      await queryInterface.sequelize.query(`
        CREATE TABLE behavior_targets (
            id          INTEGER  PRIMARY KEY AUTOINCREMENT,
            kind        TEXT     NOT NULL CHECK (kind IN ('all_dms','user','group')),
            userId      TEXT     NULL,
            groupName   TEXT     NULL,
            createdAt   DATETIME NOT NULL,
            updatedAt   DATETIME NOT NULL
        );
      `);
    }
    // Indexes always (re-)created with IF NOT EXISTS so a fresh-sync
    // install — where the table came from sequelize.sync() without any
    // index hints — still gets the partial unique constraints that
    // protect the data model.
    await queryInterface.sequelize.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS behavior_targets_all_dms_uq
          ON behavior_targets(kind) WHERE kind = 'all_dms';
    `);
    await queryInterface.sequelize.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS behavior_targets_user_uq
          ON behavior_targets(userId) WHERE kind = 'user';
    `);
    await queryInterface.sequelize.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS behavior_targets_group_uq
          ON behavior_targets(groupName) WHERE kind = 'group';
    `);
    // Seed the all_dms singleton. id=1 pinned so application code can
    // rely on a stable id for the 'all DMs' sidebar tab without a
    // lookup round-trip on every page load.
    await queryInterface.sequelize.query(`
      INSERT OR IGNORE INTO behavior_targets (id, kind, userId, groupName, createdAt, updatedAt)
      VALUES (1, 'all_dms', NULL, NULL, datetime('now'), datetime('now'));
    `);

    if (!tables.includes("behavior_target_members")) {
      await queryInterface.sequelize.query(`
        CREATE TABLE behavior_target_members (
            targetId    INTEGER  NOT NULL,
            userId      TEXT     NOT NULL,
            createdAt   DATETIME NOT NULL,
            updatedAt   DATETIME NOT NULL,
            PRIMARY KEY (targetId, userId),
            FOREIGN KEY (targetId) REFERENCES behavior_targets(id)
                ON DELETE CASCADE ON UPDATE CASCADE
        );
      `);
    }
    // Reverse-lookup index: "what groups does this user belong to?" —
    // dominant query path on every DM messageCreate.
    await queryInterface.sequelize.query(`
      CREATE INDEX IF NOT EXISTS behavior_target_members_user_idx
          ON behavior_target_members(userId);
    `);

    if (!tables.includes("behaviors")) {
      await queryInterface.sequelize.query(`
        CREATE TABLE behaviors (
            id              INTEGER  PRIMARY KEY AUTOINCREMENT,
            targetId        INTEGER  NOT NULL,
            title           TEXT     NOT NULL,
            description     TEXT     NOT NULL DEFAULT '',
            triggerType     TEXT     NOT NULL CHECK (triggerType IN ('startswith','endswith','regex')),
            triggerValue    TEXT     NOT NULL,
            forwardType     TEXT     NOT NULL CHECK (forwardType IN ('one_time','continuous')),
            webhookUrl      TEXT     NOT NULL,
            sortOrder       INTEGER  NOT NULL DEFAULT 0,
            stopOnMatch     INTEGER  NOT NULL DEFAULT 0,
            enabled         INTEGER  NOT NULL DEFAULT 1,
            createdAt       DATETIME NOT NULL,
            updatedAt       DATETIME NOT NULL,
            FOREIGN KEY (targetId) REFERENCES behavior_targets(id)
                ON DELETE CASCADE ON UPDATE CASCADE
        );
      `);
    }
    await queryInterface.sequelize.query(`
      CREATE INDEX IF NOT EXISTS behaviors_target_sort_idx
          ON behaviors(targetId, sortOrder);
    `);

    if (!tables.includes("behavior_sessions")) {
      await queryInterface.sequelize.query(`
        CREATE TABLE behavior_sessions (
            userId      TEXT     PRIMARY KEY,
            behaviorId  INTEGER  NOT NULL,
            channelId   TEXT     NOT NULL,
            startedAt   DATETIME NOT NULL,
            createdAt   DATETIME NOT NULL,
            updatedAt   DATETIME NOT NULL,
            FOREIGN KEY (behaviorId) REFERENCES behaviors(id)
                ON DELETE CASCADE ON UPDATE CASCADE
        );
      `);
    }
    await queryInterface.sequelize.query(`
      CREATE INDEX IF NOT EXISTS behavior_sessions_behavior_idx
          ON behavior_sessions(behaviorId);
    `);
  },

  down: async ({ queryInterface }) => {
    // Drop in reverse FK order so cascading constraints don't trip.
    await queryInterface.sequelize.query(`DROP TABLE IF EXISTS behavior_sessions;`);
    await queryInterface.sequelize.query(`DROP TABLE IF EXISTS behaviors;`);
    await queryInterface.sequelize.query(`DROP TABLE IF EXISTS behavior_target_members;`);
    await queryInterface.sequelize.query(`DROP TABLE IF EXISTS behavior_targets;`);
  },
};

export default migration;
