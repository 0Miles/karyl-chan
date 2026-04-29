import type { Migration } from "./runner.js";

/**
 * Drop the Discord-side capability_grants table.
 *
 * The bot used to ship its own capability grant system: per-guild
 * (capability, roleId) rows let admins authorize a Discord role to
 * use specific bot commands beyond Discord's native permission gate.
 * In practice every command that consulted it ALSO had a
 * `defaultMemberPermissions` on its SlashGroup — Discord already
 * filters command visibility by member permissions, and the in-house
 * grant layer was a duplicate.
 *
 * Removing the table + the routes that read/wrote it + the
 * /permission command. Existing grants are dropped on migration —
 * Discord-side `defaultMemberPermissions` covers the actual
 * gating on the four affected command groups (picture-only-channel,
 * todo-channel, rcon-forward-channel, role-emoji).
 *
 * Forward-only (no down): we don't restore the data on rollback.
 * If you need it back, recover from a DB backup before the migration
 * ran.
 */
const migration: Migration = {
  up: async ({ queryInterface }) => {
    const tables = await queryInterface.showAllTables();
    if (tables.includes("CapabilityGrants")) {
      await queryInterface.dropTable("CapabilityGrants");
    }
    if (tables.includes("capability_grants")) {
      await queryInterface.dropTable("capability_grants");
    }
  },
  down: async () => {
    /* not implemented — see migration header */
  },
};

export default migration;
