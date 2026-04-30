import { QueryTypes } from "sequelize";
import type { Migration } from "./runner.js";

/**
 * Introduce {@link RoleEmojiGroup}s and per-message group pinning so
 * one guild can keep several independent reaction-role boards.
 *
 * Pre-redesign, `RoleEmojis` used (guildId, emojiId, emojiChar) as its
 * primary key, which collapses every emoji→role pairing in a guild
 * into one shared pool — the bug that motivates this migration.
 *
 * On a fresh install sync() creates the new tables directly and the
 * `groupId` column already exists; the migration's column probe makes
 * it a no-op in that case. On an existing install we:
 *   1. Create RoleEmojiGroups (the FK target).
 *   2. Create RoleReceiveMessageGroups (the junction; starts empty so
 *      every existing watched message defaults to "all groups").
 *   3. For every distinct guildId in the legacy RoleEmojis table,
 *      create a `default` group, then rebuild RoleEmojis with the new
 *      schema, mapping each row's guildId to its default group id.
 *
 * `down` is a no-op — the table rebuild loses no data going forward
 * but reversing it would require remerging mappings across groups,
 * which can produce key collisions. Operators rolling back should
 * restore from a backup.
 */
const GROUPS_TABLE = "RoleEmojiGroups";
const JUNCTION_TABLE = "RoleReceiveMessageGroups";
const ROLE_EMOJIS_TABLE = "RoleEmojis";
const DEFAULT_GROUP_NAME = "default";

interface LegacyRoleEmojiRow {
  roleId: string;
  emojiName: string | null;
  emojiId: string;
  emojiChar: string;
  guildId: string;
  createdAt: string;
  updatedAt: string;
}

interface InsertedGroupRow {
  id: number;
}

const migration: Migration = {
  up: async ({ queryInterface, sequelize }) => {
    const tables = await queryInterface.showAllTables();

    if (!tables.includes(GROUPS_TABLE)) {
      await sequelize.query(`
                CREATE TABLE ${GROUPS_TABLE} (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    guildId TEXT NOT NULL,
                    name TEXT NOT NULL,
                    createdAt DATETIME NOT NULL,
                    updatedAt DATETIME NOT NULL,
                    UNIQUE(guildId, name)
                );
            `);
    }

    if (!tables.includes(JUNCTION_TABLE)) {
      await sequelize.query(`
                CREATE TABLE ${JUNCTION_TABLE} (
                    guildId TEXT NOT NULL,
                    channelId TEXT NOT NULL,
                    messageId TEXT NOT NULL,
                    groupId INTEGER NOT NULL REFERENCES ${GROUPS_TABLE}(id) ON UPDATE CASCADE ON DELETE CASCADE,
                    createdAt DATETIME NOT NULL,
                    updatedAt DATETIME NOT NULL,
                    PRIMARY KEY (guildId, channelId, messageId, groupId)
                );
            `);
    }

    if (!tables.includes(ROLE_EMOJIS_TABLE)) return;

    // If the new schema is already in place (fresh sync, or this
    // migration ran previously) the rebuild is a no-op.
    const desc = await queryInterface.describeTable(ROLE_EMOJIS_TABLE);
    if ("groupId" in desc) return;

    // Snapshot the legacy rows before the rebuild — the table is
    // about to be dropped.
    const legacyRows = await sequelize.query<LegacyRoleEmojiRow>(
      `SELECT roleId, emojiName, emojiId, emojiChar, guildId, createdAt, updatedAt FROM ${ROLE_EMOJIS_TABLE}`,
      { type: QueryTypes.SELECT },
    );

    // One default group per guild that owned legacy mappings.
    const guildIds = [...new Set(legacyRows.map((r) => r.guildId))];
    const guildToGroupId = new Map<string, number>();
    for (const guildId of guildIds) {
      // Reuse an existing `default` group if one was somehow
      // already created (idempotent re-runs).
      const [existing] = await sequelize.query<InsertedGroupRow>(
        `SELECT id FROM ${GROUPS_TABLE} WHERE guildId = :guildId AND name = :name`,
        {
          type: QueryTypes.SELECT,
          replacements: { guildId, name: DEFAULT_GROUP_NAME },
        },
      );
      if (existing) {
        guildToGroupId.set(guildId, existing.id);
        continue;
      }
      await sequelize.query(
        `INSERT INTO ${GROUPS_TABLE} (guildId, name, createdAt, updatedAt)
                 VALUES (:guildId, :name, datetime('now'), datetime('now'))`,
        { replacements: { guildId, name: DEFAULT_GROUP_NAME } },
      );
      const [created] = await sequelize.query<InsertedGroupRow>(
        `SELECT id FROM ${GROUPS_TABLE} WHERE guildId = :guildId AND name = :name`,
        {
          type: QueryTypes.SELECT,
          replacements: { guildId, name: DEFAULT_GROUP_NAME },
        },
      );
      if (!created)
        throw new Error(`failed to create default group for guild ${guildId}`);
      guildToGroupId.set(guildId, created.id);
    }

    // Foreign-key pragma changes are ignored mid-transaction; flip
    // it off before BEGIN so the drop-and-rename dance doesn't
    // cascade across the junction table.
    await sequelize.query("PRAGMA foreign_keys = OFF;");
    try {
      await sequelize.transaction(async (transaction) => {
        await sequelize.query(
          `
                    CREATE TABLE ${ROLE_EMOJIS_TABLE}_new (
                        groupId INTEGER NOT NULL REFERENCES ${GROUPS_TABLE}(id) ON UPDATE CASCADE ON DELETE CASCADE,
                        emojiId TEXT NOT NULL,
                        emojiChar TEXT NOT NULL,
                        emojiName TEXT,
                        roleId TEXT,
                        createdAt DATETIME NOT NULL,
                        updatedAt DATETIME NOT NULL,
                        PRIMARY KEY (groupId, emojiId, emojiChar)
                    );
                `,
          { transaction },
        );

        for (const row of legacyRows) {
          const groupId = guildToGroupId.get(row.guildId);
          if (groupId === undefined) continue;
          // INSERT OR IGNORE in case two legacy rows differed
          // only by guildId — we collapse them into the same
          // default group, so the duplicate gets dropped.
          await sequelize.query(
            `INSERT OR IGNORE INTO ${ROLE_EMOJIS_TABLE}_new
                         (groupId, emojiId, emojiChar, emojiName, roleId, createdAt, updatedAt)
                         VALUES (:groupId, :emojiId, :emojiChar, :emojiName, :roleId, :createdAt, :updatedAt)`,
            {
              transaction,
              replacements: {
                groupId,
                emojiId: row.emojiId,
                emojiChar: row.emojiChar,
                emojiName: row.emojiName,
                roleId: row.roleId,
                createdAt: row.createdAt,
                updatedAt: row.updatedAt,
              },
            },
          );
        }

        await sequelize.query(`DROP TABLE ${ROLE_EMOJIS_TABLE};`, {
          transaction,
        });
        await sequelize.query(
          `ALTER TABLE ${ROLE_EMOJIS_TABLE}_new RENAME TO ${ROLE_EMOJIS_TABLE};`,
          { transaction },
        );
      });
    } finally {
      // Re-enable FK enforcement; if PRAGMA fails, force-evict the
      // SQLite connection. See migration 20260424000000 for the full
      // reasoning — Sequelize 6's SQLite dialect makes destroyConnection
      // / releaseConnection no-op, so direct cache eviction is the
      // only reliable way to recover a connection stuck in FK OFF.
      try {
        await sequelize.query("PRAGMA foreign_keys = ON;");
      } catch (pragmaErr) {
        console.warn(
          "[migration 20260427010000] PRAGMA foreign_keys = ON failed — force-evicting SQLite connection so next query reconnects with FK ON:",
          pragmaErr,
        );
        try {
          const dialectConnMgr = sequelize.connectionManager as unknown as {
            connections?: Record<string, { close: (cb: () => void) => void }>;
          };
          const cachedConn = dialectConnMgr.connections?.["default"];
          if (cachedConn) {
            await new Promise<void>((resolve) => cachedConn.close(resolve));
            delete dialectConnMgr.connections!["default"];
          }
        } catch (evictErr) {
          console.warn(
            "[migration 20260427010000] Failed to evict SQLite connection after PRAGMA failure:",
            evictErr,
          );
        }
        throw new Error(
          "PRAGMA foreign_keys = ON failed; SQLite connection evicted to force reconnect",
          { cause: pragmaErr },
        );
      }
    }
  },

  down: async () => {
    // No-op — see the doc comment above.
  },
};

export default migration;
