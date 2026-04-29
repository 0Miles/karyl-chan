import type { Migration } from "./runner.js";

/**
 * plugin_commands — what we've registered with Discord on behalf of
 * each plugin, so we can:
 *   1) reconcile on bot restart (compare DB rows vs Discord's actual
 *      command list, patch the diff)
 *   2) reverse-route an inbound interaction (interaction.commandName
 *      → which plugin owns it)
 *   3) cleanly tear down on plugin unregister/disable (call Discord
 *      delete with the stored discordCommandId)
 *
 * Scope:
 *   - guild scope: one row per (pluginId, guildId, name)
 *   - global scope: one row per (pluginId, NULL guildId, name)
 *
 * `manifestJson` stores the per-command slice of the manifest used
 * to build the Discord ApplicationCommandData payload. Reconcile
 * diffs against this so a manifest tweak (description change, new
 * subcommand) triggers a Discord-side edit instead of leaving stale
 * data hanging around.
 *
 * `discordCommandId` may be null transiently (between insert and
 * Discord ack) — query consumers should treat null as "registration
 * pending or failed; retry next reconcile".
 */
const migration: Migration = {
  up: async ({ queryInterface }) => {
    const tables = await queryInterface.showAllTables();
    if (!tables.includes("plugin_commands")) {
      await queryInterface.sequelize.query(`
        CREATE TABLE plugin_commands (
            id               INTEGER  PRIMARY KEY AUTOINCREMENT,
            pluginId         INTEGER  NOT NULL REFERENCES plugins(id) ON DELETE CASCADE,
            guildId          TEXT     NULL,
            name             TEXT     NOT NULL,
            discordCommandId TEXT     NULL,
            manifestJson     TEXT     NOT NULL,
            createdAt        DATETIME NOT NULL,
            updatedAt        DATETIME NOT NULL
        );
      `);
    }
    // SQLite UNIQUE on (pluginId, guildId, name): NULL guildId is
    // distinct under SQLite's UNIQUE semantics, so plugin A and plugin
    // B can both have a global 'foo' command — but the bot rejects
    // collisions in the registry layer before getting here.
    await queryInterface.sequelize.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS plugin_commands_unique
          ON plugin_commands(pluginId, guildId, name);
    `);
    // Reverse lookup: given a fresh interaction, find owner plugin
    // fast. (name, guildId) is the natural key from interaction
    // payload.
    await queryInterface.sequelize.query(`
      CREATE INDEX IF NOT EXISTS plugin_commands_lookup
          ON plugin_commands(name, guildId);
    `);
  },
  down: async ({ queryInterface }) => {
    await queryInterface.sequelize.query(`DROP INDEX IF EXISTS plugin_commands_lookup;`);
    await queryInterface.sequelize.query(`DROP INDEX IF EXISTS plugin_commands_unique;`);
    await queryInterface.dropTable("plugin_commands");
  },
};

export default migration;
